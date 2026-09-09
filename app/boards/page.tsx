import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalAccount, createBoard } from "@/app/actions";
import Link from "next/link";

export default function BoardsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <BoardsPageContent />
    </Suspense>
  );
}

async function BoardsPageContent() {
  const accountId = await ensurePersonalAccount();
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("accounts")
    .select("name")
    .eq("id", accountId)
    .single();

  const { data: boards } = await supabase
    .from("boards")
    .select("id, name, description, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  async function createBoardAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await createBoard(accountId, name);
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">{account?.name ?? "Your workspace"}</h1>
        <p className="text-sm text-muted-foreground">Boards</p>
      </div>

      <form action={createBoardAction} className="flex gap-2">
        <input
          name="name"
          placeholder="New board name…"
          required
          className="border rounded px-3 py-2 flex-1 bg-background"
        />
        <button type="submit" className="border rounded px-4 py-2 font-medium">
          Create board
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {(boards ?? []).map((board) => (
          <li key={board.id}>
            <Link
              href={`/boards/${board.id}`}
              className="block border rounded px-4 py-3 hover:bg-accent transition-colors"
            >
              <span className="font-medium">{board.name}</span>
            </Link>
          </li>
        ))}
        {(boards ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No boards yet — create your first one above.</p>
        )}
      </ul>
    </div>
  );
}
