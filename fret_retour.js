"use strict";
/* ============================================================
   Recherche du fret de retour — logique pure, testée.
   · voyages partis vers l'Europe sans retour chargé : jours avant la livraison, prix plancher du retour (coût complet − prix de l'aller) ;
   · carnet de chargeurs de retour : vos clients marqués « chargeur de retour », avec leurs villes de chargement ;
     classés par distance à la livraison de l'aller, puis par historique (dernier prix payé, nombre de retours, dernier contact) ;
   · message de disponibilité (« frigo libre à Perpignan le 18/11, retour Maroc ») en français, espagnol ou anglais ;
   · alerte à J-3 de la livraison sans retour (urgente la veille et après livraison) ; « rentrer à vide » l'éteint.
   Dépend de noyau.js, gps.js (villeConnue, gpsDistance), rentabilite.js (margeVoyage), aller_retour.js.
   ============================================================ */

const COORDS_RETOUR = { "avignon": [43.9493, 4.8055], "cavaillon": [43.8376, 5.0381], "chateaurenard": [43.8828, 4.8547], "le boulou": [42.5244, 2.8333], "la jonquera": [42.4196, 2.875], "alicante": [38.3452, -0.481],
  "tarragone": [41.1189, 1.2445], "huelva": [37.2614, -6.9447], "grenade": [37.1773, -3.5986], "cologne": [50.9375, 6.9603], "dusseldorf": [51.2277, 6.7735], "stuttgart": [48.7758, 9.1829], "berlin": [52.52, 13.405],
  "verone": [45.4384, 10.9916], "irun": [43.3381, -1.7889], "strasbourg": [48.5734, 7.7521], "porto": [41.1579, -8.6291] };
const sansAcc = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Coordonnées d'une ville (table des villes de l'application, puis table complémentaire). */
function coordsVille(nom) {
  const k = sansAcc(nom).replace(/-/g, " ");
  return (typeof villeConnue === "function" && villeConnue(nom)) || COORDS_RETOUR[k] || null;
}
const kmEntre = (a, b) => (a && b ? gpsDistance([0, a[0], a[1]], [0, b[0], b[1]]) / 1000 : null);
const jalonFaitV = (v, t) => (v.jalons || []).some((j) => j.type === t);
/** Le voyage a-t-il besoin d'un retour ? Parti (ou prévu) vers l'Europe, pas de retour chargé, pas « à vide » décidé. */
function chercheRetour(v) {
  if (!v || ["annule", "termine"].includes(v.statut) || v.commandeRetourId || v.retourTrouve || v.retourAVide || num(v.kmRetourCharge) > 0 || jalonFaitV(v, "charge_retour") || jalonFaitV(v, "embarque_retour")) return false;
  const c = typeof commandeAller === "function" ? commandeAller(v) : null;
  const pays = c?.paysDest || (coordsVille(v.destination) && (coordsVille(v.destination)[0] > 36 ? "Europe" : "")) || "";
  return pays !== "Maroc" && pays !== "";
}
/** Date de livraison de l'aller : livré, sinon promis, sinon départ + 3 jours. */
function livraisonAller(v) {
  const l = (v.jalons || []).find((j) => j.type === "livre"); if (l) return String(l.date).slice(0, 10);
  if (v.livraisonPrevue) return String(v.livraisonPrevue).slice(0, 10);
  return v.dateDepart ? dateISO(Date.parse(v.dateDepart + "T00:00:00Z") + 3 * 86400000) : "";
}
/** Prix plancher du retour : en dessous, l'aller-retour perd de l'argent. { mad, eur, couvert }. */
function plancherRetour(v) {
  const m = margeVoyage(v), complet = m.total_direct + m.total_structure, mad = Math.max(0, complet - m.revenu);
  return { mad: Math.round(mad), eur: Math.round(mad / num(S.params.tauxEUR, 10.9)), couvert: m.revenu >= complet };
}
/** Voyages sans retour : [{ v, livraison, jours, livre, plancher }], les plus urgents d'abord. */
function retoursATrouver(aujourdhui = today()) {
  return S.voyages.filter(chercheRetour).map((v) => { const livraison = livraisonAller(v); return { v, livraison, jours: livraison ? joursEntre(aujourdhui, livraison) : 99, livre: jalonFaitV(v, "livre"), plancher: plancherRetour(v) }; }).sort((a, b) => a.jours - b.jours);
}
/** Villes de chargement de retour d'un client (sa ville et sa liste). */
const villesRetourClient = (cl) => [...new Set([cl.ville, ...String(cl.villesRetour || "").split(/[,;\n]/)].map((x) => String(x || "").trim()).filter(Boolean))];
/** Historique de retours d'un client : commandes vers le Maroc depuis l'Europe. { nb, dernierPrix, devise, derniereDate }. */
function historiqueRetour(clientId) {
  const l = S.commandes.filter((c) => c.clientId === clientId && c.paysDest === "Maroc" && c.paysOrigine && c.paysOrigine !== "Maroc" && c.prix).sort((a, b) => String(b.dateChargement).localeCompare(String(a.dateChargement)));
  return { nb: l.length, dernierPrix: l[0] ? num(l[0].prix) : 0, devise: l[0]?.devise || "EUR", derniereDate: l[0]?.dateChargement || "" };
}
/**
 * Chargeurs de retour pour un voyage : [{ client, ville, km, nb, dernierPrix, devise, derniereDate, dernierContact }].
 * Chargeurs marqués « retour » (ou ayant déjà donné un retour), dans un rayon de `rayonKm` autour de la livraison de l'aller ; les plus proches puis les plus fidèles d'abord.
 */
