import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import {
  toggleTag,
  toggleAssignment,
  toggleWatch,
  toggleCardClosed,
  toggleCardGolden,
  postponeCard,
  addStep,
  toggleStep,
  deleteStep,
  toggleReaction,
  togglePin,
} from "@/app/actions";
import { CardComments } from "@/components/card-comments";
import { AttachmentUploader } from "@/components/attachment-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const REACTION_EMOJI = ["👍", "❤️", "🎉", "👀"];

export default function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading card…</p>}>
      <CardPageContent params={params} />
    </Suspense>
  );
}

async function CardPageContent({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { boardId, cardId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;

  const { data: card } = await supabase
    .from("cards")
    .select(
      "id, title, description, account_id, board_id, closed_at, golden_at, not_now_until, triaged_at",
    )
    .eq("id", cardId)
    .single();

  if (!card) notFound();

  const [
    { data: members },
    { data: tags },
    { data: taggings },
    { data: assignments },
    { data: attachments },
    { data: comments },
    { data: steps },
    { data: reactions },
    { data: watches },
    { data: pins },
  ] = await Promise.all([
    supabase
      .from("account_users")
      .select("user_id, profiles!inner(full_name)")
      .eq("account_id", card.account_id),
    supabase.from("tags").select("id, name").eq("account_id", card.account_id),
    supabase.from("taggings").select("tag_id").eq("card_id", cardId),
    supabase.from("assignments").select("user_id").eq("card_id", cardId),
    supabase
      .from("attachments")
      .select("id, storage_path, filename, byte_size")
      .eq("card_id", cardId),
    supabase
      .from("comments")
      .select("id, body, created_at, author_id, profiles(full_name)")
      .eq("card_id", cardId)
      .order("created_at"),
    supabase
      .from("steps")
      .select("id, title, position, completed_at")
      .eq("card_id", cardId)
      .order("position"),
    supabase.from("reactions").select("id, comment_id, emoji, user_id"),
    supabase.from("watches").select("user_id").eq("card_id", cardId),
    supabase.from("pins").select("user_id").eq("card_id", cardId),
  ]);

  const taggedIds = new Set((taggings ?? []).map((t) => t.tag_id));
  const assignedIds = new Set((assignments ?? []).map((a) => a.user_id));
  const isWatching = (watches ?? []).some((w) => w.user_id === userId);
  const isPinned = (pins ?? []).some((p) => p.user_id === userId);
  const stepList = steps ?? [];
  const doneSteps = stepList.filter((s) => s.completed_at !== null).length;

  const attachmentsWithUrls = await Promise.all(
    (attachments ?? []).map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("card-attachments")
        .createSignedUrl(a.storage_path, 60 * 60);
      return { ...a, url: signed?.signedUrl ?? null };
    }),
  );

  async function toggleTagAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await toggleTag(cardId, boardId, card!.account_id, name);
  }

  async function addStepAction(formData: FormData) {
    "use server";
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    await addStep(cardId, boardId, card!.account_id, title);
  }

  async function postponeAction(formData: FormData) {
    "use server";
    const raw = String(formData.get("days") ?? "");
    await postponeCard(cardId, boardId, raw === "resume" ? null : Number(raw));
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <a href={`/boards/${boardId}`} className="text-sm text-muted-foreground hover:text-primary">
          ← Back to board
        </a>
        <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
          {card.golden_at && <span title="Golden card">⭐</span>}
          <span className={card.closed_at ? "line-through text-muted-foreground" : ""}>
            {card.title}
          </span>
        </h1>
        {card.description && <p className="text-muted-foreground mt-1">{card.description}</p>}
        {card.not_now_until && (
          <p className="text-xs text-muted-foreground mt-1">
            Postponed until {new Date(card.not_now_until).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* ── Card state actions ─────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-2">
        <form
          action={async () => {
            "use server";
            await toggleCardClosed(cardId, boardId);
          }}
        >
          <Button type="submit" size="sm" variant={card.closed_at ? "secondary" : "outline"}>
            {card.closed_at ? "Reopen card" : "Close card"}
          </Button>
        </form>

        <form
          action={async () => {
            "use server";
            await toggleCardGolden(cardId, boardId);
          }}
        >
          <Button type="submit" size="sm" variant={card.golden_at ? "default" : "outline"}>
            {card.golden_at ? "⭐ Golden" : "☆ Mark golden"}
          </Button>
        </form>

        <form
          action={async () => {
            "use server";
            if (userId) await toggleWatch(cardId, boardId, userId);
          }}
        >
          <Button type="submit" size="sm" variant={isWatching ? "default" : "outline"}>
            {isWatching ? "👁 Watching" : "👁 Watch"}
          </Button>
        </form>

        <form
          action={async () => {
            "use server";
            await togglePin(cardId, boardId);
          }}
        >
          <Button type="submit" size="sm" variant={isPinned ? "default" : "outline"}>
            {isPinned ? "📌 Pinned" : "📌 Pin"}
          </Button>
        </form>

        <form action={postponeAction} className="flex items-center gap-1">
          <select
            name="days"
            aria-label="Postpone this card"
            defaultValue=""
            className="border rounded bg-background text-xs h-8 px-2"
          >
            <option value="" disabled>
              Postpone…
            </option>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
            <option value="resume">Resume now</option>
          </select>
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      </section>

      {/* ── Checklist / steps ──────────────────────────────────────── */}
      <section>
        <h2 className="font-semibold text-sm mb-2">
          Checklist{" "}
          {stepList.length > 0 && (
            <span className="font-normal text-muted-foreground">
              ({doneSteps}/{stepList.length} done)
            </span>
          )}
        </h2>
        <ul className="flex flex-col gap-1 mb-2">
          {stepList.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              <form
                action={async () => {
                  "use server";
                  await toggleStep(step.id, cardId, boardId);
                }}
              >
                <button
                  type="submit"
                  aria-label={`Toggle step "${step.title}"`}
                  className="w-4 h-4 border rounded flex items-center justify-center text-[10px] leading-none hover:border-primary"
                >
                  {step.completed_at ? "✓" : ""}
                </button>
              </form>
              <span className={step.completed_at ? "line-through text-muted-foreground" : ""}>
                {step.title}
              </span>
              <form
                action={async () => {
                  "use server";
                  await deleteStep(step.id, cardId, boardId);
                }}
                className="ml-auto"
              >
                <button
                  type="submit"
                  aria-label={`Delete step "${step.title}"`}
                  className="text-muted-foreground hover:text-destructive text-xs"
                >
                  ✕
                </button>
              </form>
            </li>
          ))}
          {stepList.length === 0 && (
            <p className="text-sm text-muted-foreground">No steps yet.</p>
          )}
        </ul>
        <form action={addStepAction} className="flex gap-2">
          <Input name="title" placeholder="New step…" className="text-sm h-8 max-w-[260px]" />
          <Button type="submit" size="sm" variant="outline">
            Add step
          </Button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Tags</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          {(tags ?? []).map((tag) => (
            <form key={tag.id} action={toggleTagAction}>
              <input type="hidden" name="name" value={tag.name} />
              <button
                type="submit"
                className={cn(badgeVariants({ variant: taggedIds.has(tag.id) ? "default" : "outline" }))}
              >
                {tag.name}
              </button>
            </form>
          ))}
        </div>
        <form action={toggleTagAction} className="flex gap-2">
          <Input name="name" placeholder="New tag…" className="text-sm h-8 max-w-[200px]" />
          <Button type="submit" size="sm" variant="outline">
            Add tag
          </Button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Assignees</h2>
        <div className="flex flex-wrap gap-2">
          {(members ?? []).map((m) => {
            const fullName =
              (m.profiles as unknown as { full_name: string | null })?.full_name ?? "Member";
            return (
              <form
                key={m.user_id}
                action={async () => {
                  "use server";
                  await toggleAssignment(cardId, boardId, m.user_id);
                }}
              >
                <button
                  type="submit"
                  className={cn(
                    badgeVariants({ variant: assignedIds.has(m.user_id) ? "default" : "outline" }),
                  )}
                >
                  {fullName}
                </button>
              </form>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Attachments</h2>
        <ul className="flex flex-col gap-1 mb-2">
          {attachmentsWithUrls.map((a) => (
            <li key={a.id} className="text-sm">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  📎 {a.filename}
                </a>
              ) : (
                <span>📎 {a.filename}</span>
              )}
            </li>
          ))}
        </ul>
        <AttachmentUploader cardId={cardId} boardId={boardId} accountId={card.account_id} />
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">
          Comments <span className="font-normal text-muted-foreground">(use @name to mention)</span>
        </h2>
        <CardComments
          cardId={cardId}
          boardId={boardId}
          initialComments={(comments ?? []).map((c) => ({
            id: c.id,
            body: c.body,
            created_at: c.created_at,
            author_name:
              (c.profiles as unknown as { full_name: string | null } | null)?.full_name ??
              "Someone",
          }))}
          memberNames={Object.fromEntries(
            (members ?? []).map((m) => [
              m.user_id,
              (m.profiles as unknown as { full_name: string | null })?.full_name ?? "Someone",
            ]),
          )}
          reactionRows={(reactions ?? []).map((r) => ({
            id: r.id,
            comment_id: r.comment_id,
            emoji: r.emoji,
            user_id: r.user_id,
          }))}
          currentUserId={userId ?? null}
          emojiChoices={REACTION_EMOJI}
          onToggleReaction={async (commentId: string, emoji: string) => {
            "use server";
            await toggleReaction(commentId, cardId, boardId, emoji);
          }}
        />
      </section>
    </div>
  );
}
