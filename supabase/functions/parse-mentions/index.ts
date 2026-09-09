// parse-mentions: called after a comment is created with the list of
// @mentioned user ids the client's mention-picker resolved. This function
// re-validates them server-side (never trust the client's list blindly),
// records `mentions` rows, and fans out a notification event — the same job
// Fizzy's `Comment::Mentions` concern + `Notifier::MentionNotifier` do inside
// a Rails request/job, just running as a standalone Deno function here.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const { comment_id, mentioned_user_ids } = await req.json();

    if (!comment_id || !Array.isArray(mentioned_user_ids)) {
      return new Response(
        JSON.stringify({ error: "comment_id and mentioned_user_ids are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: comment, error: commentError } = await supabase
      .from("comments")
      .select("id, account_id, card_id, author_id, cards(board_id)")
      .eq("id", comment_id)
      .single();

    if (commentError || !comment) {
      return new Response(JSON.stringify({ error: "comment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only mention users who are actually members of this comment's account.
    const { data: members } = await supabase
      .from("account_users")
      .select("user_id")
      .eq("account_id", comment.account_id)
      .in("user_id", mentioned_user_ids);

    const validUserIds = (members ?? []).map((m) => m.user_id);

    if (validUserIds.length === 0) {
      return new Response(JSON.stringify({ inserted: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await supabase
      .from("mentions")
      .insert(validUserIds.map((uid) => ({ comment_id, mentioned_user_id: uid })));

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: event } = await supabase
      .from("events")
      .insert({
        account_id: comment.account_id,
        // Include board_id so the notification inbox can link straight to
        // the card (a comment event without it renders as dead text).
        board_id: (comment.cards as { board_id: string } | null)?.board_id ?? null,
        card_id: comment.card_id,
        actor_id: comment.author_id,
        kind: "comment.mentioned",
        data: { comment_id, mentioned_user_ids: validUserIds },
      })
      .select("id")
      .single();

    if (event) {
      await supabase
        .from("notifications")
        .insert(validUserIds.map((uid) => ({ user_id: uid, event_id: event.id })));
    }

    return new Response(JSON.stringify({ inserted: validUserIds.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
