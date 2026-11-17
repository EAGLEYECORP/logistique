"use strict";
/* ============================================================
   Mode chauffeur, phase C : fait pour une main, au volant à l'arrêt, téléphone dans la poche.
   · « Glisser pour confirmer » à la place des boutons d'étape (chargée, livrée…), d'arrivée au quai et de fin de service :
     pas de geste accidentel dans la poche, et plus de question « Êtes-vous sûr ? » (le glissement EST la confirmation) ;
   · en tête : la route — prochaine pause, fin de la conduite du jour, où faire le plein ;
   · bandeau permanent « En ligne » / « Hors ligne : tout est gardé sur le téléphone » ;
   · vibration courte quand un geste est enregistré ; gros boutons ; arabe de droite à gauche (le glissement aussi).
   S'appuie sur chauffeur.js (écran), coupures_ui.js (pauses), plein.js (consigne), quais_ui.js (quai).
   ============================================================ */

const ACTES_GLISSES = ["chf-etape", "chf-quai", "chf-fin"];
/** Glissière : glisser la poignée jusqu'au bout déclenche l'action (Entrée au clavier). */
function glissiere(act, libelle, { id = "", ton = "" } = {}) {
  return `<div class="glissiere ${ton}" data-glisser="${esc(act)}" data-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(libelle)} — glisser pour confirmer">
    <span class="glissiere-texte">${esc(libelle)}</span><span class="glissiere-poignee" aria-hidden="true">${ic("arrow")}</span></div>`;
}
/** Vibration courte (si le téléphone le permet). */
const vibrer = (ms = 35) => { try { navigator.vibrate?.(ms); } catch { /* ignoré */ } };
async function declencherGlissiere(el) {
  if (el.classList.contains("faite")) return;
  el.classList.add("faite"); vibrer(20);
  await agirPage("chauffeur", el.dataset.glisser, el.dataset.id, { dataset: { glisse: "1" } });
}
(function suivreGlissieres() {
  let g = null; // { el, x0, max, poignee }
  const rtl = () => document.documentElement.dir === "rtl";
  document.addEventListener("pointerdown", (e) => {
    const p = e.target.closest?.(".glissiere-poignee"), el = p?.closest(".glissiere"); if (!el || el.classList.contains("faite")) return;
    e.preventDefault(); p.setPointerCapture?.(e.pointerId);
    g = { el, p, x0: e.clientX, max: el.clientWidth - p.offsetWidth - 8 }; el.classList.add("en-cours");
  });
  document.addEventListener("pointermove", (e) => {
    if (!g) return; const dx = (e.clientX - g.x0) * (rtl() ? -1 : 1), x = Math.max(0, Math.min(g.max, dx));
    g.p.style.transform = `translateX(${rtl() ? -x : x}px)`; g.el.style.setProperty("--avance", (x / g.max).toFixed(3));
  });
  const fin = (e) => {
    if (!g) return; const { el, p } = g, dx = ((e.clientX ?? g.x0) - g.x0) * (rtl() ? -1 : 1), ok = dx >= g.max * 0.85; g = null; el.classList.remove("en-cours");
    if (ok) { p.style.transform = `translateX(${rtl() ? -(el.clientWidth - p.offsetWidth - 8) : el.clientWidth - p.offsetWidth - 8}px)`; el.style.setProperty("--avance", "1"); declencherGlissiere(el); }
    else { p.style.transform = ""; el.style.setProperty("--avance", "0"); }
  };
  document.addEventListener("pointerup", fin); document.addEventListener("pointercancel", fin);
  document.addEventListener("keydown", (e) => { const el = e.target.closest?.(".glissiere"); if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); declencherGlissiere(el); } });
})();

/* ---------- en tête : connexion et route ---------- */
function bandeauConnexion() {
  const enLigne = navigator.onLine;
  return `<div class="chf-connexion ${enLigne ? "ok" : "hors"}" role="status">${ic(enLigne ? "check" : "alert")}<span>${enLigne ? "En ligne" : "Hors ligne : tout est gardé sur le téléphone et partira au retour du réseau"}</span></div>`;
}
/** La route du chauffeur : prochaine pause, fin de journée, où faire le plein (voyage en cours de sa première mission). */
function blocRouteChauffeur() {
  const ch = chauffeurCourant(); if (!ch) return "";
  const v = S.voyages.find((x) => x.chauffeurId === ch.id && x.statut === "en_cours"); if (!v) return "";
  const lignes = [], c = typeof coupuresVoyage === "function" ? coupuresVoyage(v) : null;
  if (c) {
    const dur = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}\u00a0h\u00a0${String(m % 60).padStart(2, "0")}`; }, hm = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const txt = c.enArret && c.arretMin >= 45 ? "Pause faite" : c.enArret ? `À l'arrêt depuis ${c.arretMin} min` : c.pause.depasse ? "Pause de 45 min dépassée : arrêtez-vous" : `Pause dans ${dur(c.pause.resteH)} · vers ${hm(c.pause.heure)}`;
    lignes.push(`<div class="chf-route-ligne ${c.pause.depasse ? "danger" : c.pause.dansMin <= 30 && !c.enArret ? "warn" : ""}">${ic("clock")}<div><strong>${esc(txt)}</strong><span class="sub">Fin de la conduite du jour vers ${hm(c.finJour.heure)}</span></div><a class="btn ghost" href="${esc(lienAiresPL(c.lieuPause || c.pos))}" target="_blank" rel="noopener">${ic("pin")}Aires</a></div>`);
  }
  const p = typeof planPlein === "function" && !(v.jalons || []).some((j) => j.type === "livre") ? planPlein(v) : null;
  if (p?.achats?.length) lignes.push(`<div class="chf-route-ligne plein">${ic("gauge")}<div><strong>Plein : ${esc(p.achats.map((a) => `${NOM_PAYS_PLEIN?.[a.pays] || a.pays} ${a.litres >= p.reservoir - 5 ? "plein complet" : `${fmt(a.litres)} L`}`).join(" · "))}</strong><span class="sub">Pas de plein en France · réservoirs d'origine seulement</span></div></div>`);
  return lignes.length ? `<div class="card chf-route-carte"><div class="chf-route-titre">${ic("route")}<span>Ma route · ${esc(v.ref)}</span></div>${lignes.join("")}</div>` : "";
}
blocPage("chauffeur", { position: "avant", ordre: 5, rendu: () => (modeChauffeurActif() ? bandeauConnexion() : "") });
blocPage("chauffeur", { position: "avant", ordre: 10, rendu: () => (modeChauffeurActif() ? blocRouteChauffeur() : "") });
window.addEventListener("online", () => { if (ongletActif === "chauffeur") rafraichir(); });
window.addEventListener("offline", () => { if (ongletActif === "chauffeur") rafraichir(); });

/* ---------- après chaque geste du chauffeur : une vibration ---------- */
autourAction("chauffeur", ["chf-etape", "chf-quai", "chf-fin", "chf-service", "chf-plein", "chf-trajet-go", "chf-trajet-fin"], async (suite) => { const avant = JSON.stringify(S), r = await suite(); if (JSON.stringify(S) !== avant) vibrer(40); else document.querySelectorAll(".glissiere.faite").forEach((el) => { el.classList.remove("faite"); el.style.setProperty("--avance", "0"); el.querySelector(".glissiere-poignee").style.transform = ""; }); return r; }, { ordre: 15, nom: "vibration du mode chauffeur" });
