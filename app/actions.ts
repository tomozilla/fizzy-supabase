"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextPosition, slugify, parseMentionHandles, nameMatchesHandle } from "@/lib/kanban";

// Every mutation here relies on RLS to enforce the account boundary — these
// actions never check "does this user own this board" themselves. That's the
// core difference from Fizzy, where `Current.account` + controller
// before_actions do that check in Ruby. Here, an authenticated user with no
// membership row simply gets zero rows back (or a policy violation on
// insert) — the database refuses on their behalf.

export async function ensurePersonalAccount() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/auth/login");
  const userId = auth.user.id;

  const name = `${auth.user.email?.split("@")[0] ?? "My"}'s Workspace`;
  // Deterministic id (= the user's own id), not a random one, so this whole
  // function is idempotent under concurrency by construction rather than by
  // retrying after a collision. A retry-after-conflict version of this
  // shipped first and still failed in production — Vercel's own runtime
  // logs showed a genuine "duplicate key value violates ... accounts_pkey"
  // reaching the client as an uncaught error, meaning two real concurrent
  // invocations (likely Next's own double-invocation of a Suspense-streamed
  // dynamic segment, not just a router prefetch) can race closely enough
  // that a fixed retry window isn't a reliable fix. `upsert` with
  // `ignoreDuplicates` compiles to `INSERT ... ON CONFLICT DO NOTHING`,
  // which is safe under any level of concurrency because there's no
  // read-then-write gap left to race at all.
  const accountId = userId;
  const slug = slugify(name, accountId.slice(0, 8));

  const { error } = await supabase
    .from("accounts")
    .upsert({ id: accountId, name, slug }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const { error: memberError } = await supabase
    .from("account_users")
    .upsert(
      { account_id: accountId, user_id: userId, role: "owner" },
      { onConflict: "account_id,user_id", ignoreDuplicates: true },
    );
  if (memberError) throw new Error(memberError.message);

  return accountId;
}

export async function createBoard(accountId: string, name: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: board, error } = await supabase
    .from("boards")
    .insert({ account_id: accountId, name, created_by: auth?.user?.id })
    .select("id")
    .single();

  if (error || !board) throw new Error(error?.message ?? "Could not create board");

  // Seed three default columns, same as Fizzy's default board template.
  const defaults = ["To do", "In progress", "Done"];
  await supabase.from("columns").insert(
    defaults.map((colName, i) => ({
      board_id: board.id,
      account_id: accountId,
      name: colName,
      position: i,
    })),
  );

  revalidatePath("/boards");
  redirect(`/boards/${board.id}`);
}

export async function createColumn(boardId: string, accountId: string, name: string) {
  const supabase = await createClient();
  const { data: cols } = await supabase
    .from("columns")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1);

  const { error } = await supabase
    .from("columns")
    .insert({ board_id: boardId, account_id: accountId, name, position: nextPosition(cols ?? []) });

  if (error) throw new Error(error.message);
  revalidatePath(`/boards/${boardId}`);
}

export async function createCard(
  boardId: string,
  columnId: string,
  accountId: string,
  title: string,
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: cards } = await supabase
    .from("cards")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1);

  const { data: card, error } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      column_id: columnId,
      account_id: accountId,
      title,
      position: nextPosition(cards ?? []),
      created_by: auth?.user?.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("events").insert({
    account_id: accountId,
    board_id: boardId,
    card_id: card?.id,
    actor_id: auth?.user?.id,
    kind: "card.created",
    data: { title },
  });

  revalidatePath(`/boards/${boardId}`);
}

export async function moveCard(cardId: string, boardId: string, newColumnId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: cards } = await supabase
    .from("cards")
    .select("position")
    .eq("column_id", newColumnId)
    .order("position", { ascending: false })
    .limit(1);

  const { error } = await supabase
    .from("cards")
    .update({ column_id: newColumnId, position: nextPosition(cards ?? []) })
    .eq("id", cardId);

  if (error) throw new Error(error.message);

  const { data: card } = await supabase
    .from("cards")
    .select("account_id")
    .eq("id", cardId)
    .single();

  if (card) {
    await supabase.from("events").insert({
      account_id: card.account_id,
      board_id: boardId,
      card_id: cardId,
      actor_id: auth?.user?.id,
      kind: "card.moved",
      data: { new_column_id: newColumnId },
    });
  }

  revalidatePath(`/boards/${boardId}`);
}

