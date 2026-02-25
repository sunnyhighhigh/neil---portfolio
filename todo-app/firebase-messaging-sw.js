/* Minimal service worker for web push registration stability */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const notification = payload && payload.notification ? payload.notification : {};
  const data = payload && payload.data ? payload.data : {};
  const title = notification.title || "Appointment reminder";
  const body = notification.body || "You have an upcoming appointment.";
  const targetUrl = data.url || self.location.origin;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/post-it-note.svg",
      badge: "/post-it-note.svg",
      data: { url: targetUrl }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : self.location.origin;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ includeUncontrolled: true, type: "window" });
    const existing = allClients.find((client) => client.url && client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      return;
    }
    await clients.openWindow(targetUrl);
  })());
});
