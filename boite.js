"use strict";
/* ============================================================
   Boîte des demandes — logique pure, testée.
   Les e-mails relevés par le relais (serveur/imap.js) et les messages partagés depuis WhatsApp arrivent ici ;
   chacun est lu comme une demande de transport (lecture_commande.js), puis trié : commande créée, devis, ignoré.
   · sans doublon (même identifiant, même Message-ID, même texte le même jour) ;
   · « pertinence » : les vraies demandes de transport d'abord, les lettres d'information à part ;
   · la date du message sert de référence pour lire « jeudi », « demain », « le 20 ».
   Dépend de noyau.js et lecture_commande.js.
   ============================================================ */

const SOURCES_DEMANDE = { email: "E-mail", whatsapp: "WhatsApp", collee: "Message collé" };
const STATUTS_DEMANDE = [["a_trier", "À trier"], ["commande", "Commande créée"], ["devis", "Devis"], ["ignoree", "Ignorée"]];
const MAX_DEMANDES = 500;
/** Empreinte courte d'un texte (FNV-1a), pour les messages sans identifiant (partage, collage). */
const empreinte = (t) => { let h = 0x811c9dc5; for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const jourDe = (iso) => String(iso || "").slice(0, 10);

/** Le texte à lire : l'expéditeur et le sujet en tête (le client est reconnu à son adresse), puis le message. */
function texteDemande(d) {
  const de = d?.de?.email ? `De : ${d.de.nom ? `${d.de.nom} <${d.de.email}>` : d.de.email}` : d?.de?.nom ? `De : ${d.de.nom}` : "";
  return [de, d?.sujet ? `Objet : ${d.sujet}` : "", de || d?.sujet ? "" : null, d?.texte || ""].filter((x) => x !== null).join("\n").trim();
}
/** Lecture de la demande, à la date du message. */
function lectureDemande(d) { return lireDemande(texteDemande(d), { aujourdhui: jourDe(d?.date) || today() }); }

const MOTS_TRANSPORT = /(transport|chargement|charger|livraison|livrer|camion|semi|remorque|frigo|palette|tonne|devis|cotation|tarif|prix|enl[eè]vement|loading|delivery|truck|trailer|reefer|pallet|quot|freight|carga|descarga|cami[oó]n|palet|cotizaci|flete|نقل|شاحنة|حمولة)/i;
/** Plus c'est haut, plus le message ressemble à une demande de transport (trajet, date, quantités, client connu, vocabulaire). */
function pertinenceDemande(d, r = lectureDemande(d)) {
  let p = 0;
  if (r.champs.origine && r.champs.destination) p += 3;
  if (r.champs.dateChargement) p += 1;
  if (r.champs.palettes || r.champs.poids) p += 1;
  if (r.champs.clientId) p += 2;
  if (MOTS_TRANSPORT.test(`${d.sujet || ""} ${d.texte || ""}`)) p += 2;
  if (d.masse) p -= 5;
  return p;
}
/** Ce que propose la boîte : « chiffrer » si le client demande un prix ou n'en donne pas, sinon « commande ». */
const suiteDemande = (r) => (r.demandePrix || !r.champs.prix ? "chiffrer" : "commande");

/** Résumé en une ligne de ce qui a été lu : « Agadir → Perpignan · 19/11 · 26 palettes · 4 °C · 1 900 € ». */
function resumeDemande(r) {
  const c = r.champs, l = [];
  if (c.origine || c.destination) l.push(`${c.origine || "?"} → ${c.destination || "?"}`);
  if (c.dateChargement) l.push(`chargement ${dateFr(c.dateChargement)}`);
  if (c.palettes) l.push(`${c.palettes} palette${c.palettes > 1 ? "s" : ""}`);
  if (c.poids) l.push(`${fmt(c.poids)} kg`);
  if (c.tempMin !== undefined) l.push(c.tempMin === c.tempMax ? `${c.tempMin} °C` : `${c.tempMin} à ${c.tempMax} °C`);
  if (c.prix) l.push(`${fmt(c.prix)} ${c.devise === "MAD" ? "MAD" : "€"}`);
  return l.join(" · ");
}

/**
 * Ajoute des messages à la boîte, sans doublon. liste : [{ id?, messageId?, de: { nom, email }, sujet, date, texte, pieces, masse, recu }].
 * Renvoie les demandes ajoutées.
 */
function ajouterDemandes(liste, source = "email", maintenant = Date.now()) {
  S.demandes ||= []; const ajoutees = [];
  for (const x of liste || []) {
    const texte = String(x?.texte || "").trim(), sujet = String(x?.sujet || "").trim();
    if (!texte && !sujet) continue;
    const date = x.date && Number.isFinite(Date.parse(x.date)) ? new Date(x.date).toISOString() : new Date(maintenant).toISOString();
    const id = String(x.id || `${source}-${empreinte(texte + sujet)}-${jourDe(date)}`);
    if (S.demandes.some((d) => d.id === id || (x.messageId && d.messageId === x.messageId) || (d.texte === texte && d.sujet === sujet && jourDe(d.date) === jourDe(date)))) continue;
    const d = { id, source, messageId: String(x.messageId || ""), de: { nom: String(x.de?.nom || "").slice(0, 120), email: String(x.de?.email || "").slice(0, 160).toLowerCase() }, sujet: sujet.slice(0, 300), date,
      texte: texte.slice(0, 12000), pieces: (x.pieces || []).slice(0, 20).map((p) => ({ nom: String(p.nom || "").slice(0, 120), type: String(p.type || "") })), masse: !!x.masse, tronque: !!x.tronque, statut: "a_trier", recu: Number(x.recu) || maintenant };
    S.demandes.push(d); ajoutees.push(d);
  }
  S.demandes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (S.demandes.length > MAX_DEMANDES) { // on oublie d'abord les plus anciennes déjà triées
    const triees = S.demandes.filter((d) => d.statut !== "a_trier"), trop = S.demandes.length - MAX_DEMANDES, oublier = new Set(triees.slice(-trop).map((d) => d.id));
    S.demandes = S.demandes.filter((d) => !oublier.has(d.id)).slice(0, MAX_DEMANDES);
  }
  return ajoutees;
}
/** Message partagé vers l'application (WhatsApp, SMS, autre application) : { titre, texte, lien } → demande. */
function demandeDepuisPartage({ titre = "", texte = "", lien = "" } = {}, maintenant = Date.now()) {
  const t = [String(texte || "").trim(), String(lien || "").trim()].filter(Boolean).join("\n");
  if (!t && !String(titre || "").trim()) return null;
  // « [17/11/2026, 08:14] Karim Souss: … » (message transféré depuis une discussion) : l'auteur devient l'expéditeur
  const m = t.match(/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?([^:\n]{2,60}):\s/);
  return { de: { nom: m ? m[1].trim() : String(titre || "").trim().slice(0, 120), email: "" }, sujet: "", texte: t, date: new Date(maintenant).toISOString() };
}
/** Classe une demande : statut, date, commande créée. */
function classerDemande(d, statut, { commandeId = "" } = {}, maintenant = Date.now()) {
  if (!d || !STATUTS_DEMANDE.some(([k]) => k === statut)) return false;
  d.statut = statut;
  if (statut === "a_trier") { delete d.traiteLe; delete d.commandeId; } else d.traiteLe = new Date(maintenant).toISOString();
  if (commandeId) d.commandeId = commandeId;
  return true;
}
/** Demandes à trier (les lettres d'information à part). */
const demandesATrier = () => (S.demandes || []).filter((d) => d.statut === "a_trier" && !d.masse);
/** Alerte de l'accueil : demandes en attente, urgente au-delà de 24 heures sans réponse. */
function alertesDemandes(maintenant = Date.now()) {
  const l = demandesATrier(); if (!l.length) return [];
  const vieille = l.some((d) => maintenant - Date.parse(d.date) > 24 * 3600000);
  return [{ niveau: vieille ? "danger" : "warn", texte: `${l.length} demande${l.length > 1 ? "s" : ""} de transport à trier${vieille ? " (dont une depuis plus de 24 h)" : ""}`, cle: "demandes:a_trier" }];
}
