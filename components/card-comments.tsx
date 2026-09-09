"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addComment } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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
  const router = useRouter();

  // See board-view.tsx for why this is needed alongside the realtime
  // subscription below: without it, this component's own author never sees
  // their own comment until the websocket round-trip completes.
  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    (async () => {
      // See board-view.tsx for why this await matters: joining before the
      // session is hydrated can under-authorize this subscription for RLS
      // for its whole lifetime.
      await supabase.auth.getSession();
      if (cancelled) return;

      channel = supabase
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
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [cardId, memberNames]);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <Card key={c.id} className="p-2 text-sm bg-secondary/30 border-secondary">
            <div className="font-medium text-primary">{c.author_name}</div>
            <div>{c.body}</div>
          </Card>
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
          router.refresh();
        }}
        className="flex gap-2"
      >
        <Input
          name="body"
          placeholder="Write a comment… (@name to mention)"
          required
          className="text-sm flex-1"
        />
        <Button type="submit" size="sm" variant="secondary">
          Comment
        </Button>
      </form>
    </div>
  );
}
