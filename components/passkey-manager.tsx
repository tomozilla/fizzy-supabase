"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Passkey = { id: string; friendly_name?: string | null; created_at?: string | null };

/**
 * Register and manage passkeys — Supabase Auth runs the whole WebAuthn
 * ceremony (`registerPasskey` calls navigator.credentials.create() and
 * verifies with the server), where Fizzy hand-rolls it in
 * Passkey::Authenticator.
 */
export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw error;
      setPasskeys((data ?? []) as Passkey[]);
    } catch (err) {
      // Passkeys are a project-level toggle; if the project has them off,
      // say so plainly rather than showing a broken control.
      setSupported(false);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && !window.PublicKeyCredential) {
      setSupported(false);
      setStatus("This browser doesn't support passkeys.");
      return;
    }
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {passkeys.map((pk) => (
          <Card
            key={pk.id}
            data-testid={`passkey-${pk.id}`}
            className="px-3 py-2 flex items-center gap-2 text-sm"
          >
            <span className="flex-1">🔑 {pk.friendly_name || "Passkey"}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const supabase = createClient();
                  await supabase.auth.passkey.delete({ passkeyId: pk.id });
                  await refresh();
                  setStatus("Passkey removed.");
                } catch (err) {
                  setStatus(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          </Card>
        ))}
        {supported && passkeys.length === 0 && (
          <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
        )}
      </ul>

      {supported && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setStatus(null);
              try {
                const supabase = createClient();
                const { error } = await supabase.auth.registerPasskey();
                if (error) throw error;
                await refresh();
                setStatus("Passkey registered.");
              } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : "Add a passkey"}
          </Button>
        </div>
      )}

      {status && (
        <span data-testid="passkey-status" className="text-xs text-muted-foreground">
          {status}
        </span>
      )}
    </div>
  );
}
