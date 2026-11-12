"use strict";
/* ============================================================
   Prévision d'arrivée calée sur vos attentes réelles aux ports — logique pure, testée.
   · chaque passage au port est mesuré (entrée → sortie) d'après les étapes du voyage, elles-mêmes posées par le GPS ;
   · attentePort : médiane (P50), P75 et P90 par port, heure, jour et saison, avec repli progressif quand les mesures manquent ;
   · l'arrivée estimée utilise ces attentes, se resserre à chaque port franchi, et affiche sa fourchette.
   Dépend de noyau.js et gps.js (etaVoyage). Chargé aussi par le relais (page du client).
   ============================================================ */

/** [id, libellé, étape d'entrée, étape de sortie, attente générique en heures (sans mesure)]. Algeciras : la sortie vient du GPS (v.sortiesPort) ou d'une saisie. */
const PORTS_ATTENTE = [["tmed_export", "Tanger Med (export)", "port_tmed", "embarque_aller", 3], ["alg_entry", "Algeciras (entrée en Europe)", "debarque_alg", null, 1], ["tmed_import", "Tanger Med (import)", "debarque_tmed", "douane_import", 3]];
const ATTENTE_SPS_GENERIQUE_H = 4, H_MS = 3600000;
const portAttente = (id) => PORTS_ATTENTE.find((p) => p[0] === id);
const saisonDe = (ms) => { const m = new Date(ms).getUTCMonth() + 1; return m >= 10 || m <= 5 ? "haute" : "basse"; };
const heureMaroc = (ms) => new Date(ms + H_MS).getUTCHours();            // Maroc : UTC+1 toute l'année
const jourMaroc = (ms) => new Date(ms + H_MS).getUTCDay();
const dureeTexte = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const voyageFrais = (v) => !!v.marchandiseFrais || (Number.isFinite(v.tempMin) && Number.isFinite(v.tempMax));

/** Entrée et sortie (ms) d'un voyage à un port ; sortie nulle si le camion y est encore, entrée nulle s'il n'y est pas arrivé. */
function passagePort(v, portId) {
  const p = portAttente(portId), date = (k) => { const j = (v.jalons || []).find((x) => x.type === k), t = j && Date.parse(j.date); return Number.isFinite(t) ? t : null; };
  const entree = date(p[2]); let sortie = p[3] ? date(p[3]) : null;
  if (portId === "alg_entry") { const s = Date.parse(v.sortiesPort?.alg_entry || ""); sortie = Number.isFinite(s) ? s : null; }
  return { entree, sortie: entree !== null && sortie !== null && sortie >= entree ? sortie : null };
}
/** Mesures d'attente d'un voyage (passages terminés, entre 5 minutes et 5 jours). */
function attentesVoyage(v) {
  const r = [];
  for (const [portId] of PORTS_ATTENTE) {
    const { entree, sortie } = passagePort(v, portId); if (entree === null || sortie === null) continue;
    const dureeMs = sortie - entree; if (dureeMs < 5 * 60000 || dureeMs > 5 * 24 * H_MS) continue;
    r.push({ id: `${v.id}:${portId}`, portId, voyageId: v.id, camionId: v.camionId || "", entreeTimestamp: entree, sortieTimestamp: sortie, dureeMs, jourSemaine: jourMaroc(entree), heureEntree: heureMaroc(entree), saison: saisonDe(entree), avecSPS: portId === "alg_entry" && voyageFrais(v), scanRouge: !!v.scanRouge?.[portId] });
  }
  return r;
}
/** Met S.attentesPort à jour d'après les voyages (ajout, correction) ; une mesure reste même si son voyage est supprimé. Renvoie vrai si la liste a changé. */
function majAttentesPort() {
  S.attentesPort ||= []; let change = false;
  for (const v of S.voyages) {
    if (v.statut === "annule") continue;
    const mesures = attentesVoyage(v);
    for (const m of mesures) { const i = S.attentesPort.findIndex((x) => x.id === m.id); if (i < 0) { S.attentesPort.push(m); change = true; } else if (JSON.stringify(S.attentesPort[i]) !== JSON.stringify(m)) { S.attentesPort[i] = m; change = true; } }
    for (const [portId] of PORTS_ATTENTE) if (!mesures.some((m) => m.portId === portId) && S.attentesPort.some((x) => x.id === `${v.id}:${portId}`)) { S.attentesPort = S.attentesPort.filter((x) => x.id !== `${v.id}:${portId}`); change = true; } // étape annulée
  }
  return change;
}
/** Sortie du port d'Algeciras d'après les visites de zones d'une trace : { alg_entry: ISO } si le camion a quitté le port (un point existe après la sortie). */
function sortiesPortDepuisVisites(visites, finTrace) {
  const alg = (visites || []).filter((x) => x.type === "port_europe" && /algeciras|alg[eé]siras/i.test(x.zone || "")).sort((a, b) => a.entree - b.entree)[0];
  return alg && finTrace > alg.sortie + 600 ? { alg_entry: new Date(alg.sortie * 1000).toISOString() } : {};
}

