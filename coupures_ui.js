"use strict";
/* ============================================================
   Coupures planifiées (interface) :
   · fiche du voyage → Suivi, voyage en cours avec balise : prochaine pause de 45 min et fin de la conduite du jour (dans combien de temps,
     vers quelle heure, à combien de km), compteurs du jour, de la semaine et des deux semaines, aires poids lourds vers le lieu estimé
     de la pause (carte, ou liste OpenStreetMap), « Prévenir le chauffeur » ;
   · alerte au chauffeur 30 minutes avant (son canal : ntfy ou WhatsApp par le relais), une fois par série, tant que l'application est ouverte ;
   · mode chauffeur : la prochaine pause sur la mission ;
   · journal de conduite par chauffeur tenu avec le GPS vu par l'application (compteurs de la semaine).
   Estimation GPS : le tachygraphe fait foi. Logique pure dans coupures.js.
   ============================================================ */

const histDuVoyage = (v) => { const cam = parId(S.camions, v?.camionId), id = cam?.balise?.trim(); return id && typeof directDonnees !== "undefined" ? directDonnees.hist.get(id) || null : null; };
const hmS = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dureeH = (h) => { const m = Math.round(Math.abs(h) * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
/** Prochaine étape vers laquelle roule le camion (pour estimer le lieu de la pause). */
function cibleRoute(v) {
  const jal = (t) => (v.jalons || []).some((j) => j.type === t), t = typeof tronconsRoute === "function" ? tronconsRoute(v) : null;
  if (!Array.isArray(t)) return destinationDe(v);
  if (!jal("livre")) return t.length > 1 && !jal("embarque_aller") ? t[0].points[1] : t[t.length - 1].points[1];
  return origineDe(v) || null; // retour vers le dépôt
}
/** État des coupures d'un voyage en cours : null sans GPS. */
function coupuresVoyage(v) {
  const h = histDuVoyage(v); if (!h || h.length < 2 || v.statut !== "en_cours") return null;
  const t = maintenantS(), ch = parId(S.chauffeurs, v.chauffeurId), journal = ch ? noterConduite(S.conduiteJournal?.[ch.id], h, t) : {}, sem = compteursSemaine(journal, dateLocale(t));
  const c = prochainesCoupures(h, t, { etendusSemaine: sem.joursEtendus }), der = h[h.length - 1], pos = [der[1], der[2]];
  return { ...c, sem, pos, lieuPause: pointEstime(pos, cibleRoute(v), c.pause.km), chauffeur: ch };
}
const barre = (val, max, lib, detail = "") => { const p = Math.min(100, Math.round((val / max) * 100)), cls = val >= max ? "danger" : val >= max * 0.9 ? "warn" : ""; return `<div class="compteur"><div class="ligne"><span>${lib}</span><strong>${dureeH(val)} <span class="sub">/ ${dureeH(max)}</span></strong></div><div class="progress ${cls}"><i style="width:${p}%"></i></div>${detail ? `<span class="sub">${detail}</span>` : ""}</div>`; };

function blocCoupures(v) {
  if (v.statut !== "en_cours") return "";
  const c = coupuresVoyage(v);
  if (!c) return `<div class="section-title">Conduite et coupures</div><p class="hint" style="margin-top:0">Pas de position récente pour le camion de ce voyage : branchez sa balise (Carte → réglages) pour voir la prochaine pause. Les temps officiels restent ceux du tachygraphe (page Tachygraphe).</p>`;
  const p = c.pause, f = c.finJour;
  const ligneP = c.enArret && c.arretMin >= 45 ? `<strong>Pause faite</strong> : arrêté depuis ${c.arretMin} min.` : c.enArret ? `<strong>À l'arrêt depuis ${c.arretMin} min</strong> : encore ${45 - c.arretMin} min pour valoir une pause de 45 min.` : p.depasse ? `<strong class="neg">Pause dépassée</strong> : ${dureeH(c.serieH)} de conduite sans pause de 45 min.` : `<strong>Prochaine pause dans ${dureeH(p.resteH)}</strong> (vers ${hmS(p.heure)}, ≈ ${fmt(p.km)} km).`;
  const ligneF = f.depasse ? `<strong class="neg">Conduite du jour dépassée</strong> (${dureeH(c.jourH)} sur ${f.limiteH} h).` : `Fin de la conduite du jour dans <strong>${dureeH(f.resteH)}</strong> (vers ${hmS(f.heure)}).`;
  return `<div class="section-title">Conduite et coupures</div>
    <div class="trav coupures ${p.depasse || f.depasse ? "danger" : p.dansMin <= 30 && !c.enArret ? "warn" : ""}"><div><span>${ligneP}</span><span class="sub">${ligneF} Vitesse moyenne récente ${c.vitesse} km/h.</span></div>
      <div class="r"><div class="row"><a class="btn ghost sm" href="${esc(lienAiresPL(c.lieuPause || c.pos))}" target="_blank" rel="noopener">${ic("pin")}Aires poids lourds</a>${btn("coupure-aires", "Lister les aires", { id: v.id, cls: "btn ghost sm" })}${c.chauffeur ? btn("coupure-prevenir", "Prévenir le chauffeur", { id: v.id, icone: "bell", cls: "btn ghost sm" }) : ""}</div></div></div>
    <div class="compteurs">${barre(c.serieH, 4.5, "Depuis la dernière pause")}${barre(c.jourH, f.limiteH, "Aujourd'hui", f.extensionPossible ? `10 h possibles encore ${2 - c.sem.joursEtendus} fois cette semaine` : "")}${barre(c.sem.semaineH, 56, "Cette semaine", c.sem.joursSansDonnees ? `${c.sem.joursSansDonnees} jour(s) sans données GPS (repos, ou application fermée) : peut être sous-estimé` : "")}${barre(c.sem.deuxSemainesH, 90, "Deux semaines")}</div>
    <p class="hint">Estimation d'après le GPS (roulage au-dessus de 5 km/h) et le règlement CE 561/2006 simplifié ; le tachygraphe fait foi. Lieu de la pause estimé en ligne droite vers la prochaine étape.</p>`;
}
enregistrerBlocVoyage({ onglet: "suivi", ordre: 5, rendu: blocCoupures });

/** Aires poids lourds autour du lieu estimé de la pause (OpenStreetMap via Overpass, appelé par le navigateur). */
async function listerAires(v) {
  const c = coupuresVoyage(v), p = c?.lieuPause || c?.pos; if (!p) return toast("Position du camion inconnue.", "warn");
  toast("Recherche des aires (OpenStreetMap)…");
  let l = [], erreur = "";
  try { const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: requeteAiresPL(p) }) }); if (!r.ok) throw new Error(`réponse ${r.status}`); l = lireAiresPL(await r.json(), p); }
  catch (e) { erreur = e.message; }
  await modale({ titre: `Aires poids lourds — ${v.ref}`, valider: "Fermer", annuler: "", corps: `<p class="hint" style="margin-top:0">Autour du lieu estimé de la pause (${p[0].toFixed(3)}, ${p[1].toFixed(3)}), 25 km. Données OpenStreetMap : places, prix et sécurité à vérifier sur place.</p>
    ${l.length ? `<div class="aires">${l.map((a) => `<div class="trav"><div><strong>${esc(a.nom)}</strong><span class="sub">${fmt(a.km, 1)} km · ${a.type === "service" ? "aire de service" : a.type === "repos" ? "aire de repos" : "parking poids lourds"}${a.places ? ` · ${a.places} places PL` : ""}${a.payant === true ? " · payant" : a.payant === false ? " · gratuit" : ""}${a.gardee ? " · gardé" : ""}${a.sanitaires ? " · toilettes" : ""}${a.douches ? " · douches" : ""}</span></div><div class="r"><a class="btn ghost sm" href="https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=driving" target="_blank" rel="noopener">Y aller</a></div></div>`).join("")}</div>`
      : `<p>${erreur ? `Liste indisponible (${esc(erreur)}).` : "Aucune aire trouvée dans OpenStreetMap à moins de 25 km."} <a href="${esc(lienAiresPL(p))}" target="_blank" rel="noopener">Chercher sur la carte</a>.</p>`}` });
}
/** Message au chauffeur maintenant (son canal préféré, par le relais si possible) ; renvoie true si parti. */
async function prevenirChauffeurCoupure(v, type, c, { auto = false } = {}) {
  if (typeof destinataireNotif !== "function" || typeof envoyerNotifications !== "function") return false;
  const d = destinataireNotif("chauffeur", "prefere", v); if (d.manque) { if (!auto) toast(d.manque, "warn"); return false; }
  const b = type === "pause" ? c.pause : c.finJour, texte = messageCoupure(type, b.dansMin, b.heure, d.langue || "fr", lienAiresPL(c.lieuPause || c.pos));
  const r = await envoyerNotifications([{ id: `coupure:${v.id}:${type}:${Math.round(b.heure / 1800)}`, canal: d.canal, destination: d.destination, repli: d.repli, sujet: `${v.ref} — ${type === "pause" ? "pause" : "fin de journée"}`, texte, voyageId: v.id, nom: d.nom }]);
  if (typeof ajouterFil === "function") ajouterFil(`${v.ref} — ${c.chauffeur?.nom || "chauffeur"} prévenu : ${texte.split(" Aires")[0]}`, { voyageId: v.id });
  if (!auto) { if (r.envoyes) toast(`${c.chauffeur?.nom || "Chauffeur"} prévenu`, "ok"); else if (r.liens?.length) window.open(r.liens[0].href, "_blank", "noopener"); else toast(r.erreurs?.[0] || "Envoi impossible.", "danger"); }
  return !!r.envoyes;
}

