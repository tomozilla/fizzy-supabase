import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        // Passkeys are behind an opt-in flag in auth-js; without it every
        // `auth.passkey.*` / signInWithPasskey call throws at call time.
        experimental: { passkey: true },
      },
    },
  );
}
