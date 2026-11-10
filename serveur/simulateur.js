#!/usr/bin/env node
"use strict";
/* Camion fictif pour essayer le suivi en direct : node serveur/simulateur.js http://localhost:8787 JETON_ECRITURE [identifiant] */
const [, , base = "http://localhost:8787", jeton = "", id = "DEMO-1"] = process.argv;
const ETAPES = [[30.42, -9.6], [33.59, -7.62], [35.889, -5.5], "PORT", [36.13, -5.44], [38.0, -3.0], [42.42, 2.87]];
const dist = (a, b) => { const r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); };
let pos = ETAPES[0], i = 1, t = Math.floor(Date.now() / 1000) - 3600, attente = 0;
const pas = async () => {
  const cible = ETAPES[i];
  if (cible === "PORT") { if (attente++ < 6) { t += 600; return [pos[0], pos[1], 0]; } attente = 0; pos = ETAPES[i + 1]; i += 2; t += 5400; return null; } // traversée : silence
  const d = dist(pos, cible), v = 85, m = (v / 3.6) * 60;
  if (d < m) { pos = cible; i++; if (i >= ETAPES.length) i = 1; return [pos[0], pos[1], v]; }
  const f = m / d; pos = [pos[0] + (cible[0] - pos[0]) * f, pos[1] + (cible[1] - pos[1]) * f]; t += 60; return [pos[0], pos[1], v];
};
(async () => {
  for (;;) {
    const p = await pas(); const maintenant = Math.floor(Date.now() / 1000);
    if (p && t <= maintenant + 60) await fetch(`${base}/api/positions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` }, body: JSON.stringify({ id, t, lat: p[0], lon: p[1], v: p[2] }) }).then((r) => r.ok || console.error("refusé", r.status)).catch((e) => console.error(e.message));
    await new Promise((r) => setTimeout(r, t < maintenant ? 20 : 2000)); // rattrape d'abord l'heure écoulée, puis temps réel accéléré
  }
})();
