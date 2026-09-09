import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { markNotificationRead, markAllNotificationsRead } from "@/app/actions";
import { describeEvent } from "@/lib/kanban";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Fizzy fans notifications out to watchers and mentions via Notifier
// subclasses and shows them in-app; here the same rows are produced by the
// fan_out_notifications Postgres trigger (plus the parse-mentions Edge
// Function) and rendered here.
export default function NotificationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <NotificationsContent />
    </Suspense>
  );
}

async function NotificationsContent() {
  const supabase = await createClient();

  const { data: notifications } = await supabase
    .from("notifications")
    .select(
      "id, read_at, created_at, events!inner(id, kind, board_id, card_id, actor_id, cards(title), profiles(full_name))",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (notifications ?? []).map((n) => {
    const event = n.events as unknown as {
      id: string;
      kind: string;
      board_id: string | null;
      card_id: string | null;
      cards: { title: string } | null;
      profiles: { full_name: string | null } | null;
    };
    return {
      id: n.id,
      readAt: n.read_at,
      createdAt: n.created_at,
      kind: event.kind,
      boardId: event.board_id,
      cardId: event.card_id,
      cardTitle: event.cards?.title ?? null,
      actorName: event.profiles?.full_name ?? "Someone",
    };
  });

  const unread = rows.filter((r) => r.readAt === null).length;

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : "All caught up."}
          </p>
        </div>
        {unread > 0 && (
          <form
            action={async () => {
              "use server";
              await markAllNotificationsRead();
            }}
          >
            <Button type="submit" size="sm" variant="outline">
              Mark all read
            </Button>
          </form>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((n) => (
          <Card
            key={n.id}
            data-testid={`notification-${n.id}`}
            className={`p-3 flex items-center gap-3 ${n.readAt ? "opacity-60" : ""}`}
          >
            {!n.readAt && <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden />}
            <div className="flex-1 text-sm">
              {n.boardId && n.cardId ? (
                <Link
                  href={`/boards/${n.boardId}/cards/${n.cardId}`}
                  className="hover:text-primary"
                >
                  {describeEvent(n.kind, n.actorName, n.cardTitle)}
                </Link>
              ) : (
                describeEvent(n.kind, n.actorName, n.cardTitle)
              )}
            </div>
            {!n.readAt && (
              <form
                action={async () => {
                  "use server";
                  await markNotificationRead(n.id);
                }}
              >
                <Button type="submit" size="sm" variant="ghost">
                  Mark read
                </Button>
              </form>
            )}
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No notifications yet — watch a card or get mentioned in a comment and they&apos;ll
            show up here.
          </p>
        )}
      </ul>
    </div>
  );
}
