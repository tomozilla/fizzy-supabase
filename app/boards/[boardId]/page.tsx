import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board-view";
import { Button } from "@/components/ui/button";

export default function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board…</p>}>
      <BoardPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BoardPageContent({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { boardId } = await params;
  const sp = await searchParams;
  const showPostponed = sp.postponed === "1";
  const showClosed = sp.closed === "1";

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const { data: board } = await supabase
    .from("boards")
    .select("id, name, account_id")
    .eq("id", boardId)
    .single();

  if (!board) notFound();

  const { data: columns } = await supabase
    .from("columns")
    .select("id, name, position")
    .eq("board_id", boardId)
    .order("position");

  const { data: cards } = await supabase
    .from("cards")
    .select("id, title, column_id, position, closed_at, golden_at, not_now_until, triaged_at")
    .eq("board_id", boardId)
    .order("position");

  const { data: pins } = await supabase
    .from("pins")
    .select("card_id")
    .eq("user_id", auth?.user?.id ?? "");

  const pinnedIds = new Set((pins ?? []).map((p) => p.card_id));
  const now = Date.now();

  // Postponed ("not now") cards drop off the board until their date passes —
  // Fizzy's Card::NotNow behavior — unless explicitly revealed. Closed cards
  // are hidden by default too, same as a done-and-dusted card in Fizzy.
  const visibleCards = (cards ?? []).filter((c) => {
    const postponed = c.not_now_until !== null && new Date(c.not_now_until).getTime() > now;
    if (postponed && !showPostponed) return false;
    if (c.closed_at && !showClosed) return false;
    return true;
  });

  const hiddenPostponed = (cards ?? []).filter(
    (c) => c.not_now_until !== null && new Date(c.not_now_until).getTime() > now,
  ).length;
  const hiddenClosed = (cards ?? []).filter((c) => c.closed_at).length;
  const untriaged = (cards ?? []).filter((c) => c.triaged_at === null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button asChild size="sm" variant="outline">
          <Link href={`/boards/${boardId}/triage`}>
            Triage{untriaged > 0 ? ` (${untriaged})` : ""}
          </Link>
        </Button>
        <Button asChild size="sm" variant={showPostponed ? "secondary" : "ghost"}>
          <Link
            href={`/boards/${boardId}?${new URLSearchParams({
              ...(showClosed ? { closed: "1" } : {}),
              ...(showPostponed ? {} : { postponed: "1" }),
            })}`}
          >
            {showPostponed ? "Hide postponed" : `Show postponed (${hiddenPostponed})`}
          </Link>
        </Button>
        <Button asChild size="sm" variant={showClosed ? "secondary" : "ghost"}>
          <Link
            href={`/boards/${boardId}?${new URLSearchParams({
              ...(showPostponed ? { postponed: "1" } : {}),
              ...(showClosed ? {} : { closed: "1" }),
            })}`}
          >
            {showClosed ? "Hide closed" : `Show closed (${hiddenClosed})`}
          </Link>
        </Button>
      </div>

      <BoardView
        board={board}
        initialColumns={columns ?? []}
        initialCards={visibleCards}
        pinnedCardIds={[...pinnedIds]}
      />
    </div>
  );
}