const centile = (tri, q) => { if (!tri.length) return 0; const i = (tri.length - 1) * q, a = Math.floor(i), b = Math.ceil(i); return tri[a] + (tri[b] - tri[a]) * (i - a); };
const ecartHeure = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
/**
 * Attente attendue à un port : { p50, p75, p90 (ms), n_samples, source, niveau }.
 * Recherche du plus précis au plus large jusqu'à trouver assez de mesures (S.params.seuilCalibrationAttente, 10 par défaut) :
 * heure ± 2 h + jour + saison → sans la saison → sans le jour → heure ± 6 h → tout le port → estimation générique.
 * Algeciras : marchandises fraîches (contrôle sanitaire) et autres ne sont jamais mélangées. Les passages au scanner (scanRouge) ne comptent pas dans la médiane, seulement dans le P90.
 * Une valeur saisie (S.params.attentesForcees[portId].p50_ms) l'emporte sur tout.
 */
function attentePort(portId, heure, jourSemaine, saison, { avecSPS = false } = {}) {
  const force = S.params?.attentesForcees?.[portId];
  if (force && num(force.p50_ms) > 0) { const p = num(force.p50_ms); return { p50: p, p75: p * 1.25, p90: num(force.p90_ms) || p * 1.6, n_samples: 0, source: "saisie_manuelle", niveau: "saisie" }; }
  const seuil = Math.max(1, num(S.params?.seuilCalibrationAttente, 10));
  const tous = (S.attentesPort || []).filter((x) => x.portId === portId && (portId !== "alg_entry" || !!x.avecSPS === !!avecSPS));
  const h = (larg) => (x) => heure === undefined || heure === null || ecartHeure(x.heureEntree, heure) <= larg, j = (x) => jourSemaine === undefined || jourSemaine === null || x.jourSemaine === jourSemaine, s = (x) => !saison || x.saison === saison;
  const niveaux = [["heure_jour_saison", (x) => h(2)(x) && j(x) && s(x)], ["heure_jour", (x) => h(2)(x) && j(x)], ["heure", h(2)], ["heure_large", h(6)], ["port", () => true]];
  for (const [niveau, filtre] of niveaux) {
    const lot = tous.filter(filtre), normaux = lot.filter((x) => !x.scanRouge);
    if (normaux.length < seuil) continue;
    const tri = normaux.map((x) => x.dureeMs).sort((a, b) => a - b), triTous = lot.map((x) => x.dureeMs).sort((a, b) => a - b);
    return { p50: centile(tri, 0.5), p75: centile(tri, 0.75), p90: centile(triTous, 0.9), n_samples: normaux.length, source: "operateur_calibre", niveau };
  }
  const g = (portId === "alg_entry" && avecSPS ? ATTENTE_SPS_GENERIQUE_H : portAttente(portId)[4]) * H_MS;
  return { p50: g, p75: g * 1.5, p90: g * 2.5, n_samples: tous.filter((x) => !x.scanRouge).length, source: "estimation_generique", niveau: "generique" };
}

/** Le camion est-il en ce moment dans un port ? { portId, lib, depuisMs, p50, sortiePrevue (ms), n_samples, source, texte } ou null. */
function attenteEnCours(v, maintenant = Date.now()) {
  if (!v || v.statut !== "en_cours") return null;
  for (const [portId, lib] of PORTS_ATTENTE) {
    const { entree, sortie } = passagePort(v, portId);
    if (entree === null || sortie !== null || maintenant < entree) continue;
    if (portId === "alg_entry" && (v.jalons || []).some((x) => x.type === "livre")) continue;
    if (maintenant - entree > 5 * 24 * H_MS) continue;
    const a = attentePort(portId, heureMaroc(entree), jourMaroc(entree), saisonDe(entree), { avecSPS: voyageFrais(v) }), depuisMs = maintenant - entree, sortiePrevue = Math.max(maintenant + 15 * 60000, entree + a.p50);
    const hm = new Date(sortiePrevue + H_MS).toISOString().slice(11, 16);
    return { portId, lib, depuisMs, p50: a.p50, p90: a.p90, sortiePrevue, n_samples: a.n_samples, source: a.source,
      texte: `${lib} depuis ${dureeTexte(depuisMs)} — sortie attendue vers ${hm} (${a.source === "operateur_calibre" ? `médiane ${dureeTexte(a.p50)}, ${a.n_samples} mesures` : a.source === "saisie_manuelle" ? `valeur saisie : ${dureeTexte(a.p50)}` : `estimation : ${dureeTexte(a.p50)}`})` };
  }
  return null;
}

