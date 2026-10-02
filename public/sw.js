/* Service worker da Nexa: só notificações no celular. Não guarda cache nem intercepta páginas,
   então não muda nada no carregamento do app. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { corpo: event.data ? event.data.text() : "" };
  }
  const url = typeof dados.url === "string" && /^\/(?!\/)/.test(dados.url) ? dados.url : "/avisos";
  event.waitUntil(
    self.registration.showNotification(dados.titulo || "Nexa", {
      body: dados.corpo || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: dados.tag || undefined,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/avisos",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (janelas) => {
      for (const janela of janelas) {
        if (new URL(janela.url).origin !== self.location.origin) continue;
        try {
          if ("navigate" in janela) await janela.navigate(destino);
          return janela.focus();
        } catch {
          /* janela não controlada: abre uma nova */
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
