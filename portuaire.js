"use strict";
/* ============================================================
   Passage des ports d'un voyage, étape par étape — logique pure, testée.
   Chaque étape faite est notée sur le voyage (voyage.etapesPort[id] = { date, ref, note, inspection }) ; certaines posent aussi
   l'étape du voyage correspondante (entrée au port, embarquement, débarquement, mainlevée), la sortie du port d'Algeciras,
   l'état de la traversée, le passage au scanner et le séjour Schengen du chauffeur — pour que les attentes mesurées, l'arrivée estimée,
   les notifications et le compteur Schengen suivent sans double saisie.
   Dépend de data.js (PORTS_PASSAGE) et noyau.js.
   ============================================================ */

const portsDuSens = (sens) => Object.entries(PORTS_PASSAGE).filter(([, p]) => p.sens === sens).map(([id, p]) => ({ id, ...p }));
const etapePort = (id) => { for (const [port, p] of Object.entries(PORTS_PASSAGE)) { const e = p.etapes.find((x) => x.id === id); if (e) return { ...e, port }; } return null; };
const estFrais = (v) => !!v?.marchandiseFrais || (Number.isFinite(v?.tempMin) && Number.isFinite(v?.tempMax));
/** Étapes qui concernent ce voyage (les contrôles sanitaires seulement pour une marchandise fraîche). */
const etapesApplicables = (v, port) => (PORTS_PASSAGE[port]?.etapes || []).filter((e) => !e.frais || estFrais(v));

/** État d'une étape : { fait, date, ref, note, inspection, source: "saisie" | "gps" | "etape" }. Une étape liée à une étape du voyage déjà posée (GPS, chauffeur) compte comme faite. */
function etatEtapePort(v, e) {
  const s = v.etapesPort?.[e.id];
  if (s?.date) return { fait: true, date: s.date, ref: s.ref || "", note: s.note || "", inspection: !!s.inspection, source: "saisie" };
  const j = e.jalon && (v.jalons || []).find((x) => x.type === e.jalon);
  if (j) return { fait: true, date: j.date, ref: "", note: "", inspection: false, source: j.source === "gps" ? "gps" : "etape" };
  if (e.sortiePort && v.sortiesPort?.[e.sortiePort]) return { fait: true, date: v.sortiesPort[e.sortiePort], ref: "", note: "", inspection: false, source: "gps" };
  return { fait: false };
}
/** Résumé d'un port : { faites, total, debut, fin, dureeMs, enCours, prochaine }. */
function resumePort(v, port, maintenant = Date.now()) {
  const etapes = etapesApplicables(v, port), etats = etapes.map((e) => ({ e, s: etatEtapePort(v, e) }));
  const dates = etats.filter((x) => x.s.fait).map((x) => Date.parse(x.s.date)).filter(Number.isFinite).sort((a, b) => a - b);
  const faites = etats.filter((x) => x.s.fait).length, obligatoires = etats.filter((x) => !x.e.facultatif), fini = obligatoires.every((x) => x.s.fait);
  const debut = dates[0] ?? null, fin = fini ? dates[dates.length - 1] ?? null : null;
  return { faites, total: etapes.length, debut, fin, dureeMs: debut === null ? 0 : (fin ?? maintenant) - debut, enCours: debut !== null && !fini, fini: fini && debut !== null, prochaine: etats.find((x) => !x.s.fait && !x.e.facultatif)?.e || null };
}

/**
 * Marque une étape comme faite. Effets liés : étape du voyage (si absente), sortie du port d'Algeciras, traversée effectuée à l'embarquement,
 * passage au scanner (hors médiane des attentes), séjour Schengen du chauffeur ouvert ou fermé. Renvoie la liste des effets (pour l'affichage).
 */
