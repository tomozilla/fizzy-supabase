import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Search UI over the Postgres full-text indexes that have existed since the
// initial schema but had no way to actually query them from the app.
// Fizzy equivalent: Search::Query / Search::Result, except the index here is
// one native GIN index rather than 16 CRC32-sharded MySQL tables.
export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <SearchContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SearchContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q.trim() : "";

  const supabase = await createClient();

  const [cardResults, commentResults] = query
    ? await Promise.all([
        supabase
          .from("cards")
          .select("id, title, board_id, closed_at")
          .textSearch("search_vector", query, { type: "websearch" })
          .limit(25),
        supabase
          .from("comments")
          .select("id, body, card_id, cards!inner(title, board_id)")
          .textSearch("search_vector", query, { type: "websearch" })
          .limit(25),
      ])
    : [{ data: [] }, { data: [] }];

  const cards = cardResults.data ?? [];
  const comments = (commentResults.data ?? []) as unknown as {
    id: string;
    body: string;
    card_id: string;
    cards: { title: string; board_id: string };
  }[];

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Search</h1>

      <form method="GET" className="flex gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search cards and comments…"
          aria-label="Search cards and comments"
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>

      {query && (
        <>
          <section>
            <h2 className="font-semibold text-sm mb-2">
              Cards{" "}
              <span className="font-normal text-muted-foreground">({cards.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {cards.map((c) => (
                <Card key={c.id} className="px-3 py-2">
                  <Link
                    href={`/boards/${c.board_id}/cards/${c.id}`}
                    className={`text-sm hover:text-primary ${c.closed_at ? "line-through text-muted-foreground" : ""}`}
                  >
                    {c.title}
                  </Link>
                </Card>
              ))}
              {cards.length === 0 && (
                <p className="text-sm text-muted-foreground">No matching cards.</p>
              )}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-sm mb-2">
              Comments{" "}
              <span className="font-normal text-muted-foreground">({comments.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {comments.map((c) => (
                <Card key={c.id} className="px-3 py-2">
                  <Link
                    href={`/boards/${c.cards.board_id}/cards/${c.card_id}`}
                    className="text-sm hover:text-primary"
                  >
                    <span className="text-muted-foreground">on {c.cards.title}: </span>
                    {c.body.slice(0, 120)}
                  </Link>
                </Card>
              ))}
              {comments.length === 0 && (
                <p className="text-sm text-muted-foreground">No matching comments.</p>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
