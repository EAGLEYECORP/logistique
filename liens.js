"use strict";
/* ============================================================
   Liens sans compte — logique pure, testée.
   · lien de dépôt d'une commande : documents attendus dans la langue du client, déjà reçus marqués ; les fichiers reçus marquent les documents ;
   · lien transitaire d'un voyage : étapes de port des deux sens (détroit) avec ce qui est déjà fait ; les étapes notées par le transitaire
     sont appliquées au voyage (une étape notée à la main ou par le GPS n'est jamais écrasée) ;
   · messages d'envoi du lien.
   Le relais sert les pages et garde les fichiers (serveur/liens.js). Dépend de noyau.js, documents_commande.js, portuaire.js, passages.js.
   ============================================================ */

const langueClientLien = (c) => { const cl = parId(S.clients, c?.clientId); return ["fr", "en", "es"].includes(cl?.langueNotif) ? cl.langueNotif : "fr"; };
/** Un lien est-il encore utilisable (au moins une journée de validité) ? */
const lienActif = (l, maintenant = Date.now()) => !!(l?.id && l.expire * 1000 > maintenant + 86400000);

/** Ce que l'application envoie au relais pour le lien de dépôt d'une commande. */
function corpsLienDepot(c, { jours } = {}) {
  const e = etatDocuments(c), langue = langueClientLien(c);
  return { type: "depot", titre: `${c.refClient || c.ref || ""}${c.origine || c.destination ? ` · ${c.origine || "?"} → ${c.destination || "?"}` : ""}`.trim(), entreprise: S.entreprise?.nom || "", langue, ...(jours ? { jours } : {}),
    docs: e.attendus.filter((x) => !x.nonRequis).map((x) => ({ id: x.id, lib: libDoc(x.id, langue), recu: !!x.recu })) };
}
/** Fichiers reçus par le lien : les documents correspondants sont marqués reçus (à la date d'envoi). Renvoie les libellés nouvellement reçus. */
function documentsRecusParLien(c, fichiers) {
  const attendus = etatDocuments(c).attendus, nouveaux = [];
  for (const f of fichiers || []) {
    const d = attendus.find((x) => x.id === f.doc);
    if (!d || d.recu || nouveaux.includes(d.lib)) continue;
    noterDocument(c, d.id, { recu: new Date(f.t || Date.now()).toISOString() }); nouveaux.push(d.lib);
  }
  return nouveaux;
}

/** Ce que l'application envoie au relais pour le lien transitaire d'un voyage. */
function corpsLienTransit(v, { jours } = {}) {
  const etapes = [];
  for (const sens of ["aller", "retour"]) {
    if (!sensParDetroit(v, sens)) continue;
    for (const x of chainePassage(v, sens)) etapes.push({ id: x.e.id, lib: x.e.lib, port: PORTS_PASSAGE[x.port]?.lib || x.port, refLib: x.e.ref || "", detail: x.e.detail || "", docs: x.e.docs || [], fait: !!x.s.fait, date: x.s.fait ? x.s.date || "" : "", ref: x.s.ref || "" });
  }
  const cam = parId(S.camions, v.camionId);
  return { type: "transit", titre: [v.ref, cam?.immat, v.remorque].filter(Boolean).join(" · "), entreprise: S.entreprise?.nom || "", langue: "fr", ...(jours ? { jours } : {}), etapes };
}
/**
 * Étapes notées par le transitaire depuis la dernière lecture → appliquées au voyage. Renvoie [{ etape, lib, annule }].
 * Une étape déjà notée autrement (à la main, par le GPS) n'est pas écrasée ; une annulation n'efface que ce que le transitaire avait noté.
 */
function appliquerEvenementsTransit(v, evenements) {
  const vus = num(v.lienTransit?.vus, 0), faits = [];
  for (const ev of [...(evenements || [])].filter((x) => x.n > vus).sort((a, b) => a.n - b.n)) {
    const e = etapePort(ev.etape); if (!e) continue;
    const avant = v.etapesPort?.[ev.etape], sienne = avant?.par === "transitaire";
    if (ev.annule) { if (sienne) { annulerEtapePort(v, ev.etape); faits.push({ etape: ev.etape, lib: e.lib, annule: true }); } continue; }
    if (avant && !sienne) continue;
    if (sienne) annulerEtapePort(v, ev.etape);
    marquerEtapePort(v, ev.etape, { date: ev.date, ref: ev.ref, note: ev.note ? `Transitaire : ${ev.note}` : "Noté par le transitaire" });
    v.etapesPort[ev.etape].par = "transitaire"; faits.push({ etape: ev.etape, lib: e.lib });
  }
  if (v.lienTransit && (evenements || []).length) v.lienTransit.vus = Math.max(vus, ...evenements.map((x) => num(x.n, 0)));
  return faits;
}

const MESSAGES_LIEN = {
  fr: (c, url) => `Bonjour,\n\npour votre transport ${c.origine || "?"} → ${c.destination || "?"}${c.refClient || c.ref ? ` (réf. ${c.refClient || c.ref})` : ""}, vous pouvez nous envoyer les documents en photo ou en PDF depuis votre téléphone, sans compte :\n${url}\n\nMerci,\n${S.entreprise?.nom || ""}`,
  en: (c, url) => `Hello,\n\nfor your shipment ${c.origine || "?"} → ${c.destination || "?"}${c.refClient || c.ref ? ` (ref. ${c.refClient || c.ref})` : ""}, you can send us the documents as photos or PDF from your phone, no account needed:\n${url}\n\nThank you,\n${S.entreprise?.nom || ""}`,
  es: (c, url) => `Buenos días,\n\npara su transporte ${c.origine || "?"} → ${c.destination || "?"}${c.refClient || c.ref ? ` (ref. ${c.refClient || c.ref})` : ""}, puede enviarnos los documentos en foto o PDF desde su teléfono, sin cuenta:\n${url}\n\nGracias,\n${S.entreprise?.nom || ""}`,
};
/** Message d'envoi du lien de dépôt, dans la langue du client. */
const messageLienDepot = (c, url) => MESSAGES_LIEN[langueClientLien(c)](c, url).trim();
/** Message d'envoi du lien transitaire. */
function messageLienTransit(v, url) {
  const cam = parId(S.camions, v.camionId);
  return `Bonjour,\n\nvoici le lien pour noter les étapes de douane du voyage ${v.ref}${cam ? ` (camion ${cam.immat}${v.remorque ? `, remorque ${v.remorque}` : ""})` : ""}, ${v.origine || "?"} → ${v.destination || "?"} : appuyez sur « Fait » à chaque étape passée, avec la référence (DUM, MRN…). Le chauffeur et nous sommes prévenus.\n${url}\n\nMerci,\n${S.entreprise?.nom || ""}`.trim();
}
