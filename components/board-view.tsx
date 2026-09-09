"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { createColumn, createCard, moveCard, reorderCards } from "@/app/actions";

type Column = { id: string; name: string; position: number };
type Card = {
  id: string;
  title: string;
  column_id: string;
  position: number;
  closed_at: string | null;
};

function SortableCard({ card, boardId }: { card: Card; boardId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <li
      ref={setNodeRef}
      data-testid={`card-${card.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border rounded p-2 bg-accent/40 flex items-start gap-2 ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label="Drag to move card"
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground px-1 select-none"
      >
        ⠿
      </button>
      <Link
        href={`/boards/${boardId}/cards/${card.id}`}
        className="font-medium hover:underline flex-1"
      >
        {card.title}
      </Link>
    </li>
  );
}

function ColumnDropZone({
  column,
  cards,
  boardId,
  children,
}: {
  column: Column;
  cards: Card[];
  boardId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${column.id}`}
      className="min-w-[280px] border rounded-lg p-3 flex flex-col gap-3"
    >
      <h2 className="font-semibold">{column.name}</h2>

      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2 min-h-[2.5rem]">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} boardId={boardId} />
          ))}
        </ul>
      </SortableContext>

      {children}
    </div>
  );
}

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const cardsByColumn = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const col of columns) map[col.id] = [];
    for (const card of [...cards].sort((a, b) => a.position - b.position)) {
      (map[card.column_id] ??= []).push(card);
    }
    return map;
  }, [columns, cards]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;
    const sourceColumnId = activeCard.column_id;

    const overIsColumn = columns.some((c) => c.id === overId);
    const destColumnId = overIsColumn
      ? overId
      : (cards.find((c) => c.id === overId)?.column_id ?? sourceColumnId);

    const cardsInColumn = (columnId: string) =>
      cards
        .filter((c) => c.column_id === columnId && c.id !== activeId)
        .sort((a, b) => a.position - b.position);

    const destList = cardsInColumn(destColumnId);
    let insertAt = destList.length;
    if (!overIsColumn) {
      const idx = destList.findIndex((c) => c.id === overId);
      if (idx !== -1) insertAt = idx;
    }
    destList.splice(insertAt, 0, { ...activeCard, column_id: destColumnId });

    const updates = destList.map((c, i) => ({ cardId: c.id, columnId: destColumnId, position: i }));

    if (sourceColumnId !== destColumnId) {
      const sourceList = cardsInColumn(sourceColumnId);
      updates.push(...sourceList.map((c, i) => ({ cardId: c.id, columnId: sourceColumnId, position: i })));
    }

    const updateById = new Map(updates.map((u) => [u.cardId, u]));
    setCards((prev) =>
      prev.map((c) => {
        const update = updateById.get(c.id);
        return update ? { ...c, column_id: update.columnId, position: update.position } : c;
      }),
    );

    startTransition(async () => {
      await reorderCards(board.id, updates);
      router.refresh();
    });
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{board.name}</h1>

      {/* dnd-kit auto-generates its a11y-description id from a module-level
          counter otherwise, which drifts between the server render and the
          client's hydration pass (each client-side navigation bumps the
          counter further) — an explicit id keeps it deterministic. */}
      <DndContext
        id={`board-dnd-${board.id}`}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns
            .sort((a, b) => a.position - b.position)
            .map((column) => (
              <ColumnDropZone
                key={column.id}
                column={column}
                cards={cardsByColumn[column.id] ?? []}
                boardId={board.id}
              >
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

                {/* Accessible fallback for the drag handle above — same
                    underlying action, useful for keyboard/assistive tech
                    or anyone who'd rather not drag. */}
                {(cardsByColumn[column.id] ?? []).length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Move a card without dragging</summary>
                    <div className="flex flex-col gap-1 mt-1">
                      {(cardsByColumn[column.id] ?? []).map((card) => (
                        <div key={card.id} className="flex items-center gap-1">
                          <span className="truncate flex-1">{card.title}</span>
                          <select
                            aria-label={`Move "${card.title}" to another column`}
                            className="border rounded bg-background text-xs"
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
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </ColumnDropZone>
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
      </DndContext>
    </div>
  );
}