function marquerEtapePort(v, id, { date = new Date().toISOString(), ref = "", note = "", inspection = false } = {}) {
  const e = etapePort(id); if (!e) throw new Error("Étape inconnue");
  const effets = [];
  (v.etapesPort ||= {})[id] = { date, ...(ref ? { ref: String(ref).trim().slice(0, 80) } : {}), ...(note ? { note: String(note).trim().slice(0, 300) } : {}), ...(inspection ? { inspection: true } : {}) };
  if (e.jalon && !(v.jalons || []).some((j) => j.type === e.jalon)) {
    (v.jalons ||= []).push({ type: e.jalon, date, source: "port" }); v.jalons.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    effets.push(`étape « ${JALONS_VOYAGE.find((j) => j[0] === e.jalon)?.[1] || e.jalon} »`);
    if (e.jalon === "depart" && v.statut === "prevu") v.statut = "en_cours";
  }
  if (e.sortiePort) { (v.sortiesPort ||= {})[e.sortiePort] = date; effets.push("sortie du port enregistrée"); }
  if (e.jalon === "embarque_aller" || e.jalon === "embarque_retour") {
    const t = (v.traversees || []).find((x) => x.sens === (e.jalon === "embarque_aller" ? "aller" : "retour"));
    if (t) { t.statut = "effectuee"; t.date ||= date.slice(0, 10); t.heure ||= new Date(Date.parse(date) + 3600000).toISOString().slice(11, 16); if (ref && !t.navire) t.navire = String(ref).trim(); effets.push("traversée effectuée"); }
  }
  if (e.scanner && PORTS_PASSAGE[e.port]?.portAttente) { v.scanRouge ||= {}; if (inspection) { v.scanRouge[PORTS_PASSAGE[e.port].portAttente] = true; effets.push("inspection notée (hors médiane des attentes)"); } else delete v.scanRouge[PORTS_PASSAGE[e.port].portAttente]; }
  if (e.schengen) {
    const ch = parId(S.chauffeurs, v.chauffeurId), jour = date.slice(0, 10);
    if (ch) {
      ch.sejours ||= [];
      const ouvert = ch.sejours.find((s) => s.entree && !s.sortie);
      if (e.schengen === "entree" && !ouvert) { ch.sejours.push({ entree: jour, voyageId: v.id }); effets.push(`séjour Schengen de ${ch.nom} ouvert`); }
      if (e.schengen === "sortie" && ouvert && ouvert.entree <= jour) { ouvert.sortie = jour; effets.push(`séjour Schengen de ${ch.nom} fermé`); }
    }
  }
  return effets;
}
/** Annule une étape notée à la main ; retire les effets qu'elle avait posés (étape du voyage d'origine « port », sortie du port, séjour ouvert par ce voyage). */
function annulerEtapePort(v, id) {
  const e = etapePort(id), s = v.etapesPort?.[id]; if (!e || !s) return false;
  delete v.etapesPort[id];
  if (e.jalon) v.jalons = (v.jalons || []).filter((j) => !(j.type === e.jalon && j.source === "port"));
  if (e.sortiePort && v.sortiesPort?.[e.sortiePort] === s.date) delete v.sortiesPort[e.sortiePort];
  if (e.scanner && PORTS_PASSAGE[e.port]?.portAttente && v.scanRouge) delete v.scanRouge[PORTS_PASSAGE[e.port].portAttente];
  if (e.schengen) {
    const ch = parId(S.chauffeurs, v.chauffeurId), jour = s.date.slice(0, 10);
    if (ch?.sejours) {
      if (e.schengen === "entree") ch.sejours = ch.sejours.filter((x) => !(x.voyageId === v.id && x.entree === jour && !x.sortie));
      if (e.schengen === "sortie") { const x = ch.sejours.find((z) => z.sortie === jour && z.voyageId === v.id) || ch.sejours.find((z) => z.sortie === jour); if (x) delete x.sortie; }
    }
  }
  return true;
}
/** Références notées pendant le passage des ports (DUM, TIR, MRN, CHED…) : [{ lib, ref, port }] — pour le dossier du voyage et la facture. */
function referencesPortuaires(v) {
  const r = [];
  for (const [port, p] of Object.entries(PORTS_PASSAGE)) for (const e of p.etapes) { const s = v.etapesPort?.[e.id]; if (s?.ref) r.push({ lib: e.ref || e.lib, ref: s.ref, port: p.lib }); }
  return r;
}
