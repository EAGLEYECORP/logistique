"use strict";
/* ============================================================
   Documents attendus du client pour chaque commande — logique pure, testée.
   · la liste dépend du sens (export du Maroc vers l'Union, import au Maroc depuis l'Union) et de la marchandise (fraîche ou sèche) ;
   · chaque document : reçu (date, référence), manquant, ou « non requis » pour cette commande ;
   · un document bloquant manquant à J-3 du chargement lève une alerte (urgente la veille) et un point « à régler » sur le voyage ;
   · message de demande des manquants au client, dans sa langue (français, anglais, espagnol).
   Liste de départ à confirmer avec votre transitaire. Dépend de noyau.js (état S, dates).
   ============================================================ */

const PAYS_UE = ["Espagne", "France", "Portugal", "Italie", "Belgique", "Pays-Bas", "Allemagne"];
const FRAIS_MOTS = /(fruit|legume|agrume|clementine|mandarin|orange|tomate|poivron|courgette|concombre|haricot|fraise|framboise|myrtille|avocat|pasteque|melon|pomme de terre|oignon|primeur|plante|fleur|poisson|sardine)/;
const sansAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Sens douanier d'une commande : "export" (Maroc → Union), "import" (Union → Maroc), "national" ou "autre". */
function sensCommande(c) {
  const o = c?.paysOrigine || "Maroc", d = c?.paysDest || "";
  if (o === d) return "national";
  if (o === "Maroc" && PAYS_UE.includes(d)) return "export";
  if (d === "Maroc" && PAYS_UE.includes(o)) return "import";
  return "autre";
}
const marchandiseFraiche = (c) => Number.isFinite(c?.tempMin) || Number.isFinite(c?.tempMax) || FRAIS_MOTS.test(sansAccents(c?.marchandise));

/** Catalogue : [id, libellé, qui le fournit, bloquant, condition(sens, frais)]. */
const DOCS_CLIENT = [
  ["facture", { fr: "Facture commerciale", en: "Commercial invoice", es: "Factura comercial" }, "Expéditeur", true, (s) => s !== "national"],
  ["colisage", { fr: "Liste de colisage", en: "Packing list", es: "Lista de bultos (packing list)" }, "Expéditeur", true, (s) => s !== "national"],
  ["eur1", { fr: "Certificat d'origine EUR.1 / EUR-MED", en: "EUR.1 / EUR-MED origin certificate", es: "Certificado de origen EUR.1 / EUR-MED" }, "Expéditeur", false, (s) => s === "export" || s === "import"],
  ["eacce", { fr: "Certificat de contrôle à l'export (EACCE)", en: "Export inspection certificate (EACCE)", es: "Certificado de control de exportación (EACCE)" }, "Expéditeur", true, (s, f) => s === "export" && f],
  ["phyto", { fr: "Certificat phytosanitaire", en: "Phytosanitary certificate", es: "Certificado fitosanitario" }, "Expéditeur", true, (s, f) => s === "export" && f],
  ["ched", { fr: "CHED partie I déposé dans TRACES", en: "CHED part I lodged in TRACES", es: "DSCE/CHED parte I presentado en TRACES" }, "Importateur", true, (s, f) => s === "export" && f],
  ["export_ue", { fr: "Déclaration d'export UE (MRN)", en: "EU export declaration (MRN)", es: "Declaración de exportación UE (MRN)" }, "Expéditeur", true, (s) => s === "import"],
  ["livraison", { fr: "Adresse de livraison et créneau", en: "Delivery address and time slot", es: "Dirección y horario de entrega" }, "Destinataire", false, () => true],
];
const libDoc = (id, langue = "fr") => { const d = DOCS_CLIENT.find((x) => x[0] === id); return d ? d[1][langue] || d[1].fr : id; };

/**
 * État des documents d'une commande : { sens, frais, attendus: [{ id, lib, qui, bloquant, recu, ref, nonRequis }], recus, manquants, bloquantsManquants, complet, total }.
 * c.documents = { [id]: { recu: ISO, ref, nonRequis } }.
 */
