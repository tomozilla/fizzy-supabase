import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board-view";

export default function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board…</p>}>
      <BoardPageContent params={params} />
    </Suspense>
  );
}

async function BoardPageContent({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const supabase = await createClient();

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
    .select("id, title, column_id, position, closed_at")
    .eq("board_id", boardId)
    .order("position");

  return (
    <BoardView
      board={board}
      initialColumns={columns ?? []}
      initialCards={cards ?? []}
    />
  );
}
