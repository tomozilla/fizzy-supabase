import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  ensurePersonalAccount,
  createJoinCode,
  revokeJoinCode,
  updateProfile,
  createWebhook,
  deleteWebhook,
  leaveAccount,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AvatarUploader } from "@/components/avatar-uploader";
import { CopyableCode } from "@/components/copyable-code";

// Combines what Fizzy splits across account admin, user settings and the
// webhooks screen: your profile, then one block per workspace you belong to
// (members, invite links, storage usage, outgoing webhooks).
export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <SettingsContent />
    </Suspense>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function SettingsContent() {
  const personalAccountId = await ensurePersonalAccount();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? "";

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", userId).single(),
    // Only my own membership rows — RLS also exposes teammates' rows in
    // shared accounts (used for the roster below), which would otherwise
    // render one settings block per member of the same workspace.
    supabase
      .from("account_users")
      .select("account_id, accounts!inner(id, name)")
      .eq("user_id", userId),
  ]);

  const accounts = (memberships ?? []).map((m) => {
    const a = m.accounts as unknown as { id: string; name: string };
    return a;
  });

  return (
    <div className="flex-1 w-full flex flex-col gap-10 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Your profile</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            const name = String(formData.get("full_name") ?? "").trim();
            if (!name) return;
            await updateProfile(name);
          }}
          className="flex gap-2"
        >
          <Input
            name="full_name"
            defaultValue={profile?.full_name ?? ""}
            placeholder="Your display name"
            aria-label="Your display name"
            className="max-w-[280px]"
          />
          <Button type="submit" size="sm">
            Save name
          </Button>
        </form>
        <AvatarUploader userId={userId} currentUrl={profile?.avatar_url ?? null} />
      </section>

      {accounts.map((account) => (
        <Suspense key={account.id} fallback={null}>
          <WorkspaceSettings
            accountId={account.id}
            accountName={account.name}
            isPersonal={account.id === personalAccountId}
          />
        </Suspense>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Your data</h2>
        <p className="text-sm text-muted-foreground">
          Export everything you can see as JSON — boards, columns, cards,
          comments, tags and checklists.
        </p>
        <div>
          <Button asChild size="sm" variant="outline">
            <a href="/api/export" download>
              Export data (JSON)
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

async function WorkspaceSettings({
  accountId,
  accountName,
  isPersonal,
}: {
  accountId: string;
  accountName: string;
  isPersonal: boolean;
}) {
  const supabase = await createClient();

  const [{ data: members }, { data: codes }, { data: attachments }, { data: webhooks }] =
    await Promise.all([
      supabase
        .from("account_users")
        .select("user_id, role, profiles!inner(full_name, avatar_url)")
        .eq("account_id", accountId),
      supabase
        .from("account_join_codes")
        .select("id, code, expires_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase.from("attachments").select("byte_size").eq("account_id", accountId),
      supabase
        .from("webhooks")
        .select("id, url, active")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
    ]);

  const storageUsed = (attachments ?? []).reduce((sum, a) => sum + (a.byte_size ?? 0), 0);

  return (
    <section data-testid={`workspace-settings-${accountId}`} className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">
          {accountName}
          {isPersonal && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (your personal workspace)
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {(members ?? []).length} member{(members ?? []).length === 1 ? "" : "s"} ·{" "}
          {formatBytes(storageUsed)} of attachments
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {(members ?? []).map((m) => {
          const p = m.profiles as unknown as {
            full_name: string | null;
            avatar_url: string | null;
          };
          return (
            <Card
              key={m.user_id}
              data-testid={`member-${m.user_id}`}
              className="px-3 py-2 flex items-center gap-3 text-sm"
            >
              {p?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <span className="h-6 w-6 rounded-full bg-secondary" aria-hidden />
              )}
              <span className="flex-1">{p?.full_name ?? "Member"}</span>
              <span className="text-xs text-muted-foreground">{m.role}</span>
            </Card>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <form
          action={async () => {
            "use server";
            await createJoinCode(accountId);
          }}
        >
          <Button type="submit" size="sm" variant="outline">
            Create invite link
          </Button>
        </form>
        {!isPersonal && (
          <form
            action={async () => {
              "use server";
              await leaveAccount(accountId);
            }}
          >
            <Button type="submit" size="sm" variant="ghost">
              Leave workspace
            </Button>
          </form>
        )}
      </div>

      {(codes ?? []).length > 0 && (
        <ul className="flex flex-col gap-2">
          {(codes ?? []).map((c) => (
            <Card
              key={c.id}
              data-testid={`join-code-${c.id}`}
              className="px-3 py-2 flex items-center gap-2 text-sm"
            >
              <CopyableCode code={c.code} />
              <form
                action={async () => {
                  "use server";
                  await revokeJoinCode(c.id);
                }}
              >
                <Button type="submit" size="sm" variant="ghost">
                  Revoke
                </Button>
              </form>
            </Card>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Outgoing webhooks</h3>
        <form
          action={async (formData: FormData) => {
            "use server";
            const url = String(formData.get("url") ?? "").trim();
            if (!url) return;
            await createWebhook(accountId, url);
          }}
          className="flex gap-2"
        >
          <Input
            name="url"
            type="url"
            placeholder="https://example.com/hook"
            aria-label={`Webhook URL for ${accountName}`}
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="outline">
            Add webhook
          </Button>
        </form>
        <ul className="flex flex-col gap-2">
          {(webhooks ?? []).map((w) => (
            <Card
              key={w.id}
              data-testid={`webhook-${w.id}`}
              className="px-3 py-2 flex items-center gap-2 text-sm"
            >
              <span className="flex-1 truncate">{w.url}</span>
              <form
                action={async () => {
                  "use server";
                  await deleteWebhook(w.id);
                }}
              >
                <Button type="submit" size="sm" variant="ghost">
                  Remove
                </Button>
              </form>
            </Card>
          ))}
          {(webhooks ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No webhooks configured.</p>
          )}
        </ul>
      </div>
    </section>
  );
}