function etatDocuments(c) {
  const s = sensCommande(c), f = marchandiseFraiche(c), d = c?.documents || {};
  const attendus = DOCS_CLIENT.filter(([, , , , cond]) => cond(s, f)).map(([id, lib, qui, bloquant]) => ({ id, lib: lib.fr, qui, bloquant, recu: d[id]?.recu || "", ref: d[id]?.ref || "", nonRequis: !!d[id]?.nonRequis }));
  const utiles = attendus.filter((x) => !x.nonRequis), manquants = utiles.filter((x) => !x.recu);
  return { sens: s, frais: f, attendus, recus: utiles.length - manquants.length, total: utiles.length, manquants, bloquantsManquants: manquants.filter((x) => x.bloquant), complet: !manquants.length };
}
/** Note un document : reçu (avec référence), manquant, ou non requis. */
function noterDocument(c, id, { recu = null, ref, nonRequis } = {}) {
  c.documents ||= {};
  const x = { ...(c.documents[id] || {}) };
  if (recu === true) x.recu = new Date().toISOString(); else if (typeof recu === "string") x.recu = recu; else if (recu === false) delete x.recu;
  if (ref !== undefined) { if (String(ref).trim()) x.ref = String(ref).trim().slice(0, 60); else delete x.ref; }
  if (nonRequis !== undefined) { if (nonRequis) x.nonRequis = true; else delete x.nonRequis; }
  if (Object.keys(x).length) c.documents[id] = x; else delete c.documents[id];
  return c.documents[id] || null;
}

/** Alertes : commandes à charger dans 3 jours ou moins avec un document bloquant manquant. [{ niveau, texte, cle, commandeId }]. */
function alertesDocuments(aujourdhui = today()) {
  const r = [];
  for (const c of S.commandes || []) {
    if (!["devis", "confirme"].includes(c.statut) || !c.dateChargement || c.perdu) continue;
    const j = joursEntre(aujourdhui, c.dateChargement); if (j > 3) continue;
    const e = etatDocuments(c); if (!e.bloquantsManquants.length) continue;
    r.push({ niveau: j <= 1 ? "danger" : "warn", commandeId: c.id, cle: `cmd:${c.id}:docs`, texte: `Commande ${c.ref} — chargement ${j < 0 ? "en retard" : j === 0 ? "aujourd'hui" : j === 1 ? "demain" : `dans ${j} j`}, documents manquants : ${e.bloquantsManquants.map((x) => x.lib).join(", ")}` });
  }
  return r;
}
/** Points « à régler » d'un voyage : documents bloquants manquants de sa commande aller (et de son retour). */
function controlesDocumentsVoyage(v) {
  const r = [];
  for (const [sens, id] of [["aller", v.commandeId], ["retour", v.commandeRetourId]]) {
    const c = id && parId(S.commandes, id); if (!c || !["devis", "confirme"].includes(c.statut)) continue; // une fois chargée, la question est réglée
    const e = etatDocuments(c); if (e.bloquantsManquants.length) r.push({ niveau: sens === "aller" ? "danger" : "warn", texte: `Documents ${sens === "aller" ? "de l'aller" : "du retour"} manquants (${c.ref}) : ${e.bloquantsManquants.map((x) => x.lib).join(", ")}` });
  }
  return r;
}

/* ---------- demande au client ---------- */
const MODELES_DEMANDE_DOCS = {
  fr: { salut: "Bonjour", corps: (ref, trajet, date) => `pour votre transport ${trajet}${ref ? ` (réf. ${ref})` : ""}, chargement prévu le ${date}, il nous manque :`, fin: "Merci de nous les envoyer avant le chargement pour éviter toute attente au port.", sign: "Cordialement" },
  en: { salut: "Hello", corps: (ref, trajet, date) => `for your shipment ${trajet}${ref ? ` (ref. ${ref})` : ""}, loading planned on ${date}, we are still missing:`, fin: "Please send them before loading to avoid any waiting time at the port.", sign: "Best regards" },
  es: { salut: "Buenos días", corps: (ref, trajet, date) => `para su transporte ${trajet}${ref ? ` (ref. ${ref})` : ""}, con carga prevista el ${date}, nos faltan:`, fin: "Les rogamos que nos los envíen antes de la carga para evitar esperas en el puerto.", sign: "Saludos cordiales" },
};
/** Message de demande des documents manquants : { langue, sujet, texte, manquants }. */
function demandeDocuments(c) {
  const cl = parId(S.clients, c.clientId), langue = MODELES_DEMANDE_DOCS[cl?.langueNotif] ? cl.langueNotif : "fr", M = MODELES_DEMANDE_DOCS[langue], e = etatDocuments(c);
  const date = c.dateChargement ? c.dateChargement.split("-").reverse().join("/") : "—", trajet = `${c.origine || "?"} → ${c.destination || "?"}`;
  const lignes = e.manquants.map((x) => `- ${libDoc(x.id, langue)}`).join("\n");
  const texte = `${M.salut}${cl?.contact ? " " + cl.contact : ""},\n\n${M.corps(c.refClient || c.ref, trajet, date)}\n${lignes}\n\n${M.fin}\n\n${M.sign},\n${S.entreprise?.nom || ""}`.trim();
  return { langue, sujet: `${c.ref}${c.refClient ? " / " + c.refClient : ""} — ${langue === "en" ? "documents" : langue === "es" ? "documentos" : "documents"} ${trajet}`, texte, manquants: e.manquants };
}
