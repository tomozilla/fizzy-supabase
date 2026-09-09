import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { markCardTriaged, toggleCardClosed, postponeCard } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Fizzy's Board::Triageable / Card::Triageable: an inbox-style pass over
// cards nobody has processed yet, so new arrivals don't silently pile up on
// the board. A card is "triaged" once someone has explicitly dealt with it —
// accepted it onto the board, closed it, or postponed it.
export default function TriagePage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading triage…</p>}>
      <TriageContent params={params} />
    </Suspense>
  );
}

async function TriageContent({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const supabase = await createClient();

  const { data: board } = await supabase
    .from("boards")
    .select("id, name")
    .eq("id", boardId)
    .single();
  if (!board) notFound();

  const { data: cards } = await supabase
    .from("cards")
    .select("id, title, created_at, closed_at")
    .eq("board_id", boardId)
    .is("triaged_at", null)
    .order("created_at");

  const queue = cards ?? [];

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <div>
        <Link href={`/boards/${boardId}`} className="text-sm text-muted-foreground hover:text-primary">
          ← Back to board
        </Link>
        <h1 className="text-2xl font-bold mt-2">Triage</h1>
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? "Nothing to triage — you're all caught up."
            : `${queue.length} card${queue.length === 1 ? "" : "s"} waiting to be processed.`}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {queue.map((card) => (
          <Card key={card.id} data-testid={`triage-${card.id}`} className="p-3 flex flex-col gap-2">
            <Link
              href={`/boards/${boardId}/cards/${card.id}`}
              className="font-medium hover:text-primary"
            >
              {card.title}
            </Link>
            <div className="flex flex-wrap gap-2">
              <form
                action={async () => {
                  "use server";
                  await markCardTriaged(card.id, boardId);
                }}
              >
                <Button type="submit" size="sm">
                  Keep
                </Button>
              </form>
              <form
                action={async () => {
                  "use server";
                  await postponeCard(card.id, boardId, 7);
                  await markCardTriaged(card.id, boardId);
                }}
              >
                <Button type="submit" size="sm" variant="outline">
                  Not now (1 week)
                </Button>
              </form>
              <form
                action={async () => {
                  "use server";
                  await toggleCardClosed(card.id, boardId);
                  await markCardTriaged(card.id, boardId);
                }}
              >
                <Button type="submit" size="sm" variant="outline">
                  Close
                </Button>
              </form>
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