/**
 * Attentes à utiliser pour l'arrivée estimée d'un voyage, selon où il en est :
 * { portH, auPortH, debarqH (heures à donner à etaVoyage), fourchetteMin (± minutes : somme des P90 − P50 des ports restants), ports: [{ portId, lib, statut: "mesure" | "en_cours" | "a_venir", ms, n_samples, source }], source }.
 * Port franchi : son attente réelle est connue, il ne pèse plus sur la fourchette — elle se resserre à chaque port.
 */
function attentesPourEta(v, maintenant = Date.now()) {
  const retour = (v.jalons || []).some((x) => x.type === "livre"), ids = retour ? ["tmed_import"] : ["tmed_export", "alg_entry"], ports = [];
  let bande = 0;
  for (const portId of ids) {
    const { entree, sortie } = passagePort(v, portId), lib = portAttente(portId)[1], ref = entree ?? maintenant;
    const a = attentePort(portId, heureMaroc(ref), jourMaroc(ref), saisonDe(ref), { avecSPS: voyageFrais(v) });
    if (entree !== null && sortie !== null) ports.push({ portId, lib, statut: "mesure", ms: sortie - entree, n_samples: a.n_samples, source: "mesure" });
    else if (entree !== null) { ports.push({ portId, lib, statut: "en_cours", ms: Math.max(15 * 60000, a.p50 - (maintenant - entree)), n_samples: a.n_samples, source: a.source }); bande += Math.max(0, a.p90 - Math.max(a.p50, maintenant - entree)); }
    else { ports.push({ portId, lib, statut: "a_venir", ms: a.p50, n_samples: a.n_samples, source: a.source }); bande += a.p90 - a.p50; }
  }
  const de = (id) => ports.find((p) => p.portId === id), h = (p) => (p && p.statut !== "mesure" ? p.ms / H_MS : null), restants = ports.filter((p) => p.statut !== "mesure");
  const exp = de("tmed_export"), arr = de(retour ? "tmed_import" : "alg_entry");
  return { portH: exp && exp.statut === "a_venir" ? h(exp) : null, auPortH: exp && exp.statut === "en_cours" ? h(exp) : null, debarqH: h(arr), fourchetteMin: Math.round(bande / 60000), ports,
    source: !restants.length ? "mesure" : restants.every((p) => p.source === "operateur_calibre" || p.source === "saisie_manuelle") ? "operateur_calibre" : "estimation_generique" };
}
/**
 * Arrivée estimée d'un voyage avec vos attentes aux ports. Même moteur que etaVoyage, plus : fourchetteMin, min et max recalculés, ports, source.
 * `attentes` : résultat de attentesPourEta (le relais le reçoit tout fait, il n'a pas vos données).
 */
function etaPrevision(hist, maintenant, dest, attentes, options = {}) {
  const o = { ...options }; if (attentes?.portH != null) o.attentePortH = attentes.portH; if (attentes?.auPortH != null) o.attenteAuPortH = attentes.auPortH; if (attentes?.debarqH != null) o.debarquementH = attentes.debarqH;
  const e = etaVoyage(hist, maintenant, dest, o); if (!e) return null;
  const route = Math.max(20, Math.round(e.conduiteH * 60 * 0.08)), f = Math.round((e.traversee ? num(attentes?.fourchetteMin) : 0) + route);
  return { ...e, fourchetteMin: f, min: e.arrivee - f * 60, max: e.arrivee + f * 60, ports: attentes?.ports || [], source: attentes?.source || "estimation_generique" };
}
/**
 * Décalage de l'arrivée estimée depuis la dernière valeur retenue (v.eta). { decalageMin, notifier, franchitCreneau, retardMin }.
 * notifier : décalage de plus de S.params.seuilDecalageETA minutes (30 par défaut). franchitCreneau : la nouvelle arrivée dépasse le créneau promis alors que l'ancienne le tenait.
 */
function decalageEta(v, arrivee) {
  const avant = v.eta?.arrivee, promis = Date.parse(v.livraisonPrevue || "") / 1000, seuil = num(S.params?.seuilDecalageETA, 30);
  const decalageMin = Number.isFinite(avant) ? Math.round((arrivee - avant) / 60) : 0;
  const retardMin = Number.isFinite(promis) ? Math.round((arrivee - promis) / 60) : null;
  return { decalageMin, notifier: Math.abs(decalageMin) > seuil, franchitCreneau: Number.isFinite(promis) && arrivee > promis && (!Number.isFinite(avant) || avant <= promis), retardMin };
}
