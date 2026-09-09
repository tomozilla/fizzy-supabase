import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalAccount, createBoard } from "@/app/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function BoardsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <BoardsPageContent />
    </Suspense>
  );
}

async function BoardsPageContent() {
  // Guarantees the personal workspace exists, but it's no longer the *only*
  // one that matters: a user who redeemed an invite belongs to several, and
  // every one of them should show up here. RLS already scopes these queries
  // to exactly the accounts they're a member of.
  const personalAccountId = await ensurePersonalAccount();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // Filter to *my* membership rows explicitly: RLS also lets me see my
  // teammates' rows in shared accounts (that's what powers the member roster
  // in settings), so without this the same workspace shows up once per
  // member — caught by the two-user invite e2e test.
  const { data: memberships } = await supabase
    .from("account_users")
    .select("account_id, role, accounts!inner(id, name)")
    .eq("user_id", auth?.user?.id ?? "")
    .order("created_at");

  const accounts = (memberships ?? []).map((m) => {
    const a = m.accounts as unknown as { id: string; name: string };
    return { id: a.id, name: a.name, role: m.role };
  });

  const { data: boards } = await supabase
    .from("boards")
    .select("id, name, description, account_id, created_at")
    .order("created_at", { ascending: false });

  async function createBoardAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const accountId = String(formData.get("account_id") ?? personalAccountId);
    if (!name) return;
    await createBoard(accountId, name);
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Boards</h1>
        <p className="text-sm text-muted-foreground">
          {accounts.length === 1
            ? accounts[0]?.name
            : `${accounts.length} workspaces`}
        </p>
      </div>

      <form action={createBoardAction} className="flex gap-2">
        <Input name="name" placeholder="New board name…" required className="flex-1" />
        {accounts.length > 1 && (
          <select
            name="account_id"
            aria-label="Workspace for the new board"
            defaultValue={personalAccountId}
            className="border rounded bg-background text-sm px-2"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit">Create board</Button>
      </form>

      {accounts.map((account) => {
        const accountBoards = (boards ?? []).filter((b) => b.account_id === account.id);
        return (
          <section key={account.id} data-testid={`workspace-${account.id}`}>
            {accounts.length > 1 && (
              <h2 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                {account.name}
              </h2>
            )}
            <ul className="flex flex-col gap-2">
              {accountBoards.map((board) => (
                <li key={board.id}>
                  <Link href={`/boards/${board.id}`}>
                    <Card className="px-4 py-3 hover:border-primary/50 hover:shadow-md transition-all">
                      <span className="font-medium">{board.name}</span>
                    </Card>
                  </Link>
                </li>
              ))}
              {accountBoards.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No boards in this workspace yet.
                </p>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
