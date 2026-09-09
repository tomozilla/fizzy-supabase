import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalAccount, saveFilter, deleteFilter } from "@/app/actions";
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

  const accountId = await ensurePersonalAccount();
  const supabase = await createClient();

  const { data: savedFilters } = await supabase
    .from("filters")
    .select("id, name, query")
    .order("created_at", { ascending: false });

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

      {/* Saved searches — Fizzy's Filter model, scoped per user by RLS. */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {(savedFilters ?? []).map((f) => (
            <span
              key={f.id}
              data-testid={`filter-${f.id}`}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              <Link href={`/search?q=${encodeURIComponent(f.query)}`} className="hover:text-primary">
                {f.name}
              </Link>
              <form
                action={async () => {
                  "use server";
                  await deleteFilter(f.id);
                }}
              >
                <button
                  type="submit"
                  aria-label={`Delete saved search "${f.name}"`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </form>
            </span>
          ))}
        </div>

        {query && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const name = String(formData.get("name") ?? "").trim() || query;
              await saveFilter(accountId, name, query);
            }}
            className="flex gap-2"
          >
            <Input
              name="name"
              placeholder={`Name this search (default: "${query}")`}
              aria-label="Name for this saved search"
              className="max-w-[280px] h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="outline">
              Save search
            </Button>
          </form>
        )}
      </section>

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
