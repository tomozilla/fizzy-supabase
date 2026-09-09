import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

// Fizzy's User::Assignee / Watcher / Pinnable surfaces, gathered into one
// personal view: the cards this user is actually on the hook for.
export default function MyPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <MyContent />
    </Suspense>
  );
}

type CardRow = {
  id: string;
  title: string;
  board_id: string;
  closed_at: string | null;
  golden_at: string | null;
};

function CardList({ cards, empty }: { cards: CardRow[]; empty: string }) {
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {cards.map((c) => (
        <Card key={c.id} className="px-3 py-2">
          <Link
            href={`/boards/${c.board_id}/cards/${c.id}`}
            className={`text-sm hover:text-primary ${c.closed_at ? "line-through text-muted-foreground" : ""}`}
          >
            {c.golden_at ? "⭐ " : ""}
            {c.title}
          </Link>
        </Card>
      ))}
    </ul>
  );
}

async function MyContent() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? "";

  const cardFields = "id, title, board_id, closed_at, golden_at";

  const [{ data: assigned }, { data: watching }, { data: pinned }] = await Promise.all([
    supabase.from("assignments").select(`cards!inner(${cardFields})`).eq("user_id", userId),
    supabase.from("watches").select(`cards!inner(${cardFields})`).eq("user_id", userId),
    supabase.from("pins").select(`cards!inner(${cardFields})`).eq("user_id", userId),
  ]);

  const unwrap = (rows: unknown): CardRow[] =>
    ((rows ?? []) as { cards: CardRow }[]).map((r) => r.cards).filter(Boolean);

  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <h1 className="text-2xl font-bold">My stuff</h1>

      <section>
        <h2 className="font-semibold text-sm mb-2">Assigned to me</h2>
        <CardList cards={unwrap(assigned)} empty="Nothing assigned to you." />
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Watching</h2>
        <CardList cards={unwrap(watching)} empty="You're not watching any cards." />
      </section>

      <section>
        <h2 className="font-semibold text-sm mb-2">Pinned</h2>
        <CardList cards={unwrap(pinned)} empty="No pinned cards." />
      </section>
    </div>
  );
}
