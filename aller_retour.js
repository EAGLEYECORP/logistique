"use strict";
/* ============================================================
   Un seul dossier par voyage, avec un aller et un retour — logique pure, testée.
   · une commande confirmée devient un voyage en un geste (client, villes, dates, prix, équipe, CMR repris) : voyage.commandeId ;
   · le chargement de retour est une seconde commande sur le même voyage (voyage.commandeRetourId) : son client, son prix, son CMR, sa facture ;
   · le voyage fait avancer ses commandes (un seul suivi) : chargée, en transit, en douane, livrée, d'après les étapes du voyage ;
   · recette du voyage = prix de l'aller + prix du retour ; rentabilité répartie entre les deux clients (au kilomètre chargé, sinon au prix) ;
   · une commande facturée par son voyage (ou l'inverse) ne peut pas l'être deux fois.
   Dépend de noyau.js (état S, appliquerEtape, factureDuVoyage, versMAD).
   ============================================================ */

const commandeAller = (v) => (v?.commandeId && parId(S.commandes, v.commandeId)) || null;
const commandeRetour = (v) => (v?.commandeRetourId && parId(S.commandes, v.commandeRetourId)) || null;
/** Le voyage qui porte une commande, et à quel titre : { v, sens: "aller" | "retour" } ou null. */
function voyageDeCommande(c) {
  if (!c) return null;
  for (const v of S.voyages) {
    if (v.statut === "annule") continue;
    if (v.commandeId === c.id) return { v, sens: "aller" };
    if (v.commandeRetourId === c.id) return { v, sens: "retour" };
  }
  return null;
}
/** Commandes déjà comptées par un voyage (aller ou retour) : elles ne comptent pas une seconde fois dans la rentabilité. */
const commandesLiees = () => new Set(S.voyages.filter((v) => v.statut !== "annule").flatMap((v) => [v.commandeId, v.commandeRetourId]).filter(Boolean));
/** Prix du retour en MAD (au taux du voyage) : celui de sa commande. */
function prixRetourMad(v, taux = tauxVoyage(v)) {
  const c = commandeRetour(v); if (!c) return 0;
  return c.devise === "EUR" ? num(c.prix) * taux : num(c.prix);
}
/**
 * Parts du voyage par client : [{ sens, clientId, ca, part }] — ca en MAD, part = fraction des coûts portée par ce trajet
 * (au kilomètre chargé quand aller et retour sont connus, sinon au prix). Sans retour : une seule part, 1.
 */
function partsVoyage(v) {
  const c = coutVoyage(v), retour = commandeRetour(v);
  if (!retour) return [{ sens: "aller", clientId: v.clientId || "", ca: c.prix, part: 1 }];
  const caR = c.prixRetour, caA = c.prix - caR, kmA = num(v.kmAller), kmR = num(v.kmRetourCharge);
  const partR = kmA > 0 && kmR > 0 ? kmR / (kmA + kmR) : c.prix > 0 ? caR / c.prix : 0.5;
  return [{ sens: "aller", clientId: v.clientId || "", ca: caA, part: 1 - partR }, { sens: "retour", clientId: retour.clientId || "", ca: caR, part: partR }];
}
/** Facture d'une commande : la sienne, ou celle de son voyage quand elle en est l'aller (facturée par le voyage). */
function factureDeCommande(c) {
  if (!c) return null;
  const f = c.factureId && parId(S.factures, c.factureId); if (f) return f;
  const l = voyageDeCommande(c);
  if (l?.sens === "aller") { const v = l.v, directe = (v.factureId && parId(S.factures, v.factureId)) || S.factures.find((x) => (x.voyageIds || []).includes(v.id)); if (directe) return directe; }
  return null;
}

