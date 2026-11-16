"use strict";
/* ============================================================
   Prix conseillé et devis — logique pure, testée.
   · coût complet de l'aller-retour d'une commande, avant tout voyage : d'abord vos voyages passés sur le même corridor (médiane),
     sinon un voyage simulé (kilomètres par Tanger Med ⇄ Algeciras, gasoil au prix du jour, traversées, per diem, charges de structure),
     avec la liste de ce qui manque à l'estimation ;
   · chance de charger un retour près de la livraison et prix moyen de ces retours, d'après votre historique ;
   · prix conseillé = coût complet ÷ (1 − marge visée) − retour attendu ; prix plancher ; prix sans retour ;
   · historique des prix du client et du corridor ; suivi des devis (envoyé, accepté, perdu et pourquoi) et taux de devis gagnés.
   Dépend de noyau.js, gps.js, rentabilite.js, aller_retour.js, fret_retour.js (coordsVille), quais.js (conditions d'attente).
   ============================================================ */

const PORT_TMED = [35.889, -5.5], PORT_ALG = [36.1408, -5.4562], DETOUR_ROUTE = 1.25;
const memeLieu = (a, b, km = 100) => { const x = coordsVille(a), y = coordsVille(b); if (x && y) return kmEntre(x, y) <= km; return !!a && !!b && sansAcc(a) === sansAcc(b); };
const mediane2 = (l) => { const t = l.filter(Number.isFinite).sort((a, b) => a - b); if (!t.length) return null; const m = Math.floor(t.length / 2); return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
/** Kilomètres routiers estimés d'un aller (par le détroit quand on passe du Maroc à l'Europe) ; null si une ville est inconnue. */
function kmEstimes(c) {
  const o = coordsVille(c.origine), d = coordsVille(c.destination); if (!o || !d) return null;
  const maroc = (p) => p === "Maroc", traverse = maroc(c.paysOrigine || "Maroc") !== maroc(c.paysDest || "");
  const km = traverse ? (maroc(c.paysOrigine || "Maroc") ? kmEntre(o, PORT_TMED) + kmEntre(PORT_ALG, d) : kmEntre(o, PORT_ALG) + kmEntre(PORT_TMED, d)) : kmEntre(o, d);
  return { km: Math.round(km * DETOUR_ROUTE), traverse };
}
/** Voyages passés comparables (même départ et même destination à 100 km près, 12 derniers mois, non annulés). */
function voyagesComparables(c, aujourdhui = today()) {
  const depuis = dateISO(Date.parse(aujourdhui + "T00:00:00Z") - 365 * 86400000);
  return S.voyages.filter((v) => v.statut !== "annule" && (v.dateDepart || "") >= depuis && v.commandeId !== c.id && memeLieu(v.origine, c.origine) && memeLieu(v.destination, c.destination));
}
/** Fret du détroit d'après vos traversées passées (médiane, €), sinon le réglage, sinon null. */
function fretDetroitConnu(ligne) {
  const l = S.voyages.flatMap((v) => v.traversees || []).filter((t) => t.ligne === ligne && num(t.fret) > 0).map((t) => num(t.fret));
  return mediane2(l) ?? (num(S.params?.fretDetroitEur) > 0 ? num(S.params.fretDetroitEur) : null);
}
/**
 * Coût complet estimé de l'aller-retour (MAD) : { mad, source: "historique" | "estimation", n, km, jours, manques: [], detail }.
 * Historique : médiane du coût complet (direct + structure) de vos voyages comparables (2 au moins). Sinon : voyage simulé.
 */
function coutAllerRetour(c, aujourdhui = today()) {
  const comp = voyagesComparables(c, aujourdhui).map((v) => { const m = margeVoyage(v); return m.total_direct + m.total_structure; }).filter((x) => x > 0);
  if (comp.length >= 2) return { mad: Math.round(mediane2(comp)), source: "historique", n: comp.length, km: null, manques: [], detail: `médiane de vos ${comp.length} voyages ${c.origine} → ${c.destination} des 12 derniers mois` };
  const k = kmEstimes(c), manques = [];
  if (!k) return { mad: 0, source: "estimation", n: 0, km: null, manques: ["distance : ville inconnue, saisissez le prix vous-même"], detail: "" };
  const cam = parId(S.camions, c.camionId) || S.camions[0] || null, jours = Math.max(2, Math.ceil((2 * k.km) / 650) + (k.traverse ? 2 : 0));
  const v = { id: "__devis", ref: "estimation", statut: "prevu", clientId: c.clientId, origine: c.origine, destination: c.destination, dateDepart: c.dateChargement || aujourdhui, dateRetourPrevue: dateISO(Date.parse((c.dateChargement || aujourdhui) + "T00:00:00Z") + (jours - 1) * 86400000),
    camionId: cam?.id || "", chauffeurId: c.chauffeurId || "", prix: 0, devise: "EUR", kmAller: k.km, kmRetourVide: k.km, jalons: [], traversees: [], tempMin: c.tempMin, tempMax: c.tempMax };
  if (k.traverse) for (const [sens, ligne] of [["aller", "tmed-alg"], ["retour", "alg-tmed"]]) { const t = nouvelleTraverseeDevis(sens, ligne), f = fretDetroitConnu(ligne); if (f) t.fret = f; else manques.push(`fret du détroit (${LIGNES_TRAVERSEE[ligne].lib}) : tarif de votre armateur à saisir dans Réglages`); v.traversees.push(t); }
  const ch = parId(S.chauffeurs, c.chauffeurId); if (ch && num(ch.perDiemJournalier)) v.fraisRouteMad = num(ch.perDiemJournalier) * (ch.perDiemDevise === "EUR" ? num(S.params.tauxEUR, 10.9) : 1) * jours; else manques.push("per diem du chauffeur");
  manques.push("péages (Maroc et Europe) non estimés sans trajet type");
  const m = margeVoyage(v), carbCompte = m.couts_directs.filter((l) => l.type === "carburant").reduce((s, l) => s + l.montant, 0);
  let carbAjout = 0; // sans pleins ni prix du jour, le modèle ne compte pas le gasoil : kilomètres × consommation × votre prix du gasoil
  if (!(carbCompte > 0)) { const conso = (cam && typeof consoMoyenne === "function" && consoMoyenne(cam.id)) || num(S.params.consoDefaut, 33); carbAjout = ((2 * k.km * conso) / 100) * num(S.params.prixGasoil, 12); manques.push("gasoil estimé au prix marocain de vos réglages (prix européens du jour non chargés)"); }
  return { mad: Math.round(m.total_direct + m.total_structure + carbAjout), source: "estimation", n: 0, km: k.km, jours, manques, detail: `${fmt(2 * k.km)} km aller-retour${k.traverse ? " par Tanger Med ⇄ Algeciras" : ""}, ${jours} jours` };
}
const nouvelleTraverseeDevis = (sens, ligne) => ({ sens, ligne, ml: 16.5, statut: "a_reserver", ...LIGNES_TRAVERSEE[ligne].defauts });
/** Chance de charger un retour près de la livraison, et prix médian de ces retours (€) : { proba, n, defaut, prixRetourEur, nPrix }. */
function chanceRetour(c, aujourdhui = today()) {
  const depuis = dateISO(Date.parse(aujourdhui + "T00:00:00Z") - 365 * 86400000);
  const l = S.voyages.filter((v) => v.statut !== "annule" && (v.dateDepart || "") >= depuis && v.dateDepart <= aujourdhui && memeLieu(v.destination, c.destination, 300));
  const avec = l.filter((v) => v.commandeRetourId || num(v.kmRetourCharge) > 0).length;
  const prix = S.commandes.filter((x) => x.paysDest === "Maroc" && x.paysOrigine && x.paysOrigine !== "Maroc" && num(x.prix) > 0 && !x.perdu && memeLieu(x.origine, c.destination, 300)).map((x) => (x.devise === "EUR" ? num(x.prix) : num(x.prix) / num(S.params.tauxEUR, 10.9)));
  const defaut = l.length < 3;
  return { proba: defaut ? 0.5 : avec / l.length, n: l.length, defaut, prixRetourEur: Math.round(mediane2(prix) || 0), nPrix: prix.length };
}
const arrondi10 = (x) => Math.round(x / 10) * 10;
/**
 * Prix conseillé d'une commande (dans sa devise) : { devise, cout, plancher, conseille, sansRetour, marge, retour, variantes: [{ marge, prix }], fiable }.
 * conseille = coût ÷ (1 − marge) − chance de retour × prix du retour ; plancher = coût − retour attendu ; sansRetour = coût ÷ (1 − marge).
 */
function prixConseille(c, { marge = num(S.params?.margeVisee, 15) / 100, aujourdhui = today() } = {}) {
  const cout = coutAllerRetour(c, aujourdhui), r = chanceRetour(c, aujourdhui), taux = num(S.params.tauxEUR, 10.9), devise = c.devise || "EUR", conv = (mad) => (devise === "EUR" ? mad / taux : mad);
  const retourAttendu = r.proba * (devise === "EUR" ? r.prixRetourEur : r.prixRetourEur * taux), coutDev = conv(cout.mad);
  const p = (m) => arrondi10(Math.max(0, coutDev / (1 - m) - retourAttendu));
  return { devise, cout: { ...cout, montant: Math.round(coutDev) }, retour: { ...r, attendu: Math.round(retourAttendu) }, marge, conseille: p(marge), plancher: arrondi10(Math.max(0, coutDev - retourAttendu)), sansRetour: arrondi10(coutDev / (1 - marge)),
    variantes: [0.1, 0.2].filter((x) => Math.abs(x - marge) > 0.001).map((x) => ({ marge: x, prix: p(x) })), fiable: cout.mad > 0 && (cout.source === "historique" || cout.manques.length <= 1) };
}
/** Prix passés : { client: [commandes du même client sur ce corridor], corridor: { mediane, n, devise } }. */
function historiquePrix(c) {
  const memeCorridor = (x) => x.id !== c.id && num(x.prix) > 0 && memeLieu(x.origine, c.origine) && memeLieu(x.destination, c.destination);
  const client = S.commandes.filter((x) => memeCorridor(x) && x.clientId === c.clientId).sort((a, b) => String(b.dateChargement).localeCompare(String(a.dateChargement))).slice(0, 5)
    .map((x) => ({ ref: x.ref, date: x.dateChargement, prix: num(x.prix), devise: x.devise || "EUR", gagne: x.statut !== "devis" && !x.perdu, perdu: !!x.perdu }));
  const devise = c.devise || "EUR", taux = num(S.params.tauxEUR, 10.9);
  const gagnes = S.commandes.filter((x) => memeCorridor(x) && x.statut !== "devis" && !x.perdu).map((x) => ((x.devise || "EUR") === devise ? num(x.prix) : devise === "EUR" ? num(x.prix) / taux : num(x.prix) * taux));
  return { client, corridor: { mediane: gagnes.length ? arrondi10(mediane2(gagnes)) : null, n: gagnes.length, devise } };
}

/* ---------- devis : envoi, réponse, taux de réussite ---------- */
/** Note un devis envoyé : prix, date, validité (jours). */
function noterDevis(c, { prix, validiteJours = 7, date = today() }) {
  c.prix = num(prix); c.devis = { prix: num(prix), devise: c.devise || "EUR", date, validite: dateISO(Date.parse(date + "T00:00:00Z") + validiteJours * 86400000) };
  delete c.perdu; return c.devis;
}
const MOTIFS_PERTE = [["prix", "Trop cher"], ["delai", "Délai ou date"], ["capacite", "Pas de camion disponible"], ["autre", "Autre"]];
function devisPerdu(c, { motif = "prix", prixConcurrent = 0, note = "" } = {}) { c.perdu = { date: today(), motif, ...(num(prixConcurrent) ? { prixConcurrent: num(prixConcurrent) } : {}), ...(note ? { note } : {}) }; return c.perdu; }
function devisAccepte(c) { delete c.perdu; if (c.statut === "devis") appliquerEtape(c, "confirme"); if (c.devis) c.devis.accepte = today(); return c; }
/** État d'un devis : "a_chiffrer" | "envoye" | "expire" | "gagne" | "perdu" | null (pas un devis). */
function etatDevis(c, aujourdhui = today()) {
  if (c.perdu) return "perdu";
  if (c.devis && c.statut !== "devis") return "gagne";
  if (c.statut !== "devis") return null;
  if (!c.devis) return "a_chiffrer";
  return c.devis.validite && c.devis.validite < aujourdhui ? "expire" : "envoye";
}
/** Taux de devis gagnés depuis une date : { envoyes, gagnes, perdus, enAttente, taux, motifs: { motif: n }, prixMoyenGagne, prixMoyenPerdu }. */
function tauxDevis(depuis = "", aujourdhui = today()) {
  const l = S.commandes.filter((c) => c.devis && (!depuis || c.devis.date >= depuis)), r = { envoyes: l.length, gagnes: 0, perdus: 0, enAttente: 0, motifs: {}, prixMoyenGagne: 0, prixMoyenPerdu: 0 };
  const g = [], p = [];
  for (const c of l) { const e = etatDevis(c, aujourdhui); if (e === "gagne") { r.gagnes++; g.push(versMAD(c.devis.prix, c.devis.devise)); } else if (e === "perdu") { r.perdus++; p.push(versMAD(c.devis.prix, c.devis.devise)); r.motifs[c.perdu.motif] = (r.motifs[c.perdu.motif] || 0) + 1; } else r.enAttente++; }
  r.taux = r.gagnes + r.perdus ? Math.round((r.gagnes / (r.gagnes + r.perdus)) * 100) : null;
  r.prixMoyenGagne = g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : 0; r.prixMoyenPerdu = p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : 0;
  return r;
}
/** Texte du devis à envoyer (français, anglais, espagnol selon le client). */
function texteDevis(c) {
  const cl = parId(S.clients, c.clientId) || {}, L = ["en", "es"].includes(cl.langueNotif) ? cl.langueNotif : "fr", d = c.devis || {}, k = typeof conditionsAttente === "function" ? conditionsAttente(c) : null;
  const prix = `${fmt(d.prix ?? c.prix, 0)} ${(d.devise || c.devise) === "EUR" ? "€" : "MAD"} HT`, date = (x) => (x ? x.split("-").reverse().join("/") : "—"), m = [c.palettes && `${c.palettes} pal.`, c.poids && `${fmt(c.poids)} kg`, Number.isFinite(c.tempMin) ? `${c.tempMin}${c.tempMax !== c.tempMin ? "/" + c.tempMax : ""} °C` : ""].filter(Boolean).join(", ");
  const att = k?.tarif ? { fr: ` Attente au-delà de ${k.franchiseH} h par quai : ${k.tarif} ${k.devise === "EUR" ? "€" : "MAD"}/h.`, en: ` Waiting time beyond ${k.franchiseH} h per dock: ${k.tarif} ${k.devise === "EUR" ? "€" : "MAD"}/h.`, es: ` Espera más allá de ${k.franchiseH} h por muelle: ${k.tarif} ${k.devise === "EUR" ? "€" : "MAD"}/h.` }[L] : "";
  const T = {
    fr: `Bonjour${cl.contact ? " " + cl.contact : ""},\n\nPour votre transport ${c.origine} → ${c.destination}${m ? ` (${m})` : ""}, chargement le ${date(c.dateChargement)} : ${prix}, traversée et péages inclus.${att}\nPrix valable jusqu'au ${date(d.validite)}.\n\nCordialement,\n${S.entreprise?.nom || ""}`,
    en: `Hello${cl.contact ? " " + cl.contact : ""},\n\nFor your shipment ${c.origine} → ${c.destination}${m ? ` (${m})` : ""}, loading on ${date(c.dateChargement)}: ${prix}, ferry and tolls included.${att}\nPrice valid until ${date(d.validite)}.\n\nBest regards,\n${S.entreprise?.nom || ""}`,
    es: `Buenos días${cl.contact ? " " + cl.contact : ""},\n\nPara su transporte ${c.origine} → ${c.destination}${m ? ` (${m})` : ""}, carga el ${date(c.dateChargement)}: ${prix}, travesía y peajes incluidos.${att}\nPrecio válido hasta el ${date(d.validite)}.\n\nSaludos cordiales,\n${S.entreprise?.nom || ""}`,
  };
  return { langue: L, texte: T[L].trim(), sujet: { fr: "Devis", en: "Quotation", es: "Presupuesto" }[L] + ` ${c.ref} — ${c.origine} → ${c.destination}` };
}
