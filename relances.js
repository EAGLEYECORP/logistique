"use strict";
/* ============================================================
   Envoi des factures et relances programmées — logique pure, testée.
   · ce qui accompagne une facture : ses voyages, leurs preuves de livraison, les photos (CMR signé, livraison) des voyages et commandes ;
   · message d'envoi et relances dans la langue du client (français, anglais, espagnol) : rappel avant l'échéance, puis J+7, J+15, J+30 ;
   · plan des relances : au fil de l'application pour l'équipe, et par e-mail au client quand c'est activé (le relais les envoie, application fermée) ;
     une facture payée, ou un client « sans relance », sort du plan.
   Dépend de noyau.js, jalons_notifications.js (dateHeureMaroc), aller_retour.js.
   ============================================================ */

const joursRelances = () => String(S.params?.relancesJours ?? "-3,7,15,30").split(/[,; ]+/).map(Number).filter((n) => Number.isFinite(n) && n >= -30 && n <= 120).sort((a, b) => a - b);
/** Voyages d'une facture : ceux qu'elle cite, ceux de ses commandes (aller ou retour). */
function voyagesFacture(f) {
  const ids = new Set(f.voyageIds || []);
  for (const v of S.voyages) { if (v.factureId === f.id) ids.add(v.id); if ((f.commandeIds || []).some((c) => c === v.commandeId || c === v.commandeRetourId)) ids.add(v.id); }
  return S.voyages.filter((v) => ids.has(v.id));
}
/** Cibles des photos à joindre (CMR signé, livraison) : voyages et commandes de la facture. */
const ciblesPhotosFacture = (f) => [...new Set([...voyagesFacture(f).map((v) => `voyage:${v.id}`), ...(f.commandeIds || []).map((c) => `commande:${c}`), ...voyagesFacture(f).flatMap((v) => [v.commandeId, v.commandeRetourId].filter(Boolean).filter((c) => (f.commandeIds || []).includes(c) || v.factureId === f.id).map((c) => `commande:${c}`))])];
const langueClient = (cl) => (["en", "es"].includes(cl?.langueNotif) ? cl.langueNotif : "fr");
const dateLisible = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
const montantLisible = (f) => `${fmt(totauxFacture(f).ttc, 2)} ${f.devise === "EUR" ? "€" : "MAD"}`;

