"use client";

import { useState } from "react";

/** Shows an invite link and copies it to the clipboard on click. */
export function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      data-testid="invite-link"
      className="flex-1 text-left font-mono text-xs truncate hover:text-primary"
      onClick={async () => {
        const url = `${window.location.origin}/join/${code}`;
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked (permissions, insecure context) — the
          // link text is still visible and selectable either way.
        }
      }}
    >
      {copied ? "Copied!" : `/join/${code}`}
    </button>
  );
}
