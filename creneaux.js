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