/** Message d'envoi d'une facture : { langue, sujet, texte }. */
function texteEnvoiFacture(f) {
  const cl = parId(S.clients, f.clientId) || {}, L = langueClient(cl), E = S.entreprise || {}, v = voyagesFacture(f), refs = v.map((x) => x.ref).join(", ");
  const rib = E.rib ? { fr: `\nRèglement par virement : ${E.banque || ""} — RIB ${E.rib}`, en: `\nPayment by bank transfer: ${E.banque || ""} — account ${E.rib}`, es: `\nPago por transferencia: ${E.banque || ""} — cuenta ${E.rib}` }[L] : "";
  const T = {
    fr: { s: `Facture ${f.numero}${refs ? " — " + refs : ""}`, t: `Bonjour${cl.contact ? " " + cl.contact : ""},\n\nVeuillez trouver ci-joint notre facture ${f.numero} du ${dateLisible(f.date)} d'un montant de ${montantLisible(f)}, à régler au plus tard le ${dateLisible(f.echeance)}.${v.length ? `\nTransport${v.length > 1 ? "s" : ""} : ${refs}. Le CMR signé et la preuve de livraison sont joints.` : ""}${rib}\n\nCordialement,\n${E.nom || ""}` },
    en: { s: `Invoice ${f.numero}${refs ? " — " + refs : ""}`, t: `Hello${cl.contact ? " " + cl.contact : ""},\n\nPlease find attached our invoice ${f.numero} dated ${dateLisible(f.date)} for ${montantLisible(f)}, due by ${dateLisible(f.echeance)}.${v.length ? `\nShipment${v.length > 1 ? "s" : ""}: ${refs}. The signed CMR and proof of delivery are attached.` : ""}${rib}\n\nBest regards,\n${E.nom || ""}` },
    es: { s: `Factura ${f.numero}${refs ? " — " + refs : ""}`, t: `Buenos días${cl.contact ? " " + cl.contact : ""},\n\nAdjuntamos nuestra factura ${f.numero} del ${dateLisible(f.date)} por un importe de ${montantLisible(f)}, con vencimiento el ${dateLisible(f.echeance)}.${v.length ? `\nTransporte${v.length > 1 ? "s" : ""}: ${refs}. Se adjuntan el CMR firmado y la prueba de entrega.` : ""}${rib}\n\nSaludos cordiales,\n${E.nom || ""}` },
  };
  return { langue: L, sujet: T[L].s, texte: T[L].t.trim() };
}
/** Relance n°j (jours après l'échéance ; négatif = avant) : { langue, sujet, texte }. */
function texteRelance(f, j) {
  const cl = parId(S.clients, f.clientId) || {}, L = langueClient(cl), E = S.entreprise || {}, m = montantLisible(f), e = dateLisible(f.echeance), n = f.numero, sal = { fr: "Bonjour", en: "Hello", es: "Buenos días" }[L] + (cl.contact ? " " + cl.contact : "");
  const rib = E.rib ? { fr: ` (virement : RIB ${E.rib})`, en: ` (bank transfer: ${E.rib})`, es: ` (transferencia: ${E.rib})` }[L] : "";
  const corps = j < 0 ? { fr: `pour rappel, notre facture ${n} de ${m} arrive à échéance le ${e}.`, en: `a friendly reminder that our invoice ${n} for ${m} is due on ${e}.`, es: `le recordamos que nuestra factura ${n} de ${m} vence el ${e}.` }
    : j < 15 ? { fr: `sauf erreur de notre part, notre facture ${n} de ${m}, échue le ${e}, reste impayée. Merci de procéder à son règlement${rib}.`, en: `unless we are mistaken, our invoice ${n} for ${m}, due on ${e}, is still unpaid. Please arrange payment${rib}.`, es: `salvo error por nuestra parte, nuestra factura ${n} de ${m}, vencida el ${e}, sigue pendiente. Les rogamos procedan a su pago${rib}.` }
    : j < 30 ? { fr: `malgré notre précédent rappel, notre facture ${n} de ${m}, échue depuis le ${e}, n'est toujours pas réglée. Merci de nous indiquer la date de paiement${rib}.`, en: `despite our previous reminder, invoice ${n} for ${m}, overdue since ${e}, has not been paid. Please let us know the payment date${rib}.`, es: `a pesar de nuestro recordatorio anterior, la factura ${n} de ${m}, vencida desde el ${e}, sigue sin pagarse. Les rogamos nos indiquen la fecha de pago${rib}.` }
    : { fr: `notre facture ${n} de ${m}, échue depuis le ${e}, reste impayée malgré nos relances. Nous vous remercions de la régler sous huit jours${rib}.`, en: `our invoice ${n} for ${m}, overdue since ${e}, remains unpaid despite our reminders. Please settle it within eight days${rib}.`, es: `nuestra factura ${n} de ${m}, vencida desde el ${e}, sigue impagada a pesar de nuestros recordatorios. Les rogamos la abonen en un plazo de ocho días${rib}.` };
  const sujet = { fr: j < 0 ? `Rappel d'échéance — facture ${n}` : `Relance — facture ${n}`, en: j < 0 ? `Payment reminder — invoice ${n}` : `Overdue invoice ${n}`, es: j < 0 ? `Recordatorio de vencimiento — factura ${n}` : `Factura ${n} pendiente` }[L];
  return { langue: L, sujet, texte: `${sal},\n\n${corps[L].replace(/^./, (c) => c.toUpperCase())}\n\n${{ fr: "Cordialement", en: "Best regards", es: "Saludos cordiales" }[L]},\n${E.nom || ""}`.trim() };
}
/** Une facture est-elle à relancer ? Émise (envoyée ou non), non payée, avec une échéance, client sans opposition. */
const factureARelancer = (f) => f.statut !== "payee" && !!f.echeance && !f.sansRelance && !parId(S.clients, f.clientId)?.sansRelance;
/**
 * Relances programmées entre deux instants : messages au format du plan de notifications.
 * Pour l'équipe : fil de l'application (« Relancer … »). Pour le client : e-mail si S.params.relancesAuto et une adresse ; le relais les envoie à l'heure.
 */
function planRelances({ depuis = Date.now(), jusqua = Date.now() + 7 * 86400000 } = {}) {
  const r = [];
  for (const f of S.factures || []) {
    if (!factureARelancer(f)) continue;
    const cl = parId(S.clients, f.clientId) || {}, auto = !!S.params?.relancesAuto && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(cl.email || "").trim());
    for (const j of joursRelances()) {
      const quand = dateHeureMaroc(dateISO(Date.parse(f.echeance + "T00:00:00Z") + j * 86400000), "09:30"); if (quand < depuis || quand > jusqua) continue;
      const lib = j < 0 ? `échéance dans ${-j} j` : `échue depuis ${j} j`;
      r.push({ id: `relance:${f.id}:${j}:equipe`, cle: `relance:${f.id}:${j}:equipe`, quand, canal: "in_app", audience: "comptabilite", destination: "", sujet: `Relance ${f.numero}`, texte: `${auto ? "Relance envoyée par e-mail" : "Relancer"} ${cl.nom || "le client"} : facture ${f.numero}, ${montantLisible(f)}, ${lib}.`, factureId: f.id });
      if (auto) { const t = texteRelance(f, j); r.push({ id: `relance:${f.id}:${j}:client`, cle: `relance:${f.id}:${j}:client`, quand, canal: "email", audience: "client_externe", destination: cl.email.trim(), nom: cl.nom, langue: t.langue, sujet: t.sujet, texte: t.texte, factureId: f.id }); }
    }
  }
  return r.sort((a, b) => a.quand - b.quand);
}
/** Prochaines relances d'une facture (pour l'affichage) : [{ j, date }]. */
function prochainesRelances(f, maintenant = Date.now()) {
  if (!factureARelancer(f)) return [];
  return joursRelances().map((j) => ({ j, date: dateISO(Date.parse(f.echeance + "T00:00:00Z") + j * 86400000) })).filter((x) => dateHeureMaroc(x.date, "09:30") >= maintenant);
}