/** Toutes les 2 minutes : journal de conduite et alertes au chauffeur avant la pause et la fin de journée. */
async function surveillerCoupures() {
  if (typeof directDonnees === "undefined" || !directDonnees.hist.size) return;
  const t = maintenantS(), avant = num(S.params.alerteCoupureMin, 30); let change = false;
  S.conduiteJournal ||= {}; S.notifsCoupure ||= {};
  for (const v of S.voyages.filter((x) => x.statut === "en_cours")) {
    const h = histDuVoyage(v); if (!h || h.length < 2) continue;
    if (v.chauffeurId) { const j = noterConduite(S.conduiteJournal[v.chauffeurId], h, t); if (JSON.stringify(j) !== JSON.stringify(S.conduiteJournal[v.chauffeurId] || {})) { S.conduiteJournal[v.chauffeurId] = j; change = true; } }
    if (S.params.alerteCoupureAuto === false || t - h[h.length - 1][0] > 20 * 60) continue; // signal trop ancien : pas d'alerte
    const c = coupuresVoyage(v); if (!c || c.enArret) continue;
    for (const type of ["pause", "finJour"]) {
      const b = c[type]; if (b.depasse || b.dansMin > avant || b.dansMin <= 0) continue;
      const cle = `${v.id}:${type}:${Math.round(b.heure / 3600)}`; if (S.notifsCoupure[cle]) continue;
      S.notifsCoupure[cle] = t; change = true;
      await prevenirChauffeurCoupure(v, type, c, { auto: true });
    }
  }
  for (const [k, x] of Object.entries(S.notifsCoupure)) if (t - x > 3 * 86400) { delete S.notifsCoupure[k]; change = true; }
  if (change) sauver();
}
function coupuresDemarrer() { setInterval(() => { surveillerCoupures().catch(() => { /* réessayé */ }); }, 2 * 60000); setTimeout(() => surveillerCoupures().catch(() => {}), 8000); }

