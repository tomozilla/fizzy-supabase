import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";

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
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href="/boards">fizzy-supabase</Link>
            </div>
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </nav>
        <div className="flex-1 flex flex-col gap-8 w-full max-w-5xl p-5">{children}</div>
      </div>
    </main>
  );
}
