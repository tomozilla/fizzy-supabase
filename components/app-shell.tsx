import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { createClient } from "@/lib/supabase/server";

// Shared chrome for every signed-in page (boards, notifications, my stuff,
// settings). Auth itself is enforced by lib/supabase/proxy.ts per-request,
// so nothing here needs to re-check it — which also keeps the shell
// static-shell-friendly under Cache Components, with only the genuinely
// dynamic bits (auth button, unread count) inside Suspense boundaries.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-8 items-center">
        <nav className="w-full flex justify-center border-b h-16 bg-card">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex items-center gap-5">
              <Link href="/boards" className="flex items-center gap-2 font-semibold">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                fizzy<span className="text-primary">-supabase</span>
              </Link>
              <Link href="/boards" className="text-muted-foreground hover:text-foreground">
                Boards
              </Link>
              <Link href="/my" className="text-muted-foreground hover:text-foreground">
                My stuff
              </Link>
              <Link href="/search" className="text-muted-foreground hover:text-foreground">
                Search
              </Link>
              <Suspense fallback={<span className="text-muted-foreground">Inbox</span>}>
                <NotificationBell />
              </Suspense>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/settings"
                className="text-muted-foreground hover:text-foreground"
              >
                Settings
              </Link>
              <ThemeSwitcher />
              <Suspense>
                <AuthButton />
              </Suspense>
            </div>
          </div>
        </nav>
        <div className="flex-1 flex flex-col gap-8 w-full max-w-5xl p-5">{children}</div>
      </div>
    </main>
  );
}

async function NotificationBell() {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <Link href="/notifications" className="text-muted-foreground hover:text-foreground">
      Inbox
      {count ? (
        <span
          data-testid="unread-count"
          className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5"
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
