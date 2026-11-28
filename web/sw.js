// =====================================================================
// J.A.R.V.I.S. · Service worker (hace la app instalable)
// Autor: Maldonado Jorge Matias
//
// Estrategia: primero la red, y si no hay conexión, la copia guardada.
// Solo guarda archivos propios de la app; nunca respuestas de Supabase
// ni datos personales. (El modo sin conexión completo es de la Fase 4.)
// =====================================================================

const CACHE = "jarvis-__VERSION__";
const ARCHIVOS = [
  "./", "index.html", "manifest.webmanifest", "css/jarvis.css",
  "js/app.js", "js/api.js", "js/auth.js", "js/config.js", "js/supa.js", "js/ui.js", "js/voz.js", "js/paneles.js",
  "icons/icono.svg", "icons/icono-192.png", "icons/icono-512.png", "img/jmm.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith("jarvis-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Solo GET de este mismo sitio; todo lo demás (Supabase, CDN) va directo a la red
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("index.html"))),
  );
});