const agirVoyagesAvantCoupures = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (act === "coupure-aires") { const v = parId(S.voyages, id); return v ? listerAires(v) : undefined; }
  if (act === "coupure-prevenir") { const v = parId(S.voyages, id), c = v && coupuresVoyage(v); if (!c) return toast("Position du camion inconnue.", "warn"); return prevenirChauffeurCoupure(v, c.pause.dansMin <= c.finJour.dansMin ? "pause" : "finJour", c); }
  return agirVoyagesAvantCoupures.call(this, act, id, b);
};

/* ---------- mode chauffeur : la prochaine pause sur la mission ---------- */
if (typeof carteMission === "function") {
  const carteMissionAvantCoupures = carteMission;
  carteMission = function (cmd, ch, principale) {
    const h = carteMissionAvantCoupures(cmd, ch, principale); if (!principale || typeof voyageDeCommande !== "function") return h;
    const l = voyageDeCommande(cmd), c = l && coupuresVoyage(l.v); if (!c) return h;
    const txt = c.enArret ? `À l'arrêt depuis ${c.arretMin} min` : c.pause.depasse ? "Pause de 45 min dépassée : arrêtez-vous dès que possible" : `Prochaine pause dans ${dureeH(c.pause.resteH)} (vers ${hmS(c.pause.heure)})`;
    return h.replace('<div class="chf-actions">', `<div class="chf-plein chf-coupure ${c.pause.depasse ? "danger" : ""}">${ic("clock")}<div><strong>${txt}</strong><span class="sub">Fin de la conduite du jour vers ${hmS(c.finJour.heure)} · estimation GPS, le tachygraphe fait foi</span> <a href="${esc(lienAiresPL(c.lieuPause || c.pos))}" target="_blank" rel="noopener">Aires poids lourds</a></div></div><div class="chf-actions">`);
  };
}

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 42,
  rendu: () => `<div class="card" id="carte-coupures"><div class="card-head"><h2>Coupures et alertes au chauffeur</h2></div>
    <form id="f-coupures"><label class="check full"><input type="checkbox" name="auto" ${S.params.alerteCoupureAuto === false ? "" : "checked"}><span>Prévenir le chauffeur avant sa pause de 45 min et avant la fin de sa conduite du jour (ntfy ou WhatsApp, son canal habituel)</span></label>
      <div class="form-grid"><label class="f">Combien de minutes avant<input type="number" name="minutes" min="10" max="90" step="5" value="${num(S.params.alerteCoupureMin, 30)}"></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    <p class="hint">D'après la position GPS des camions suivis, tant que l'application est ouverte (au bureau par exemple) ; un message par pause. Estimation : le tachygraphe fait foi.</p></div>`,
  soumettre(fid, val) { if (fid !== "f-coupures") return false; S.params.alerteCoupureAuto = !!val.auto; S.params.alerteCoupureMin = Math.min(90, Math.max(10, num(val.minutes, 30))); sauver(); toast("Alertes de coupure enregistrées"); rafraichir(); return true; },
});
