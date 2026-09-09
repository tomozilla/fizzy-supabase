// Service worker for web push (Fizzy's Notification::PushTarget::Web).
//
// Pushes are sent *without* an encrypted payload — VAPID-authenticated but
// bodyless — so this worker doesn't decrypt anything; it just tells the user
// something happened and links them into the inbox, which then loads the
// real content over an authenticated request. That avoids implementing
// RFC 8291 payload encryption for what is, here, a "go look at your inbox"
// nudge.

self.addEventListener("push", (event) => {
  let title = "fizzy-supabase";
  let body = "New activity in your workspace";

  // If a payload does arrive (some senders include one), prefer it.
  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title ?? title;
      body = data.body ?? body;
    } catch {
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