function chargeursPour(v, { rayonKm = 300 } = {}) {
  const dest = coordsVille(v.destination), r = [];
  for (const cl of S.clients) {
    const h = historiqueRetour(cl.id); if (!cl.chargeurRetour && !h.nb) continue;
    const villes = villesRetourClient(cl).map((ville) => ({ ville, km: kmEntre(dest, coordsVille(ville)) ?? (sansAcc(ville) === sansAcc(v.destination) ? 0 : null) }));
    const meilleur = villes.filter((x) => x.km !== null).sort((a, b) => a.km - b.km)[0];
    if (!meilleur || meilleur.km > rayonKm) continue;
    const contacts = (cl.contactsRetour || []).map((x) => x.date).sort();
    r.push({ client: cl, ville: meilleur.ville, km: Math.round(meilleur.km), ...h, dernierContact: contacts[contacts.length - 1] || "" });
  }
  return r.sort((a, b) => Math.round(a.km / 50) - Math.round(b.km / 50) || b.nb - a.nb || String(b.derniereDate).localeCompare(String(a.derniereDate)));
}

/* ---------- message de disponibilité ---------- */
const MODELES_DISPO = {
  fr: (x) => `Bonjour${x.contact ? " " + x.contact : ""},\n\nNous avons un ${x.frigo ? "camion frigorifique" : "semi-remorque"} disponible à ${x.ville} le ${x.date}, retour vers le Maroc (${x.vers}).${x.frigo ? " Température dirigée possible." : ""} Capacité : 33 palettes, 24 t.\n\nAvez-vous un chargement ? Merci de nous répondre rapidement.\n\n${x.societe}`,
  es: (x) => `Buenos días${x.contact ? " " + x.contact : ""},\n\nTenemos un ${x.frigo ? "camión frigorífico" : "semirremolque"} disponible en ${x.ville} el ${x.date}, con regreso a Marruecos (${x.vers}).${x.frigo ? " Posibilidad de temperatura controlada." : ""} Capacidad: 33 palés, 24 t.\n\n¿Tienen alguna carga? Quedamos a la espera de su respuesta.\n\n${x.societe}`,
  en: (x) => `Hello${x.contact ? " " + x.contact : ""},\n\nWe have a ${x.frigo ? "reefer truck" : "tautliner"} available in ${x.ville} on ${x.date}, returning to Morocco (${x.vers}).${x.frigo ? " Temperature control available." : ""} Capacity: 33 pallets, 24 t.\n\nDo you have a load for us? Looking forward to your reply.\n\n${x.societe}`,
};
const langueParPays = (pays) => (pays === "Espagne" ? "es" : ["France", "Belgique", "Maroc", "Suisse"].includes(pays) ? "fr" : "en");
/** Message de disponibilité pour un chargeur (ou générique, pour un groupe WhatsApp) : { langue, texte, sujet }. */
function messageDisponibilite(v, client = null) {
  const cam = parId(S.camions, v.camionId), aller = typeof commandeAller === "function" ? commandeAller(v) : null;
  const langue = client?.langueNotif && MODELES_DISPO[client.langueNotif] ? client.langueNotif : langueParPays(client?.pays || aller?.paysDest || "France");
  const date = livraisonAller(v).split("-").reverse().join("/"), vers = [...new Set(["Tanger Med", v.origine].filter(Boolean))].join(" → ");
  const texte = MODELES_DISPO[langue]({ contact: client?.contact || "", frigo: Number.isFinite(v.tempMin) || Number.isFinite(aller?.tempMin) || !!cam?.froid, ville: v.destination || "?", date, vers, societe: S.entreprise?.nom || "" }).trim();
  return { langue, texte, sujet: { fr: `Camion disponible ${v.destination} le ${date} — retour Maroc`, es: `Camión disponible en ${v.destination} el ${date} — regreso Marruecos`, en: `Truck available ${v.destination} ${date} — return to Morocco` }[langue] };
}
/** Note un contact de recherche de retour sur la fiche du client. */
function noterContactRetour(cl, v) { cl.contactsRetour = [...(cl.contactsRetour || []), { date: new Date().toISOString(), voyageId: v.id }].slice(-30); }

/** Alertes : retour non trouvé à J-3 de la livraison (urgente la veille, et après livraison). */
function alertesRetour(aujourdhui = today()) {
  return retoursATrouver(aujourdhui).filter((x) => x.jours <= 3).map((x) => ({ niveau: x.livre || x.jours <= 1 ? "danger" : "warn", cle: `voy:${x.v.id}:retour`,
    texte: `Voyage ${x.v.ref} — ${x.livre ? "livré" : x.jours <= 0 ? "livre aujourd'hui" : `livre dans ${x.jours} j`} à ${x.v.destination}, pas encore de retour${x.plancher.couvert ? "" : ` (prix plancher ${fmt(x.plancher.eur)} €)`}` }));
}
