import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { toggleTag, toggleAssignment, toggleWatch } from "@/app/actions";
import { CardComments } from "@/components/card-comments";
import { AttachmentUploader } from "@/components/attachment-uploader";

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

  const { data: card } = await supabase
    .from("cards")
    .select("id, title, description, account_id, board_id, closed_at")
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
  ]);

  const taggedIds = new Set((taggings ?? []).map((t) => t.tag_id));
  const assignedIds = new Set((assignments ?? []).map((a) => a.user_id));

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
    await toggleTag(cardId, card!.account_id, name);
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <a href={`/boards/${boardId}`} className="text-sm text-muted-foreground hover:underline">
          ← Back to board
        </a>
        <h1 className="text-2xl font-bold mt-2">{card.title}</h1>
        {card.description && <p className="text-muted-foreground mt-1">{card.description}</p>}
      </div>

      <section>
        <h2 className="font-semibold text-sm mb-2">Tags</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          {(tags ?? []).map((tag) => (
            <form key={tag.id} action={toggleTagAction}>
              <input type="hidden" name="name" value={tag.name} />
              <button
                type="submit"
                className={`text-xs border rounded-full px-3 py-1 ${
                  taggedIds.has(tag.id) ? "bg-foreground text-background" : ""
                }`}
              >
                {tag.name}
              </button>
            </form>
          ))}
        </div>
        <form action={toggleTagAction} className="flex gap-2">
          <input
            name="name"
            placeholder="New tag…"
            className="border rounded px-2 py-1 text-sm bg-background"
          />
          <button type="submit" className="text-xs border rounded px-2 py-1">
            Add tag
          </button>
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
                  await toggleAssignment(cardId, m.user_id);
                }}
              >
                <button
                  type="submit"
                  className={`text-xs border rounded-full px-3 py-1 ${
                    assignedIds.has(m.user_id) ? "bg-foreground text-background" : ""
                  }`}
                >
                  {fullName}
                </button>
              </form>
            );
          })}
        </div>
      </section>

      <section>
        <form
          action={async () => {
            "use server";
            if (auth?.user) await toggleWatch(cardId, auth.user.id);
          }}
        >
          <button type="submit" className="text-xs border rounded px-3 py-1">
            👁 Toggle watch (get notified on activity)
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Attachments</h2>
        <ul className="flex flex-col gap-1 mb-2">
          {attachmentsWithUrls.map((a) => (
            <li key={a.id} className="text-sm">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">
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
        />
      </section>
    </div>
  );
}
