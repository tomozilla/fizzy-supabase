"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addAttachment } from "@/app/actions";

export function AttachmentUploader({
  cardId,
  boardId,
  accountId,
}: {
  cardId: string;
  boardId: string;
  accountId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <input
        type="file"
        disabled={uploading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;

          setUploading(true);
          setError(null);
          try {
            const supabase = createClient();
            const path = `${accountId}/${cardId}/${Date.now()}-${file.name}`;

            const { error: uploadError } = await supabase.storage
              .from("card-attachments")
              .upload(path, file);

            if (uploadError) throw uploadError;

            await addAttachment(
              cardId,
              boardId,
              accountId,
              path,
              file.name,
              file.type,
              file.size,
            );
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setUploading(false);
          }
        }}
        className="text-sm"
      />
      {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
