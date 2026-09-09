import { Suspense } from "react";
import Link from "next/link";
import { redeemJoinCode } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Landing page for an invite link. Auth is enforced by proxy.ts, so anyone
// reaching this is signed in; redeeming itself goes through the
// SECURITY DEFINER redeem_join_code function (a non-member can't read the
// code row or insert their own membership under RLS).
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Checking invite…</p>}>
        <JoinContent params={params} />
      </Suspense>
    </main>
  );
}

async function JoinContent({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <Card className="p-6 flex flex-col gap-4 max-w-sm w-full text-center">
      <h1 className="text-xl font-bold">Join this workspace?</h1>
      <p className="text-sm text-muted-foreground">
        You&apos;ve been invited to collaborate. Accepting adds you as a member.
      </p>
      <form
        action={async () => {
          "use server";
          const accountId = await redeemJoinCode(code);
          const { redirect } = await import("next/navigation");
          redirect(accountId ? "/boards" : `/join/${code}?invalid=1`);
        }}
      >
        <Button type="submit" className="w-full">
          Accept invite
        </Button>
      </form>
      <Button asChild variant="ghost" size="sm">
        <Link href="/boards">No thanks</Link>
      </Button>
    </Card>
  );
}
