"use strict";
/* ============================================================
   Pièces jointes des demandes — logique pure, testée.
   Le relais garde les pièces jointes des e-mails (serveur/pieces.js) ; ici :
   · quel document du client est chaque pièce, d'après son nom (« Facture FC-2211.pdf », « packing list 0087.xlsx »,
     « phyto.jpg ») — et, pour une seule pièce au nom muet (« scan0001.pdf »), d'après le message s'il ne cite qu'un document ;
     jamais une facture pro forma, ni une de nos propres factures renvoyée par le client ;
   · à quelle commande se rapporte un e-mail : sa référence (CMD-2026-0087) dans le sujet ou le texte, ou la référence du client
     dans le sujet ; rangement automatique seulement si l'expéditeur est bien ce client (même adresse, ou même domaine
     d'entreprise — jamais un domaine de messagerie gratuite) ;
   · les documents reconnus et attendus pour la commande sont cochés reçus, à la date de l'e-mail.
   Interface : pieces_demande_ui.js. Dépend de noyau.js, documents_commande.js (etatDocuments, noterDocument).
   ============================================================ */

/** Mots qui désignent chaque document (nom de fichier ou texte, sans accents, en minuscules, séparateurs en espaces). */
const MOTS_DOCS_PIECES = [
  ["facture", /\b(facture|factures|invoice|invoices|factura|facturas|fattura|rechnung)\b|فاتورة/],
  ["colisage", /\b(colisage|packing|packinglist|liste de colis|lista de bultos|lista de empaque|bultos)\b|\bp ?l\b(?= ?\d|$| )/],
  ["phyto", /(phyto|fitosanit|phytosanit)/],
  ["eacce", /\b(eacce|controle a l ?export|controle export|certificat de controle|export inspection)\b/],
  ["eur1", /\b(eur ?1|eur med|eurmed|certificat d ?origine|certificate of origin|certificado de origen)\b/],
  ["ched", /\b(ched|dsce)\b/],
  ["export_ue", /\b(mrn|dae|ead|export declaration|declaration d ?export|declaracion de exportacion)\b/],
];
const DOMAINES_GRATUITS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|proton|protonmail|menara|laposte|orange|free|sfr|wanadoo|yandex|mail|zoho)\./;
const normaliserPiece = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/[_\-.,;:()[\]#'’/\\+]+/g, " ").replace(/\s+/g, " ").trim();

/** Documents nommés dans un texte (nom de fichier, sujet, message) : liste d'identifiants (facture, colisage, phyto…). */
function documentsNommes(texte) {
  const t = normaliserPiece(texte);
  if (!t) return [];
  const sansProforma = t.replace(/\bpro ?forma\b \w+|\b\w+ pro ?forma\b|\bpro ?forma\b/g, " ");
  return MOTS_DOCS_PIECES.filter(([id, re]) => re.test(id === "facture" ? sansProforma : t)).map(([id]) => id);
}
/** Nos factures (numéros) apparaissent-elles dans ce nom ? Le client renvoie parfois la nôtre : ce n'est pas sa facture commerciale. */
const estNotreFacture = (nom) => { const t = normaliserPiece(nom); return (S.factures || []).some((f) => f.numero && t.includes(normaliserPiece(f.numero))); };

/**
 * Pièces d'une demande avec le document reconnu : [{ ...piece, docs: [id], devine, notre }].
 * devine : nom muet, document déduit du message (une seule pièce gardée, un seul document cité) ; notre : une de nos factures, jamais cochée.
 */
function reconnaitrePieces(d) {
  const l = (d?.pieces || []).map((p) => { const notre = estNotreFacture(p.nom); return { ...p, docs: notre ? [] : documentsNommes(p.nom), devine: false, notre }; });
  const gardees = l.filter((p) => p.garde), muettes = gardees.filter((p) => !p.docs.length && !p.notre);
  if (gardees.length === 1 && muettes.length === 1) {
    const cites = documentsNommes(`${d.sujet || ""} ${d.texte || ""}`);
    if (cites.length === 1) Object.assign(muettes[0], { docs: cites, devine: true });
  }
  return l;
}
/** Pièces gardées par le relais, pas encore rangées ni effacées. */
const piecesARanger = (d) => (d?.pieces || []).filter((p) => p.garde && !p.efface && !p.rangee);

/** Expression qui retrouve une référence quels que soient les séparateurs (CMD-2026-0087, cmd 2026 0087, CMD_2026_0087). */
const motifReference = (ref) => { const m = normaliserPiece(ref).split(" ").filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return m.length ? new RegExp(`(^|[^a-z0-9])${m.join("[ ]?")}($|[^a-z0-9])`) : null; };
/** Commandes citées par un e-mail : sa référence dans le sujet ou le texte, ou la référence du client (4 caractères au moins, avec un chiffre) dans le sujet. */
function commandesCitees(d, maintenant = Date.now()) {
  const sujet = normaliserPiece(d?.sujet), tout = `${sujet} ${normaliserPiece(d?.texte)}`, depuis = dateISO(maintenant - 120 * 86400000), r = [];
  for (const c of S.commandes || []) {
    if ((c.dateChargement || c.dateLivraison || today()) < depuis) continue;
    const parRef = c.ref && motifReference(c.ref)?.test(tout);
    const rc = String(c.refClient || "").trim(), parRefClient = rc.length >= 4 && /\d/.test(rc) && motifReference(rc)?.test(sujet);
    if (parRef || parRefClient) r.push(c);
  }
  return r;
}
/** La commande d'un e-mail, si une seule est citée. */
const commandePourDemande = (d, maintenant) => { const l = commandesCitees(d, maintenant); return l.length === 1 ? l[0] : null; };
/** L'expéditeur est-il le client de la commande ? Même adresse, ou même domaine d'entreprise (pas une messagerie gratuite). */
function expediteurDuClient(d, c) {
  const de = String(d?.de?.email || "").toLowerCase().trim(), cl = parId(S.clients, c?.clientId); if (!de || !cl) return false;
  const adresses = String(cl.email || "").toLowerCase().split(/[\s,;]+/).filter((x) => x.includes("@"));
  if (adresses.includes(de)) return true;
  const dom = de.split("@")[1] || "";
  return !!dom && !DOMAINES_GRATUITS.test(dom) && adresses.some((a) => a.split("@")[1] === dom);
}
/**
 * Rangement automatique : { c, pieces, classer } quand l'e-mail cite une seule commande, vient de son client et a des pièces à ranger.
 * classer : la demande peut être classée « documents rangés » (elle ne décrit pas un autre trajet que celui de la commande).
 */
function rangementAutomatique(d, lecture = null, maintenant = Date.now()) {
  const c = commandePourDemande(d, maintenant), pieces = piecesARanger(d);
  if (!c || !pieces.length || !expediteurDuClient(d, c)) return null;
  const ch = lecture?.champs || {}, memeLieu_ = (a, b) => !a || !b || normaliserPiece(a) === normaliserPiece(b);
  const autreTrajet = !!(ch.origine && ch.destination) && !(memeLieu_(ch.origine, c.origine) && memeLieu_(ch.destination, c.destination));
  return { c, pieces, classer: !autreTrajet };
}
/** Coche reçus les documents reconnus dans les pièces rangées (attendus et pas encore reçus) ; renvoie leurs libellés. */
function cocherDocumentsPieces(c, pieces, dateIso = new Date().toISOString()) {
  const attendus = etatDocuments(c).attendus, nouveaux = [];
  for (const p of pieces || []) for (const id of p.docs || []) {
    const x = attendus.find((a) => a.id === id && !a.nonRequis);
    if (!x || x.recu || nouveaux.includes(x.lib)) continue;
    noterDocument(c, id, { recu: Number.isFinite(Date.parse(dateIso)) ? new Date(dateIso).toISOString() : new Date().toISOString() }); nouveaux.push(x.lib);
  }
  return nouveaux;
}
