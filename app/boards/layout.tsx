import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";

// Auth is enforced by lib/supabase/proxy.ts (runs per-request, before this
// layout renders) — no need to re-check here, which also keeps this layout
// itself static-shell-friendly under Cache Components.
export default function BoardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-8 items-center">
        <nav className="w-full flex justify-center border-b h-16 bg-card">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <Link href="/boards" className="flex items-center gap-2 font-semibold">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
              fizzy<span className="text-primary">-supabase</span>
            </Link>
            <div className="flex items-center gap-3">
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
