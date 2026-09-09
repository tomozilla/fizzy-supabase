"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createColumn, createCard, moveCard } from "@/app/actions";

type Column = { id: string; name: string; position: number };
type Card = {
  id: string;
  title: string;
  column_id: string;
  position: number;
  closed_at: string | null;
};

export function BoardView({
  board,
  initialColumns,
  initialCards,
}: {
  board: { id: string; name: string; account_id: string };
  initialColumns: Column[];
  initialCards: Card[];
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [cards, setCards] = useState(initialCards);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // initialColumns/initialCards are only used to seed state on first mount —
  // React doesn't re-sync useState from changed props on its own, so without
  // this, a `router.refresh()` after the *actor's own* mutation would fetch
  // fresh data from the server but never actually reach this component's
  // rendered list. Realtime (below) is what propagates *other* clients'
  // changes; this effect is what makes the actor's own action feel instant
  // instead of waiting on a websocket round-trip for their own edit.
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);
  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  // Live sync: any tab/user editing this board shows up here immediately,
  // via Supabase Realtime's postgres_changes — the equivalent of Fizzy
  // broadcasting Turbo Streams over ActionCable on the same events.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    (async () => {
      // Wait for the browser client to hydrate its session from cookies
      // before joining: subscribing immediately on mount can join the
      // channel before Realtime has an access token to authorize with,
      // silently under-authorizing it for RLS-gated postgres_changes for
      // the lifetime of that subscription (caught via a genuine cross-tab
      // Playwright test, not a hypothetical — a fresh browser context's
      // first realtime subscription never received row changes until this
      // await was added).
      await supabase.auth.getSession();
      if (cancelled) return;

      channel = supabase
        .channel(`board:${board.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cards", filter: `board_id=eq.${board.id}` },
          (payload) => {
            setCards((prev) => {
              if (payload.eventType === "DELETE") {
                return prev.filter((c) => c.id !== (payload.old as Card).id);
              }
              const next = payload.new as Card;
              const withoutOld = prev.filter((c) => c.id !== next.id);
              return [...withoutOld, next];
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "columns", filter: `board_id=eq.${board.id}` },
          (payload) => {
            setColumns((prev) => {
              if (payload.eventType === "DELETE") {
                return prev.filter((c) => c.id !== (payload.old as Column).id);
              }
              const next = payload.new as Column;
              const withoutOld = prev.filter((c) => c.id !== next.id);
              return [...withoutOld, next].sort((a, b) => a.position - b.position);
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [board.id]);

  return (
    <div className="flex-1 w-full flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{board.name}</h1>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns
          .sort((a, b) => a.position - b.position)
          .map((column) => (
            <div
              key={column.id}
              data-testid={`column-${column.id}`}
              className="min-w-[280px] border rounded-lg p-3 flex flex-col gap-3"
            >
              <h2 className="font-semibold">{column.name}</h2>

              <ul className="flex flex-col gap-2">
                {cards
                  .filter((c) => c.column_id === column.id)
                  .sort((a, b) => a.position - b.position)
                  .map((card) => (
                    <li key={card.id} data-testid={`card-${card.id}`} className="border rounded p-2 bg-accent/40">
                      <Link
                        href={`/boards/${board.id}/cards/${card.id}`}
                        className="font-medium hover:underline block"
                      >
                        {card.title}
                      </Link>
                      <select
                        className="mt-2 text-xs border rounded bg-background w-full"
                        value={card.column_id}
                        onChange={(e) => {
                          const newColumnId = e.target.value;
                          startTransition(async () => {
                            await moveCard(card.id, board.id, newColumnId);
                            router.refresh();
                          });
                        }}
                      >
                        {columns.map((col) => (
                          <option key={col.id} value={col.id}>
                            Move to: {col.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
              </ul>

              <form
                action={async (formData: FormData) => {
                  const title = String(formData.get("title") ?? "").trim();
                  if (!title) return;
                  await createCard(board.id, column.id, board.account_id, title);
                  router.refresh();
                }}
                className="flex flex-col gap-1"
              >
                <input
                  name="title"
                  placeholder="New card…"
                  required
                  className="border rounded px-2 py-1 text-sm bg-background"
                />
                <button type="submit" className="text-xs border rounded px-2 py-1">
                  Add card
                </button>
              </form>
            </div>
          ))}

        <form
          action={async (formData: FormData) => {
            const name = String(formData.get("name") ?? "").trim();
            if (!name) return;
            await createColumn(board.id, board.account_id, name);
            router.refresh();
          }}
          className="min-w-[220px] border border-dashed rounded-lg p-3 flex flex-col gap-2 h-fit"
        >
          <input
            name="name"
            placeholder="New column…"
            required
            className="border rounded px-2 py-1 text-sm bg-background"
          />
          <button type="submit" className="text-xs border rounded px-2 py-1">
            Add column
          </button>
        </form>
      </div>
    </div>
  );
}
