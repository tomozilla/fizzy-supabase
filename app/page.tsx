import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

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
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col gap-3 max-w-xl">
        <h1 className="text-3xl font-bold">fizzy-supabase</h1>
        <p className="text-muted-foreground">
          A personal learning project: a kanban board app built on Next.js +
          Supabase, inspired by the idea of{" "}
          <a
            href="https://github.com/basecamp/fizzy"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Fizzy
          </a>{" "}
          (not affiliated with, and no code copied from, 37signals/Basecamp —
          see the README for details). Boards, cards, comments, realtime sync,
          file attachments, and more.
        </p>
      </div>

      <div className="flex gap-4">
        <Link href="/auth/login" className="border rounded px-4 py-2 font-medium">
          Log in
        </Link>
        <Link href="/auth/sign-up" className="border rounded px-4 py-2 font-medium">
          Sign up
        </Link>
      </div>
    </main>
  );
}
