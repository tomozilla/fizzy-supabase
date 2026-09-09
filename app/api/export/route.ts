import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Workspace export — Fizzy's Account::Export / data_transfer, simplified to
 * JSON rather than a streamed zip (its archives can run to hundreds of GB;
 * this app's can't yet).
 *
 * Every query below runs as the signed-in user, so RLS decides what ends up
 * in the file: you can only ever export data from accounts you're a member
 * of, without this route doing a single permission check of its own.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [
    { data: accounts },
    { data: boards },
    { data: columns },
    { data: cards },
    { data: comments },
    { data: tags },
    { data: taggings },
    { data: steps },
    { data: attachments },
  ] = await Promise.all([
    supabase.from("accounts").select("id, name, slug, created_at"),
    supabase.from("boards").select("id, account_id, name, description, created_at"),
    supabase.from("columns").select("id, board_id, name, position"),
    supabase
      .from("cards")
      .select(
        "id, board_id, column_id, title, description, position, closed_at, golden_at, not_now_until, created_at",
      ),
    supabase.from("comments").select("id, card_id, body, created_at"),
    supabase.from("tags").select("id, account_id, name"),
    supabase.from("taggings").select("card_id, tag_id"),
    supabase.from("steps").select("id, card_id, title, position, completed_at"),
    supabase.from("attachments").select("id, card_id, filename, byte_size, created_at"),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    format_version: 1,
    accounts: accounts ?? [],
    boards: boards ?? [],
    columns: columns ?? [],
    cards: cards ?? [],
    comments: comments ?? [],
    tags: tags ?? [],
    taggings: taggings ?? [],
    steps: steps ?? [],
    attachments: attachments ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="fizzy-supabase-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}