/* ---------- commande → voyage ---------- */
const VILLE_DEPOT = () => S.entreprise?.ville || "";
/** Nouveau voyage pré-rempli d'après une commande (pas encore enregistré). Retour au dépôt estimé, à corriger : livraison + 4 j, sinon chargement + 8 j. */
function voyageDepuisCommande(c, { ref = "" } = {}) {
  return {
    ref: ref || `V-${(c.dateChargement || today()).slice(0, 4)}-${String(S.voyages.length + 1).padStart(4, "0")}`, statut: "prevu",
    clientId: c.clientId || "", commandeId: c.id, marchandise: c.marchandise || "", origine: c.origine || "", destination: c.destination || "",
    dateDepart: c.dateChargement || today(), dateRetourPrevue: dateISO(Date.parse((c.dateLivraison || c.dateChargement || today()) + "T00:00:00Z") + (c.dateLivraison ? 4 : 8) * 86400000), livraisonPrevue: c.dateLivraison ? `${c.dateLivraison}T12:00` : "",
    chauffeurId: c.chauffeurId || "", camionId: c.camionId || "", prix: num(c.prix), devise: c.devise || "EUR",
    ...(c.cmr ? { cmr: c.cmr } : {}), ...(c.refClient ? { refClient: c.refClient } : {}),
    ...(num(c.fraisChauffeur) ? { fraisRouteMad: num(c.fraisChauffeur) } : {}), ...(num(c.autres) ? { autresMad: num(c.autres) } : {}),
  };
}
/** Commande de retour pré-remplie d'après un voyage : chargement là où l'aller livre, livraison au départ de l'aller. */
function commandeRetourDepuisVoyage(v) {
  const aller = commandeAller(v), livre = (v.jalons || []).find((j) => j.type === "livre")?.date?.slice(0, 10) || (v.livraisonPrevue || "").slice(0, 10) || v.dateDepart || today();
  return { clientId: "", marchandise: "", origine: v.destination || aller?.destination || "", paysOrigine: aller?.paysDest || "Espagne", destination: aller?.origine || v.origine || VILLE_DEPOT(), paysDest: aller?.paysOrigine || "Maroc",
    dateChargement: livre, dateLivraison: v.dateRetourPrevue || "", devise: "EUR", chauffeurId: v.chauffeurId || "", camionId: v.camionId || "" };
}
/** Relie une commande comme retour d'un voyage. Lève une erreur si elle est déjà portée par un autre voyage ou si c'est l'aller. */
function lierRetour(v, c) {
  if (!v || !c) throw new Error("Voyage ou commande introuvable.");
  if (v.commandeId === c.id) throw new Error("Cette commande est déjà l'aller de ce voyage.");
  const deja = voyageDeCommande(c); if (deja && deja.v.id !== v.id) throw new Error(`Cette commande est déjà portée par le voyage ${deja.v.ref}.`);
  const avant = commandeRetour(v); if (avant && avant.id !== c.id) throw new Error(`Ce voyage a déjà un retour : ${avant.ref}. Retirez-le d'abord.`);
  v.commandeRetourId = c.id; c.chauffeurId = v.chauffeurId || c.chauffeurId || ""; c.camionId = v.camionId || c.camionId || "";
  if (c.statut === "devis") appliquerEtape(c, "confirme");
  return v;
}
const delierRetour = (v) => { const c = commandeRetour(v); delete v.commandeRetourId; return c; };

/* ---------- un seul suivi : les étapes du voyage font avancer ses commandes ---------- */
const ORDRE_CMD = ["devis", "confirme", "charge", "transit", "douane", "livre"];
const JALON_VERS_CMD = {
  aller: { douane_export: "charge", port_tmed: "transit", embarque_aller: "transit", debarque_alg: "douane", livre: "livre" },
  retour: { charge_retour: "charge", embarque_retour: "transit", debarque_tmed: "douane", douane_import: "douane", retour: "livre" },
};
/** Fait suivre aux commandes du voyage ses étapes (sans jamais revenir en arrière) et son équipe. Renvoie le nombre de changements. */
function synchroCommandesVoyage(v) {
  if (!v || v.statut === "annule") return 0;
  let n = 0;
  for (const [sens, c] of [["aller", commandeAller(v)], ["retour", commandeRetour(v)]]) {
    if (!c) continue;
    if (v.chauffeurId && c.chauffeurId !== v.chauffeurId) { c.chauffeurId = v.chauffeurId; n++; }
    if (v.camionId && c.camionId !== v.camionId) { c.camionId = v.camionId; n++; }
    const jalons = (v.jalons || []).filter((j) => JALON_VERS_CMD[sens][j.type]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const j of jalons) {
      const cible = JALON_VERS_CMD[sens][j.type];
      if (ORDRE_CMD.indexOf(cible) > ORDRE_CMD.indexOf(c.statut)) { const d = new Date(j.date); appliquerEtape(c, cible, Number.isFinite(d.getTime()) ? d : new Date()); n++; }
    }
    if (sens === "aller" && c.statut === "devis") { appliquerEtape(c, "confirme"); n++; }
  }
  return n;
}
/** Retire les liens vers des commandes supprimées, puis fait suivre toutes les commandes à leurs voyages. */
function synchroToutesCommandes() {
  let n = 0;
  for (const v of S.voyages) {
    if (v.commandeRetourId && !commandeRetour(v)) { delete v.commandeRetourId; n++; }
    if (v.commandeId && !commandeAller(v)) { delete v.commandeId; n++; }
    n += synchroCommandesVoyage(v);
  }
  return n;
}
