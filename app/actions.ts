"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const { data: existing } = await supabase
    .from("account_users")
    .select("account_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();

  if (existing) return existing.account_id;

  const name = `${auth.user.email?.split("@")[0] ?? "My"}'s Workspace`;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${auth.user.id.slice(0, 8)}`;

  // Generate the id client-side rather than reading it back via `.select()`:
  // right after this insert, no account_users row exists yet, so the
  // "Members can view their accounts" SELECT policy would reject the
  // post-insert re-select PostgREST does for `return=representation` — a
  // classic RLS chicken-and-egg (caught by testing against the live REST API
  // directly, not just skimming the SQL). Skipping `.select()` avoids ever
  // needing to read the row back before membership exists.
  const accountId = crypto.randomUUID();

  const { error } = await supabase.from("accounts").insert({ id: accountId, name, slug });
  if (error) throw new Error(error.message);

  const { error: memberError } = await supabase
    .from("account_users")
    .insert({ account_id: accountId, user_id: auth.user.id, role: "owner" });

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

  const nextPosition = (cols?.[0]?.position ?? -1) + 1;

  const { error } = await supabase
    .from("columns")
    .insert({ board_id: boardId, account_id: accountId, name, position: nextPosition });

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

  const nextPosition = (cards?.[0]?.position ?? -1) + 1;

  const { data: card, error } = await supabase
    .from("cards")
    .insert({
      board_id: boardId,
      column_id: columnId,
      account_id: accountId,
      title,
      position: nextPosition,
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

  const nextPosition = (cards?.[0]?.position ?? -1) + 1;

  const { error } = await supabase
    .from("cards")
    .update({ column_id: newColumnId, position: nextPosition })
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
  const mentionNames = Array.from(body.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
  if (mentionNames.length > 0 && comment) {
    const { data: members } = await supabase
      .from("account_users")
      .select("user_id, profiles!inner(full_name)")
      .eq("account_id", card.account_id);

    const mentionedIds = (members ?? [])
      .filter((m) => {
        const fullName = (m.profiles as unknown as { full_name: string | null })?.full_name;
        return fullName && mentionNames.includes(fullName.toLowerCase().replace(/\s+/g, ""));
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

export async function toggleTag(cardId: string, accountId: string, tagName: string) {
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
}

export async function toggleAssignment(cardId: string, userId: string) {
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

export async function toggleWatch(cardId: string, userId: string) {
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
}
