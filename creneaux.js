"use strict";
/* ============================================================
   Meilleur créneau au port — logique pure, testée.
   D'après VOS attentes mesurées (S.attentesPort : entrée au port → embarquement ou sortie, heure du Maroc) :
   · grille jour de la semaine × tranche de 3 heures (médiane, P90, nombre de passages ; passages au scanner à part) ;
   · pour un jour donné : la tranche la plus rapide et la plus lente, avec assez de passages, sinon toute la semaine ;
   · pour un voyage : arrivée estimée au prochain port, son attente habituelle et le meilleur créneau de ce jour-là.
   Aucune donnée extérieure : sans passages mesurés, rien n'est conseillé (et c'est dit).
   Dépend de noyau.js, prevision.js (PORTS_ATTENTE, heureMaroc, jourMaroc, dureeTexte), devis.js et itineraire.js (km jusqu'au port).
   ============================================================ */

const TRANCHES_PORT = [0, 3, 6, 9, 12, 15, 18, 21];
const JOURS_PORT_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."], JOURS_PORT_LONGS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const libTranche = (h) => `${String(h).padStart(2, "0")}:00–${String((h + 3) % 24).padStart(2, "0")}:00`;
const trancheDe = (heure) => Math.floor((((heure % 24) + 24) % 24) / 3) * 3;
const medianeMs = (l) => { const t = [...l].sort((a, b) => a - b); return t.length ? (t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : null; };

/** Mesures utiles d'un port (Algeciras : marchandises fraîches et autres jamais mélangées). */
const mesuresPort = (portId, { avecSPS = false } = {}) => (S.attentesPort || []).filter((x) => x.portId === portId && (portId !== "alg_entry" || !!x.avecSPS === !!avecSPS) && num(x.dureeMs) > 0);
/**
 * Grille { [jour 0-6]: { [tranche]: { n, p50, p90, scans } } } et total. Les passages au scanner ne comptent pas dans la médiane (attente exceptionnelle).
 */
function grilleAttentes(portId, options = {}) {
  const g = {}, l = mesuresPort(portId, options);
  for (let j = 0; j < 7; j++) { g[j] = {}; for (const t of TRANCHES_PORT) g[j][t] = { n: 0, p50: null, p90: null, scans: 0, _d: [] }; }
  for (const x of l) { const c = g[x.jourSemaine]?.[trancheDe(x.heureEntree)]; if (!c) continue; if (x.scanRouge) c.scans++; else { c.n++; c._d.push(num(x.dureeMs)); } }
  for (let j = 0; j < 7; j++) for (const t of TRANCHES_PORT) { const c = g[j][t], tri = c._d.sort((a, b) => a - b); c.p50 = medianeMs(tri); c.p90 = tri.length ? tri[Math.min(tri.length - 1, Math.floor(tri.length * 0.9))] : null; delete c._d; }
  return { grille: g, total: l.filter((x) => !x.scanRouge).length };
}
/**
 * Meilleur et pire créneau d'un jour : { jour, portee: "jour" | "semaine", tranches: [{ h, lib, n, p50 }], meilleur, pire, total } ou null (pas assez de passages).
 * Une tranche compte à partir de minMesures passages ; il en faut au moins deux pour comparer. Sinon on regarde toute la semaine.
 */
function meilleurCreneau(portId, jour, { avecSPS = false, minMesures = 3 } = {}) {
  const { grille, total } = grilleAttentes(portId, { avecSPS });
  const duJour = TRANCHES_PORT.map((h) => ({ h, lib: libTranche(h), ...grille[jour][h] })).filter((c) => c.n >= minMesures);
  let tranches = duJour, portee = "jour";
  if (duJour.length < 2) {
    const sem = TRANCHES_PORT.map((h) => { const d = mesuresPort(portId, { avecSPS }).filter((x) => !x.scanRouge && trancheDe(x.heureEntree) === h).map((x) => num(x.dureeMs)); return { h, lib: libTranche(h), n: d.length, p50: medianeMs(d) }; }).filter((c) => c.n >= minMesures);
    if (sem.length < 2) return null;
    tranches = sem; portee = "semaine";
  }
  const tri = [...tranches].sort((a, b) => a.p50 - b.p50);
  return { jour, portee, tranches, meilleur: tri[0], pire: tri[tri.length - 1], gainMs: tri[tri.length - 1].p50 - tri[0].p50, total };
}

/** Prochain passage portuaire mesurable d'un voyage : { portId, lib, avecSPS } ou null. */
function prochainPortVoyage(v) {
  if (!v || !["prevu", "en_cours"].includes(v.statut) || !sensParDetroit(v, "aller") && !sensParDetroit(v, "retour")) return null;
  const fait = (t) => (v.jalons || []).some((j) => j.type === t), frais = voyageFrais(v);
  if (!fait("port_tmed") && !fait("embarque_aller")) return { portId: "tmed_export", lib: "Tanger Med (export)", avecSPS: false };
  if (!fait("debarque_alg")) return { portId: "alg_entry", lib: "Algeciras (entrée en Europe)", avecSPS: frais };
  if (fait("charge_retour") && !fait("debarque_tmed") && !fait("douane_import")) return { portId: "tmed_import", lib: "Tanger Med (import)", avecSPS: false };
  return null;
}
/**
 * Arrivée estimée au port de départ d'un voyage prévu : départ du dépôt à 6 h (heure du Maroc), route à 70 km/h, pause de 45 min toutes les 4 h 30,
 * repos de 11 h après 9 h de conduite.
 * Renvoie un horodatage (ms) ou null. ESTIMATION : la vraie heure dépend du chargement et du chauffeur.
 */
function arriveePortEstimee(v) {
  if (!v?.dateDepart) return null;
  const o = typeof origineDe === "function" ? origineDe(v) : coordsVille(v.origine), it = v.itineraire?.troncons?.[0];
  const heures = it?.heures || (o ? (kmEntre(o, PORT_TMED) * DETOUR_ROUTE) / 70 : null); if (heures === null) return null;
  const repos = Math.ceil(heures / 9) - 1, pauses = Math.max(0, Math.ceil(heures / 4.5) - 1 - repos) * 0.75, debut = Date.parse(`${v.dateDepart}T06:00:00Z`) - 3600000; // 6 h au Maroc = 5 h UTC
  return debut + (heures + pauses + repos * 11) * 3600000;
}
/** Conseil pour un voyage : { port, arrivee (ms) ou null, attenteArrivee, creneau, conseil (texte) } ou null. */
function conseilCreneau(v) {
  const port = prochainPortVoyage(v); if (!port) return null;
  const arrivee = port.portId === "tmed_export" && v.statut === "prevu" ? arriveePortEstimee(v) : null;
  const jour = arrivee ? jourMaroc(arrivee) : jourMaroc(Date.now()), c = meilleurCreneau(port.portId, jour, { avecSPS: port.avecSPS });
  const n = mesuresPort(port.portId, { avecSPS: port.avecSPS }).filter((x) => !x.scanRouge).length;
  if (!c) return { port, arrivee, creneau: null, n, conseil: `${port.lib} : pas encore assez de passages mesurés (${n}) pour conseiller un créneau ; il apparaîtra après une dizaine de passages.` };
  const tArr = arrivee ? c.tranches.find((x) => x.h === trancheDe(heureMaroc(arrivee))) : null;
  const jourLib = c.portee === "jour" ? `le ${JOURS_PORT_LONGS[jour]}` : "en semaine (tous jours confondus)";
  let conseil = `${port.lib}, ${jourLib} : arrivée conseillée ${c.meilleur.lib} (attente habituelle ${dureeTexte(c.meilleur.p50)}, ${c.meilleur.n} passages)`;
  if (c.pire.h !== c.meilleur.h) conseil += ` ; à éviter ${c.pire.lib} (${dureeTexte(c.pire.p50)})`;
  if (tArr && tArr.h !== c.meilleur.h && tArr.p50 - c.meilleur.p50 >= 30 * 60000) conseil += `. Arrivée prévue vers ${new Date(arrivee + 3600000).toISOString().slice(11, 16)} : ${dureeTexte(tArr.p50)} d'attente habituelle, ${dureeTexte(tArr.p50 - c.meilleur.p50)} de plus qu'au meilleur créneau`;
  return { port, arrivee, attenteArrivee: tArr?.p50 ?? null, creneau: c, n, conseil: conseil + "." };
}

/* ---------- le bateau réservé et l'heure limite pour l'attraper (v5.19.0) ---------- */
const PRESENTATION_BATEAU_H = 3; // présentation demandée par les armateurs du détroit (DFDS : 3 h avant le départ)
/** Port de départ de chaque ligne : fuseau de l'heure saisie (« maroc » = UTC+1 comme le reste de l'application) et mesures de passage utilisables. */
const DEPARTS_TRAVERSEE = {
  "tmed-alg": { port: "Tanger Med", fuseau: "maroc", portId: "tmed_export" }, "tmed-sete": { port: "Tanger Med", fuseau: "maroc", portId: "tmed_export" },
  "alg-tmed": { port: "Algeciras", fuseau: "Europe/Madrid", portId: null }, "sete-tmed": { port: "Sète", fuseau: "Europe/Paris", portId: null },
};
/** Décalage (ms) d'un fuseau à un instant. */
function decalageFuseau(fuseau, t) {
  if (fuseau === "maroc") return 3600000;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
/** Instant (ms) d'une heure locale : « 2026-11-24 », « 14:00 », fuseau. */
function instantPort(iso, hm, fuseau) {
  const base = Date.parse(`${String(iso).slice(0, 10)}T${hm}:00Z`); if (!Number.isFinite(base)) return null;
  const t = base - decalageFuseau(fuseau, base); return base - decalageFuseau(fuseau, t);
}
/** Heure (« 09:40 ») et jour (« mardi 24/11 ») d'un instant dans le fuseau du port. */
const heurePort = (ms, fuseau) => new Date(ms + decalageFuseau(fuseau, ms)).toISOString().slice(11, 16);
const jourPort = (ms, fuseau) => { const d = new Date(ms + decalageFuseau(fuseau, ms)); return `${JOURS_PORT_LONGS[d.getUTCDay()]} ${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}`; };
/** Passage habituel au port de départ pour une entrée à cet instant : vos mesures (jour et tranche, 3 passages au moins), sinon la présentation demandée. */
function passageAuPort(portId, entree) {
  if (portId && Number.isFinite(entree)) { const c = grilleAttentes(portId).grille[jourMaroc(entree)]?.[trancheDe(heureMaroc(entree))]; if (c && c.n >= 3) return { p50: c.p50, p90: c.p90 ?? c.p50, n: c.n, tranche: trancheDe(heureMaroc(entree)), jour: jourMaroc(entree), source: "mesures" }; }
  return { p50: PRESENTATION_BATEAU_H * 3600000, p90: PRESENTATION_BATEAU_H * 3600000, n: 0, source: "presentation" };
}
/**
 * Le prochain bateau d'un voyage (aller puis retour, pas encore embarqué) et ce qu'il demande :
 * { sens, ligne, lib, port, fuseau, armateur, ref, statut, depart, limite, passage, arrivee, margeMin, niveau, reserverApres }.
 * · réservé (date et heure) : entrer au port avant `limite`, la plus tardive des entrées (par quarts d'heure, à partir de 3 h avant le départ)
 *   dont le passage habituel dans 9 cas sur 10 — jamais moins que la présentation de 3 h — laisse attraper le bateau ; `contrainte` : la tranche
 *   mesurée, plus lente, qui a obligé à entrer plus tôt ;
 *   comparé à l'arrivée estimée (aller, avant le port) : « danger » si elle tombe après la limite, « warn » à moins d'une heure ;
 * · pas encore réservé : réserver un départ après `reserverApres` = arrivée estimée + même délai (arrondi à la demi-heure).
 */
function bateauVoyage(v) {
  if (!v || !["prevu", "en_cours"].includes(v.statut)) return null;
  const fait = (t) => (v.jalons || []).some((j) => j.type === t);
  const t = ["aller", "retour"].map((s) => (v.traversees || []).find((x) => x.sens === s)).find((x) => x && x.statut !== "effectuee" && !fait(x.sens === "aller" ? "embarque_aller" : "embarque_retour"));
  if (!t) return null;
  const D = DEPARTS_TRAVERSEE[t.ligne] || { port: "port de départ", fuseau: "maroc", portId: null };
  const depart = t.date && /^\d{2}:\d{2}$/.test(t.heure || "") ? instantPort(t.date, t.heure, D.fuseau) : null;
  const arrivee = t.sens === "aller" && !fait("port_tmed") && D.portId ? arriveePortEstimee(v) : null;
  const delai = (p) => Math.max(p.p90, PRESENTATION_BATEAU_H * 3600000);
  let limite = null, passage = null, reserverApres = null, contrainte = null;
  if (depart !== null) {
    for (let e = depart - PRESENTATION_BATEAU_H * 3600000; e >= depart - 18 * 3600000; e -= 15 * 60000) {
      const p = passageAuPort(D.portId, e);
      if (e + delai(p) <= depart) { limite = e; passage = p; break; }
      if (!contrainte && p.source === "mesures") contrainte = p;
    }
    if (limite === null) { limite = depart - 18 * 3600000; passage = passageAuPort(D.portId, limite); }
  }
  else if (arrivee !== null) { passage = passageAuPort(D.portId, arrivee); reserverApres = Math.ceil((arrivee + delai(passage)) / 1800000) * 1800000; }
  const margeMin = limite !== null && arrivee !== null ? Math.round((limite - arrivee) / 60000) : null;
  return { sens: t.sens, ligne: t.ligne, lib: LIGNES_TRAVERSEE[t.ligne]?.lib || "Traversée", port: D.port, fuseau: D.fuseau, armateur: t.armateur || "", ref: t.ref || "", statut: t.statut,
    depart, limite, passage, contrainte, arrivee, margeMin, niveau: margeMin === null ? "" : margeMin < 0 ? "danger" : margeMin < 60 ? "warn" : "ok", reserverApres };
}
/** Le bateau en morceaux pour l'affichage : { titre, sousTitre, consigne, raison, arrivee } (chaînes, vides si sans objet). */
function partiesBateau(b) {
  if (!b) return null;
  const h = (ms) => heurePort(ms, b.fuseau), esp = b.fuseau === "Europe/Madrid" ? " (heure d'Espagne)" : b.fuseau === "Europe/Paris" ? " (heure de France)" : "";
  const tranche = (p) => `le ${JOURS_PORT_LONGS[p.jour]} entre ${libTranche(p.tranche).replace("–", " et ")}`;
  const passage = (p) => (p.source !== "mesures" ? `présentation ${PRESENTATION_BATEAU_H} h avant le départ` : p.p90 <= PRESENTATION_BATEAU_H * 3600000 ? `présentation ${PRESENTATION_BATEAU_H} h avant le départ ; passage habituel ${dureeTexte(p.p50)} ${tranche(p)}` : `passage habituel ${dureeTexte(p.p50)} ${tranche(p)}, jusqu'à ${dureeTexte(p.p90)} dans 9 cas sur 10`);
  const sousTitre = [b.armateur, b.ref && `réf. ${b.ref}`].filter(Boolean).join(" · ");
  if (b.depart !== null) return { titre: `${b.lib} · ${jourPort(b.depart, b.fuseau)} à ${h(b.depart)}${esp}`, sousTitre, consigne: `Entrer au port avant ${h(b.limite)}`,
    raison: b.contrainte ? `Plus tard, ${tranche(b.contrainte)}, le passage prend jusqu'à ${dureeTexte(b.contrainte.p90)} dans 9 cas sur 10 (habituellement ${dureeTexte(b.contrainte.p50)}) : trop long pour ce bateau.` : `${passage(b.passage).replace(/^./, (c) => c.toUpperCase())}.`,
    arrivee: b.margeMin === null ? "" : b.margeMin < 0 ? `Arrivée estimée vers ${h(b.arrivee)} : trop tard de ${dureeTexte(-b.margeMin * 60000)} — décaler la réservation ou partir plus tôt.` : `Arrivée estimée vers ${h(b.arrivee)} : ${dureeTexte(b.margeMin * 60000)} d'avance${b.margeMin < 60 ? ", c'est juste" : ""}.` };
  if (b.reserverApres !== null) return { titre: `${b.lib} à réserver`, sousTitre: "", consigne: `Réserver un départ à partir de ${h(b.reserverApres)}${jourPort(b.reserverApres, b.fuseau) !== jourPort(b.arrivee, b.fuseau) ? ` (${jourPort(b.reserverApres, b.fuseau)})` : ""}`,
    raison: `Arrivée estimée ${jourPort(b.arrivee, b.fuseau)} vers ${h(b.arrivee)} ; ${passage(b.passage)}.`, arrivee: "" };
  return null;
}
/** Le bateau en une phrase (fiche du voyage, mode chauffeur). */
function texteBateau(b) {
  if (!b) return "";
  const h = (ms) => heurePort(ms, b.fuseau), esp = b.fuseau === "Europe/Madrid" ? " (heure d'Espagne)" : b.fuseau === "Europe/Paris" ? " (heure de France)" : "";
  const tranche = (p) => `le ${JOURS_PORT_LONGS[p.jour]} entre ${libTranche(p.tranche).replace("–", " et ")}`;
  const passage = (p) => (p.source !== "mesures" ? `présentation ${PRESENTATION_BATEAU_H} h avant le départ` : p.p90 <= PRESENTATION_BATEAU_H * 3600000 ? `présentation ${PRESENTATION_BATEAU_H} h avant le départ ; passage habituel ${dureeTexte(p.p50)} ${tranche(p)}` : `passage habituel ${dureeTexte(p.p50)} ${tranche(p)}, jusqu'à ${dureeTexte(p.p90)} dans 9 cas sur 10`);
  if (b.depart !== null) {
    const raison = b.contrainte ? `plus tard, ${tranche(b.contrainte)}, le passage prend jusqu'à ${dureeTexte(b.contrainte.p90)} dans 9 cas sur 10 (habituellement ${dureeTexte(b.contrainte.p50)}) : trop long pour ce bateau` : passage(b.passage);
    let s = `${b.lib} ${jourPort(b.depart, b.fuseau)} à ${h(b.depart)}${esp}${b.armateur ? ` · ${b.armateur}` : ""}${b.ref ? ` · réf. ${b.ref}` : ""} — entrer au port avant ${h(b.limite)} (${raison}).`;
    if (b.margeMin !== null) s += b.margeMin < 0 ? ` Arrivée estimée vers ${h(b.arrivee)} : trop tard de ${dureeTexte(-b.margeMin * 60000)} — décaler la réservation ou partir plus tôt.` : ` Arrivée estimée vers ${h(b.arrivee)} : ${dureeTexte(b.margeMin * 60000)} d'avance${b.margeMin < 60 ? ", c'est juste" : ""}.`;
    return s;
  }
  if (b.reserverApres !== null) return `${b.lib} à réserver : arrivée estimée ${jourPort(b.arrivee, b.fuseau)} vers ${h(b.arrivee)} ; réserver un départ à partir de ${h(b.reserverApres)}${jourPort(b.reserverApres, b.fuseau) !== jourPort(b.arrivee, b.fuseau) ? ` (${jourPort(b.reserverApres, b.fuseau)})` : ""} (${passage(b.passage)}).`;
  return "";
}
