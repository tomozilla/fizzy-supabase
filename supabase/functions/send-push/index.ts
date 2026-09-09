// send-push: delivers a web-push "nudge" to every subscription belonging to
// the users notified by an event. Fizzy's equivalent is
// Notification::Pushable / Notification::PushTarget::Web, delivered from a
// Solid Queue job with the web-push gem.
//
// Deliberately sends *bodyless* pushes: VAPID-authenticated, but with no
// encrypted payload. That skips RFC 8291 (aes128gcm) entirely — the service
// worker shows a generic "new activity" notification and links into the
// inbox, which loads the real content over an authenticated request. Less
// code, and no notification content sitting in a third-party push service.
import { createClient } from "jsr:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com";

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Sign the VAPID JWT (ES256) for one push endpoint's origin. */
async function vapidAuthHeader(audience: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  };

  const encoder = new TextEncoder();
  const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  )}`;

  // The private key is the raw 32-byte P-256 scalar (`d`); rebuild a JWK so
  // Web Crypto will import it.
  const publicKeyBytes = base64UrlDecode(VAPID_PUBLIC_KEY);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: VAPID_PRIVATE_KEY,
    x: base64UrlEncode(publicKeyBytes.slice(1, 33)),
    y: base64UrlEncode(publicKeyBytes.slice(33, 65)),
    ext: true,
  };

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput),
  );

  return `vapid t=${signingInput}.${base64UrlEncode(new Uint8Array(signature))}, k=${VAPID_PUBLIC_KEY}`;
}

Deno.serve(async (req) => {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ error: "VAPID keys are not configured for this project" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const { event_id } = await req.json();
    if (!event_id) {
      return new Response(JSON.stringify({ error: "event_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Who did this event notify? Those are exactly the people to push to.
    const { data: notifications } = await supabase
      .from("notifications")
      .select("user_id")
      .eq("event_id", event_id);

    const userIds = [...new Set((notifications ?? []).map((n) => n.user_id))];
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "nobody to notify" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint")
      .in("user_id", userIds);

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions ?? []) {
      try {
        const audience = new URL(sub.endpoint).origin;
        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: await vapidAuthHeader(audience),
            TTL: "3600",
            "Content-Length": "0",
          },
        });

        if (response.ok) {
          sent++;
        } else {
          failed++;
          // 404/410 mean the browser dropped the subscription — clean it up
          // rather than retrying it forever (Fizzy's DelinquencyTracker
          // solves the same problem for webhooks).
          if (response.status === 404 || response.status === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      } catch {
        failed++;
      }
    }

    return new Response(JSON.stringify({ sent, failed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