/**
 * Bulk position/column update for drag-and-drop reordering — one call
 * covers both the source and destination columns' final order (dragging
 * across columns touches both), rather than N separate moveCard calls.
 */
export async function reorderCards(
  boardId: string,
  updates: { cardId: string; columnId: string; position: number }[],
) {
  const supabase = await createClient();

  const { error } = (
    await Promise.all(
      updates.map(({ cardId, columnId, position }) =>
        supabase.from("cards").update({ column_id: columnId, position }).eq("id", cardId),
      ),
    )
  ).find((r) => r.error) ?? {};

  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}`);
}

export async function addComment(cardId: string, boardId: string, body: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: card } = await supabase
    .from("cards")
    .select("account_id")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card not found");

  const { data: comment, error } = await supabase
    .from("comments")
    .insert({ card_id: cardId, account_id: card.account_id, author_id: auth?.user?.id, body })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("events").insert({
    account_id: card.account_id,
    card_id: cardId,
    actor_id: auth?.user?.id,
    kind: "comment.created",
    data: { comment_id: comment?.id },
  });

  // Resolve @mentions client-parsed handles to member ids, then let the
  // parse-mentions Edge Function do the (server-trusted) validation + fan-out.
  const mentionHandles = parseMentionHandles(body);
  if (mentionHandles.length > 0 && comment) {
    const { data: members } = await supabase
      .from("account_users")
      .select("user_id, profiles!inner(full_name)")
      .eq("account_id", card.account_id);

    const mentionedIds = (members ?? [])
      .filter((m) => {
        const fullName = (m.profiles as unknown as { full_name: string | null })?.full_name;
        return mentionHandles.some((h) => nameMatchesHandle(fullName, h));
      })
      .map((m) => m.user_id);

    if (mentionedIds.length > 0) {
      await supabase.functions.invoke("parse-mentions", {
        body: { comment_id: comment.id, mentioned_user_ids: mentionedIds },
      });
    }
  }

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function toggleTag(
  cardId: string,
  boardId: string,
  accountId: string,
  tagName: string,
) {
  const supabase = await createClient();

  let { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", tagName)
    .maybeSingle();

  if (!tag) {
    const { data: created, error } = await supabase
      .from("tags")
      .insert({ account_id: accountId, name: tagName })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    tag = created;
  }

  const { data: existing } = await supabase
    .from("taggings")
    .select("card_id")
    .eq("card_id", cardId)
    .eq("tag_id", tag!.id)
    .maybeSingle();

  if (existing) {
    await supabase.from("taggings").delete().eq("card_id", cardId).eq("tag_id", tag!.id);
  } else {
    await supabase.from("taggings").insert({ card_id: cardId, tag_id: tag!.id });
  }

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function toggleAssignment(cardId: string, boardId: string, userId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: existing } = await supabase
    .from("assignments")
    .select("card_id")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await supabase.from("assignments").delete().eq("card_id", cardId).eq("user_id", userId);
  } else {
    await supabase
      .from("assignments")
      .insert({ card_id: cardId, user_id: userId, assigned_by: auth?.user?.id });
  }

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function addAttachment(
  cardId: string,
  boardId: string,
  accountId: string,
  storagePath: string,
  filename: string,
  contentType: string,
  byteSize: number,
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.from("attachments").insert({
    card_id: cardId,
    account_id: accountId,
    uploaded_by: auth?.user?.id,
    storage_path: storagePath,
    filename,
    content_type: contentType,
    byte_size: byteSize,
  });

  if (error) throw new Error(error.message);

  await supabase.from("events").insert({
    account_id: accountId,
    board_id: boardId,
    card_id: cardId,
    actor_id: auth?.user?.id,
    kind: "attachment.added",
    data: { filename },
  });

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function toggleWatch(cardId: string, boardId: string, userId: string) {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("watches")
    .select("card_id")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await supabase.from("watches").delete().eq("card_id", cardId).eq("user_id", userId);
  } else {
    await supabase.from("watches").insert({ card_id: cardId, user_id: userId });
  }

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

// ── Card workflow states ──────────────────────────────────────────────────
// Fizzy equivalents: Card::Closeable, Card::Golden, Card::NotNow /
// Card::Postponable, Card::Triageable. Each writes an `events` row so the
// activity feed and watcher notifications pick it up via the same trigger
// every other mutation uses.

async function logCardEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cardId: string,
  boardId: string,
  kind: string,
  data: Record<string, unknown> = {},
) {
  const { data: auth } = await supabase.auth.getUser();
  const { data: card } = await supabase
    .from("cards")
    .select("account_id")
    .eq("id", cardId)
    .single();
  if (!card) return;

  await supabase.from("events").insert({
    account_id: card.account_id,
    board_id: boardId,
    card_id: cardId,
    actor_id: auth?.user?.id,
    kind,
    data,
  });
}

export async function toggleCardClosed(cardId: string, boardId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: card } = await supabase
    .from("cards")
    .select("closed_at")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card not found");

  const closing = card.closed_at === null;
  const { error } = await supabase
    .from("cards")
    .update({
      closed_at: closing ? new Date().toISOString() : null,
      closed_by: closing ? auth?.user?.id : null,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await logCardEvent(supabase, cardId, boardId, closing ? "card.closed" : "card.reopened");

  revalidatePath(`/boards/${boardId}`);
  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function toggleCardGolden(cardId: string, boardId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: card } = await supabase
    .from("cards")
    .select("golden_at")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card not found");

  const marking = card.golden_at === null;
  const { error } = await supabase
    .from("cards")
    .update({
      golden_at: marking ? new Date().toISOString() : null,
      golden_by: marking ? auth?.user?.id : null,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await logCardEvent(supabase, cardId, boardId, marking ? "card.golden" : "card.ungolden");

  revalidatePath(`/boards/${boardId}`);
  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

/** Snooze a card off the board until `days` from now, or un-snooze if null. */
export async function postponeCard(cardId: string, boardId: string, days: number | null) {
  const supabase = await createClient();

  const until =
    days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("cards")
    .update({ not_now_until: until })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await logCardEvent(supabase, cardId, boardId, until ? "card.postponed" : "card.resumed", {
    until,
  });

  revalidatePath(`/boards/${boardId}`);
  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function markCardTriaged(cardId: string, boardId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("cards")
    .update({ triaged_at: new Date().toISOString() })
    .eq("id", cardId);
  if (error) throw new Error(error.message);

  await logCardEvent(supabase, cardId, boardId, "card.triaged");

  revalidatePath(`/boards/${boardId}/triage`);
  revalidatePath(`/boards/${boardId}`);
}

// ── Steps (per-card checklist) — Fizzy's Card::Multistep / Step ──────────
export async function addStep(
  cardId: string,
  boardId: string,
  accountId: string,
  title: string,
) {
  const supabase = await createClient();

  const { data: steps } = await supabase
    .from("steps")
    .select("position")
    .eq("card_id", cardId)
    .order("position", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("steps").insert({
    card_id: cardId,
    account_id: accountId,
    title,
    position: nextPosition(steps ?? []),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function toggleStep(stepId: string, cardId: string, boardId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: step } = await supabase
    .from("steps")
    .select("completed_at")
    .eq("id", stepId)
    .single();
  if (!step) throw new Error("Step not found");

  const completing = step.completed_at === null;
  const { error } = await supabase
    .from("steps")
    .update({
      completed_at: completing ? new Date().toISOString() : null,
      completed_by: completing ? auth?.user?.id : null,
    })
    .eq("id", stepId);
  if (error) throw new Error(error.message);

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function deleteStep(stepId: string, cardId: string, boardId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("steps").delete().eq("id", stepId);
  if (error) throw new Error(error.message);
  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

// ── Reactions & pins — tables existed since the initial schema but had no
// application code at all until now. ────────────────────────────────────
export async function toggleReaction(
  commentId: string,
  cardId: string,
  boardId: string,
  emoji: string,
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Not signed in");

  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("comment_id", commentId)
    .eq("user_id", auth.user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from("reactions").delete().eq("id", existing.id);
  } else {
    const { error } = await supabase
      .from("reactions")
      .insert({ comment_id: commentId, user_id: auth.user.id, emoji });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}

export async function togglePin(cardId: string, boardId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Not signed in");

  const { data: existing } = await supabase
    .from("pins")
    .select("card_id")
    .eq("card_id", cardId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (existing) {
    await supabase.from("pins").delete().eq("card_id", cardId).eq("user_id", auth.user.id);
  } else {
    const { error } = await supabase
      .from("pins")
      .insert({ card_id: cardId, user_id: auth.user.id });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
  revalidatePath(`/boards/${boardId}/cards/${cardId}`);
}
