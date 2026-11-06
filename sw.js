"use strict";
/* ============================================================
   Service worker — Logistique Fret
   1. Hors ligne : toute l'application est préchargée ; le cache sert d'abord (ouverture instantanée, même sans réseau).
   2. Mises à jour : une nouvelle version attend que l'utilisateur accepte (message SKIP_WAITING), jamais de mélange en cours d'usage.
   3. Rappels : sur Android/Chrome (application installée), « periodicsync » relit la copie interne des données
      et affiche les rappels en retard, même application fermée.
   ============================================================ */

const VERSION = "__VERSION__"; // remplacé par l'identifiant du commit à la publication (voir .github/workflows/pages.yml)
const CACHE = `logistique-${VERSION}`;
const FICHIERS = [
  "./", "index.html", "style.css",
  "data.js", "noyau.js", "ia.js", "stockage.js", "sauvegarde.js", "app.js", "commercial.js", "photos.js", "reglages.js", "notifications.js", "boot.js",
  "vendor/anthropic-sdk.js",
  "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "manifest.webmanifest",
];

// Logique métier et accès IndexedDB partagés avec l'application (aucun accès au DOM au chargement).
importScripts("data.js", "noyau.js", "stockage.js");

self.addEventListener("install", (e) => {
  // cache: "reload" : on contourne le cache HTTP du serveur pour ne jamais précharger une version périmée.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("logistique-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
  // Même vérification que « periodicsync » ; répond avec ce qui a été calculé (utile aux tests et au diagnostic).
  if (e.data?.type === "VERIFIER") e.waitUntil(verifierEnArrierePlan().then((r) => e.source?.postMessage({ type: "verifie", ...r })));
});

// Cache d'abord (l'application est versionnée : le cache est cohérent) ; sinon réseau ; hors ligne, la page d'accueil en dernier recours.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const trouve = await cache.match(req, { ignoreSearch: true });
    if (trouve) return trouve;
    try {
      const r = await fetch(req);
      if (r.ok && req.mode !== "navigate") cache.put(req, r.clone());
      return r;
    } catch {
      return (req.mode === "navigate" && (await cache.match("index.html"))) || Response.error();
    }
  }));
});

/* ---------- rappels ---------- */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const onglet = e.notification.data?.onglet || "tableau";
  e.waitUntil((async () => {
    for (const w of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      await w.focus();
      w.postMessage({ type: "ouvrir", onglet });
      return;
    }
    await self.clients.openWindow(`./#${onglet}`);
  })());
});

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "verifier-alertes") e.waitUntil(verifierEnArrierePlan());
});

/** Relit la copie interne des données, calcule les rappels dus et les affiche. Renvoie { items, affichees }. */
async function verifierEnArrierePlan() {
  const miroir = await etatMiroirLire().catch(() => null);
  if (!miroir?.etat) return { items: [], affichees: [] };
  S = migrer(miroir.etat).etat; // S : état global déclaré par noyau.js
  const notifies = await notifiesLire().catch(() => ({}));
  const jour = dateISO(Date.now());
  const { items, cles } = notificationsAEnvoyer(alertes(), S.meta.notif, notifies, jour);
  const affichees = [];
  for (const it of items) {
    try {
      await self.registration.showNotification(it.titre, { body: it.corps, tag: it.tag, icon: "icon-192.png", badge: "icon-192.png", data: { onglet: it.onglet }, lang: "fr" });
      affichees.push(it.tag);
    } catch { /* autorisation retirée entre-temps : rien n'est marqué comme envoyé */ }
  }
  if (affichees.length) { // on ne mémorise que si au moins une notification est réellement partie
    cles.forEach((k) => { notifies[k] = jour; });
    for (const k of Object.keys(notifies)) if (joursEntre(notifies[k], jour) > 30) delete notifies[k];
    await notifiesEcrire(notifies).catch(() => {});
  }
  return { items: items.map((i) => ({ tag: i.tag, titre: i.titre, corps: i.corps, onglet: i.onglet })), affichees };
}
