"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { importWorkspace } from "@/app/actions";

/** Reads an exported JSON file client-side and hands the text to the import action. */
export function WorkspaceImporter({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Import workspace JSON"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;

          setBusy(true);
          setStatus(null);
          try {
            const text = await file.text();
            const result = await importWorkspace(accountId, text);
            setStatus(`Imported ${result.boards} board(s) and ${result.cards} card(s).`);
            router.refresh();
          } catch (err) {
            setStatus(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
        className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
      />
      {busy && <span className="text-xs text-muted-foreground">Importing…</span>}
      {status && (
        <span data-testid="import-status" className="text-xs text-muted-foreground">
          {status}
        </span>
      )}
    </div>
  );
}
