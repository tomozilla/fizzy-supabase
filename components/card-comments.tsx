"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addComment } from "@/app/actions";

type Comment = {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
};

export function CardComments({
  cardId,
  boardId,
  initialComments,
  memberNames,
}: {
  cardId: string;
  boardId: string;
  initialComments: Comment[];
  memberNames: Record<string, string>;
}) {
  const [comments, setComments] = useState(initialComments);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`card-comments:${cardId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `card_id=eq.${cardId}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            body: string;
            created_at: string;
            author_id: string | null;
          };
          setComments((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                body: row.body,
                created_at: row.created_at,
                author_name: (row.author_id && memberNames[row.author_id]) || "Someone",
              },
            ];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cardId, memberNames]);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <li key={c.id} className="border rounded p-2 text-sm">
            <div className="font-medium">{c.author_name}</div>
            <div>{c.body}</div>
          </li>
        ))}
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
      </ul>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const body = String(new FormData(form).get("body") ?? "").trim();
          if (!body) return;
          form.reset();
          await addComment(cardId, boardId, body);
        }}
        className="flex gap-2"
      >
        <input
          name="body"
          placeholder="Write a comment… (@name to mention)"
          required
          className="border rounded px-2 py-1 text-sm flex-1 bg-background"
        />
        <button type="submit" className="text-xs border rounded px-3 py-1">
          Comment
        </button>
      </form>
    </div>
  );
}
