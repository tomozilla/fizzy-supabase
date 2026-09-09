import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) redirect("/boards");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 text-center relative">
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>

      <div className="flex flex-col gap-3 max-w-xl items-center">
        <span className="inline-block rounded-full bg-accent text-accent-foreground text-xs font-medium px-3 py-1 mb-2">
          Built on Supabase
        </span>
        <h1 className="text-4xl font-bold">
          fizzy<span className="text-primary">-supabase</span>
        </h1>
        <p className="text-muted-foreground">
          A personal learning project: a kanban board app built on Next.js +
          Supabase, inspired by the idea of{" "}
          <a
            href="https://github.com/basecamp/fizzy"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Fizzy
          </a>{" "}
          (not affiliated with, and no code copied from, 37signals/Basecamp —
          see the README for details). Boards, cards, comments, realtime sync,
          file attachments, and more.
        </p>
      </div>

      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/auth/login">Log in</Link>
        </Button>
        <Button asChild>
          <Link href="/auth/sign-up">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}
