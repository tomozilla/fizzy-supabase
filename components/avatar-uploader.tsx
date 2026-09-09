"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "@/app/actions";

/**
 * Uploads to the public `avatars` bucket under `{user_id}/…`, which is the
 * path prefix the storage RLS policy checks — same "encode the owner in the
 * object path" pattern as card attachments, just scoped to a user rather
 * than an account.
 */
export function AvatarUploader({
  userId,
  currentUrl,
}: {
  userId: string;
  currentUrl: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-3">
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt="Your avatar" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <span className="h-10 w-10 rounded-full bg-secondary" aria-hidden />
      )}

      <div className="flex flex-col gap-1">
        <input
          type="file"
          accept="image/*"
          aria-label="Upload avatar"
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;

            setUploading(true);
            setError(null);
            try {
              const supabase = createClient();
              const path = `${userId}/${Date.now()}-${file.name}`;
              const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(path, file, { upsert: true });
              if (uploadError) throw uploadError;

              const {
                data: { publicUrl },
              } = supabase.storage.from("avatars").getPublicUrl(path);

              const { data: profile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", userId)
                .single();

              await updateProfile(profile?.full_name ?? "", publicUrl);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setUploading(false);
            }
          }}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
