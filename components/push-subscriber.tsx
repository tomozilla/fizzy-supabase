"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, deletePushSubscription } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * VAPID public keys travel as base64url; PushManager wants raw bytes.
 * Backed by an explicit ArrayBuffer so the result is a `BufferSource`
 * (a plain Uint8Array can be backed by a SharedArrayBuffer, which
 * applicationServerKey doesn't accept).
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function PushSubscriber({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<"loading" | "unsupported" | "on" | "off">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    })().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setState("unsupported");
    });
  }, []);

  if (state === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="push-state">
        Push notifications aren&apos;t available in this browser.
        {error ? ` (${error})` : ""}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant={state === "on" ? "default" : "outline"}
        disabled={state === "loading" || !vapidPublicKey}
        onClick={async () => {
          setError(null);
          try {
            const registration = await navigator.serviceWorker.ready;

            if (state === "on") {
              const sub = await registration.pushManager.getSubscription();
              if (sub) {
                await deletePushSubscription(sub.endpoint);
                await sub.unsubscribe();
              }
              setState("off");
              return;
            }

            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
              setError("Notification permission was declined.");
              return;
            }

            const sub = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
            });

            await savePushSubscription(
              sub.endpoint,
              bufferToBase64Url(sub.getKey("p256dh")),
              bufferToBase64Url(sub.getKey("auth")),
            );
            setState("on");
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        {state === "on" ? "🔔 Push enabled" : "🔕 Enable push notifications"}
      </Button>
      <span data-testid="push-state" className="text-xs text-muted-foreground">
        {state === "on" ? "subscribed" : "not subscribed"}
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
