"use strict";
/* ============================================================
   Planning des chauffeurs et des camions — logique pure, testée.
   · occupation jour par jour : en voyage, absent (congé, maladie, formation, repos), immobilisé (entretien, panne, visite), papiers expirés, libre ;
   · conflits d'affectation : même chauffeur ou même camion sur deux voyages, voyage pendant une absence ou une immobilisation ;
   · qui est libre sur une période (proposé à la création d'un voyage) ;
   · dupliquer un voyage, programme du chauffeur prêt à envoyer.
   Dépend de noyau.js (dates, Schengen, papiers) et pilotage.js (finVoyage).
   ============================================================ */

const TYPES_ABSENCE = [["conge", "Congé"], ["maladie", "Maladie"], ["formation", "Formation"], ["repos", "Repos"], ["autre", "Absent"]];
const TYPES_IMMOBILISATION = [["entretien", "Entretien"], ["panne", "Panne"], ["visite", "Visite technique"], ["autre", "Immobilisé"]];
const PAPIERS_BLOQUANTS_CHAUFFEUR = [["permis", "Permis"], ["carteConducteur", "Carte conducteur"], ["visiteMedicale", "Visite médicale"]];
const PAPIERS_BLOQUANTS_CAMION = [["assurance", "Assurance"], ["visite", "Visite technique"]];
const decaler = (iso, n) => dateISO(Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") + n * 86400000);
/** Jours (ISO) à partir d'une date. */
const joursPlage = (debut, n) => Array.from({ length: Math.max(0, n) }, (_, i) => decaler(debut, i));
const dansPeriode = (jour, debut, fin) => !!debut && jour >= String(debut).slice(0, 10) && jour <= String(fin || debut).slice(0, 10);
const chevauche = (a1, a2, b1, b2) => !!a1 && !!b1 && String(a1).slice(0, 10) <= String(b2 || b1).slice(0, 10) && String(b1).slice(0, 10) <= String(a2 || a1).slice(0, 10);
/** Période d'un voyage : départ → retour réel, sinon prévu (un jour au moins). */
const periodeVoyage = (v) => ({ debut: v.dateDepart || "", fin: finVoyage(v) || v.dateDepart || "" });
const voyagesActifs = () => S.voyages.filter((v) => v.statut !== "annule" && v.dateDepart);

/**
 * Occupation d'une ressource un jour donné : { statut, libelle, niveau, voyageId?, absenceId? }.
 * genre : "chauffeur" | "camion". Priorité : voyage, puis absence / immobilisation, puis papiers expirés, puis libre.
 * Un ancien « en congé » (case cochée sur la fiche) compte comme absence à partir d'aujourd'hui.
 */
function occupation(genre, r, jour) {
  const v = voyagesActifs().find((x) => (genre === "chauffeur" ? x.chauffeurId : x.camionId) === r.id && dansPeriode(jour, periodeVoyage(x).debut, periodeVoyage(x).fin));
  if (v) return { statut: "voyage", libelle: v.ref || "Voyage", niveau: v.statut === "termine" ? "fait" : "occupe", voyageId: v.id, destination: v.destination || "" };
  const liste = genre === "chauffeur" ? r.absences : r.immobilisations, types = genre === "chauffeur" ? TYPES_ABSENCE : TYPES_IMMOBILISATION;
  const a = (liste || []).find((x) => dansPeriode(jour, x.debut, x.fin));
  if (a) return { statut: "absent", libelle: libDe(types, a.type) || "Absent", niveau: "absent", absenceId: a.id, note: a.note || "" };
  if (genre === "chauffeur" && r.conge && jour >= today()) return { statut: "absent", libelle: "Congé", niveau: "absent" };
  for (const [k, l] of genre === "chauffeur" ? PAPIERS_BLOQUANTS_CHAUFFEUR : PAPIERS_BLOQUANTS_CAMION) if (r[k] && String(r[k]).slice(0, 10) < jour) return { statut: "papiers", libelle: `${l} expiré`, niveau: "bloque" };
  return { statut: "libre", libelle: "", niveau: "libre" };
}

/**
 * Grille du planning : { jours, lignes: [{ id, nom, cellules: [occupation…], libres, schengen? }], libresParJour }.
 * Chauffeurs : jours Schengen restants (pour savoir qui peut encore partir en Europe).
 */
function grillePlanning(genre, debut, n = 14) {
  const jours = joursPlage(debut, n), ressources = genre === "chauffeur" ? S.chauffeurs : S.camions;
  const lignes = ressources.map((r) => {
    const cellules = jours.map((j) => occupation(genre, r, j));
    return { id: r.id, nom: genre === "chauffeur" ? r.nom : r.immat, cellules, libres: cellules.filter((c) => c.statut === "libre").length, ...(genre === "chauffeur" ? { schengen: schengenEtat(r.sejours || [], debut).restant } : {}) };
  });
  return { jours, lignes, libresParJour: jours.map((_, i) => lignes.filter((l) => l.cellules[i].statut === "libre").length) };
}

/** Pourquoi une ressource n'est pas libre sur une période : [{ type, texte }] (vide = libre). `sauf` : voyage à ignorer (celui qu'on modifie). */
function indisponibilites(genre, r, debut, fin, { sauf = "" } = {}) {
  if (!r || !debut) return [];
  const res = [], nom = genre === "chauffeur" ? r.nom : r.immat;
  for (const v of voyagesActifs()) {
    if (v.id === sauf || (genre === "chauffeur" ? v.chauffeurId : v.camionId) !== r.id) continue;
    const p = periodeVoyage(v); if (chevauche(debut, fin, p.debut, p.fin)) res.push({ type: "voyage", voyageId: v.id, texte: `${nom} est déjà sur le voyage ${v.ref || ""} du ${dateFr(p.debut)} au ${dateFr(p.fin)}` });
  }
  const types = genre === "chauffeur" ? TYPES_ABSENCE : TYPES_IMMOBILISATION;
  for (const a of (genre === "chauffeur" ? r.absences : r.immobilisations) || []) if (chevauche(debut, fin, a.debut, a.fin)) res.push({ type: "absence", texte: `${nom} : ${libDe(types, a.type).toLowerCase()} du ${dateFr(a.debut)} au ${dateFr(a.fin || a.debut)}` });
  if (genre === "chauffeur" && r.conge) res.push({ type: "absence", texte: `${nom} est marqué en congé (fiche chauffeur)` });
  for (const [k, l] of genre === "chauffeur" ? PAPIERS_BLOQUANTS_CHAUFFEUR : PAPIERS_BLOQUANTS_CAMION) if (r[k] && String(r[k]).slice(0, 10) < String(fin || debut).slice(0, 10)) res.push({ type: "papiers", texte: `${nom} : ${l.toLowerCase()} expiré${String(r[k]).slice(0, 10) >= String(debut).slice(0, 10) ? ` le ${dateFr(r[k])}, pendant la période` : ` depuis le ${dateFr(r[k])}`}` });
  return res;
}
/** Conflits d'affectation d'un voyage (chauffeur et camion), pour les contrôles et les alertes. */
function conflitsAffectation(v) {
  if (!v || v.statut === "annule" || v.statut === "termine" || !v.dateDepart) return [];
  const p = periodeVoyage(v), ch = parId(S.chauffeurs, v.chauffeurId), cam = parId(S.camions, v.camionId);
  return [...indisponibilites("chauffeur", ch, p.debut, p.fin, { sauf: v.id }), ...indisponibilites("camion", cam, p.debut, p.fin, { sauf: v.id })].filter((c) => c.type !== "papiers"); // les papiers sont déjà contrôlés par controlesVoyage
}
/** Ressources libres sur une période, les libres d'abord : [{ id, nom, libre, raisons[], schengen? }]. Chauffeurs : les plus de jours Schengen restants d'abord. */
function ressourcesLibres(genre, debut, fin, { sauf = "" } = {}) {
  const liste = (genre === "chauffeur" ? S.chauffeurs : S.camions).map((r) => {
    const raisons = indisponibilites(genre, r, debut, fin, { sauf }).map((x) => x.texte);
    const sch = genre === "chauffeur" ? schengenPrevu(r.sejours || [], debut, fin || debut) : null;
    if (sch && !sch.ok) raisons.push(`${r.nom} : ${sch.pic} jours Schengen sur 180 après ce voyage (limite 90)`);
    return { id: r.id, nom: genre === "chauffeur" ? r.nom : r.immat, libre: !raisons.length, raisons, ...(genre === "chauffeur" ? { schengen: schengenEtat(r.sejours || [], debut).restant } : {}) };
  });
  return liste.sort((a, b) => Number(b.libre) - Number(a.libre) || (b.schengen ?? 0) - (a.schengen ?? 0) || a.nom.localeCompare(b.nom));
}

/** Copie d'un voyage pour un nouveau départ : même trajet, client, prix, équipe et consignes ; dates décalées en gardant la durée ; étapes, dépenses, preuve et historique remis à zéro. */
function dupliquerVoyage(v, dateDepart, ref) {
  const duree = v.dateDepart && v.dateRetourPrevue ? Math.max(0, joursEntre(v.dateDepart, v.dateRetourPrevue)) : 0;
  const garder = ["clientId", "marchandise", "origine", "destination", "destLat", "destLon", "chauffeurId", "camionId", "remorque", "ptacT", "prix", "devise", "kmAller", "kmRetourCharge", "kmRetourVide", "kmPays", "peageTrajet", "peageAR", "peagesMad", "peagesEur", "tempMin", "tempMax", "marchandiseFrais", "transportCombine", "notes"];
  const n = { id: uid(), ref, statut: "prevu", dateDepart, dateRetourPrevue: decaler(dateDepart, duree), jalons: [], coches: {}, lignesCout: [] };
  for (const k of garder) if (v[k] !== undefined && v[k] !== "") n[k] = typeof v[k] === "object" ? JSON.parse(JSON.stringify(v[k])) : v[k];
  if (v.livraisonPrevue && v.dateDepart) { const ecart = Date.parse(v.livraisonPrevue) - Date.parse(v.dateDepart + "T00:00:00Z"); n.livraisonPrevue = new Date(Date.parse(dateDepart + "T00:00:00Z") + ecart).toISOString(); }
  n.traversees = (v.traversees || []).map((t) => ({ ...t, date: "", heure: "", ref: "", statut: "a_reserver" }));
  return n;
}
/** Programme d'un chauffeur sur les prochains jours, prêt à envoyer par WhatsApp. */
function programmeChauffeur(ch, debut = today(), n = 7) {
  const fin = decaler(debut, n - 1), lignes = [];
  for (const v of voyagesActifs().filter((x) => x.chauffeurId === ch.id && x.statut !== "termine").sort((a, b) => a.dateDepart.localeCompare(b.dateDepart))) {
    const p = periodeVoyage(v); if (!chevauche(debut, fin, p.debut, p.fin)) continue;
    const a = (v.traversees || []).find((t) => t.sens === "aller");
    lignes.push(`• ${v.ref} : ${v.origine || "?"} → ${v.destination || "?"}, départ le ${dateFr(p.debut)}, retour prévu le ${dateFr(p.fin)}${v.camionId ? `, camion ${nomCamion(v.camionId)}` : ""}${a?.date ? `, traversée le ${dateFr(a.date)}${a.heure ? " à " + a.heure : ""}${a.ref ? " (réservation " + a.ref + ")" : ""}` : ""}`);
  }
  for (const a of ch.absences || []) if (chevauche(debut, fin, a.debut, a.fin)) lignes.push(`• ${libDe(TYPES_ABSENCE, a.type)} du ${dateFr(a.debut)} au ${dateFr(a.fin || a.debut)}`);
  return `Bonjour ${ch.nom}, votre programme du ${dateFr(debut)} au ${dateFr(fin)} :\n${lignes.length ? lignes.join("\n") : "• Aucun voyage prévu pour l'instant."}${S.entreprise?.nom ? `\n— ${S.entreprise.nom}` : ""}`;
}

/**
 * Pourquoi une case « papiers » est rouge : tous les papiers suivis de la ressource, à une date donnée.
 * [{ cle, lib, date, statut: "expire" | "bientot" | "ok" | "manquant", bloquant, texte }] — les expirés d'abord.
 * Bloquants (la case devient rouge) : permis, carte conducteur, visite médicale ; assurance et visite technique du camion. Les autres sont signalés sans bloquer.
 */
function etatPapiers(genre, r, jour = today()) {
  const docs = genre === "chauffeur" ? DOCS_CHAUFFEUR : DOCS_CAMION, bloquants = (genre === "chauffeur" ? PAPIERS_BLOQUANTS_CHAUFFEUR : PAPIERS_BLOQUANTS_CAMION).map(([k]) => k), alerte = num(S.params?.alerteJours, 30);
  const ordre = { expire: 0, bientot: 1, manquant: 2, ok: 3 };
  return docs.map(([cle, lib]) => {
    const d = r?.[cle] ? String(r[cle]).slice(0, 10) : "", bloquant = bloquants.includes(cle);
    if (!d) return { cle, lib, date: "", statut: "manquant", bloquant, texte: "date non renseignée" };
    const j = joursEntre(jour, d);
    if (j < 0) return { cle, lib, date: d, statut: "expire", bloquant, texte: `expiré depuis le ${dateFr(d)} (${-j} j)${bloquant ? " — bloque tout voyage" : ""}` };
    if (j <= alerte) return { cle, lib, date: d, statut: "bientot", bloquant, texte: `expire le ${dateFr(d)} (dans ${j} j)` };
    return { cle, lib, date: d, statut: "ok", bloquant, texte: `valable jusqu'au ${dateFr(d)}` };
  }).sort((a, b) => ordre[a.statut] - ordre[b.statut] || Number(b.bloquant) - Number(a.bloquant));
}
