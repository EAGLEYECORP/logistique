"use strict";
/* ============================================================
   Notifications par étape de voyage — logique pure, testée.
   · routage : pour chaque étape, qui est prévenu, par quel canal, avec quel message (français, anglais, espagnol, arabe) ;
   · rappels programmés avant une étape (veille du départ, présentation au port…) et après (facture à émettre…) ;
   · résolution des destinataires : équipe (sujet ntfy, e-mail, WhatsApp), chauffeur, client — le client seulement s'il l'a accepté.
   Le relais ne reçoit que des messages déjà rédigés : il ne lit jamais les données de l'entreprise.
   Dépend de noyau.js (JALONS_VOYAGE, état S), pilotage.js (finVoyage).
   ============================================================ */

const LANGUES_NOTIF = ["fr", "en", "es", "ar"];
/** [id, libellé, canal par défaut]. « prefere » : le canal choisi par le destinataire (client : WhatsApp ou e-mail ; chauffeur : ntfy, sinon WhatsApp). */
const AUDIENCES_NOTIF = [
  ["dispatcher_casa", "Exploitation Maroc", "ntfy"], ["exploitante_frankfurt", "Exploitation Allemagne", "ntfy"], ["chef_entreprise", "Direction", "in_app"],
  ["commercial", "Commercial du client", "in_app"], ["comptabilite", "Comptabilité", "email"], ["transitaire", "Transitaire", "email"],
  ["client_externe", "Client", "prefere"], ["chauffeur", "Chauffeur", "prefere"],
];
/** in_app : fil de l'application · equipe : canaux configurés sur le relais (Telegram, WhatsApp de l'équipe, webhook) · ntfy · whatsapp · email · sms (lien seulement). */
const CANAUX_NOTIF = ["in_app", "equipe", "ntfy", "whatsapp", "email", "sms", "prefere"];
const AUDIENCES_INTERNES = ["dispatcher_casa", "exploitante_frankfurt", "chef_entreprise", "commercial", "comptabilite", "transitaire"];

const LIB_JALONS_LANGUES = {
  depart: { fr: "Départ du dépôt", en: "Departure from depot", es: "Salida del depósito", ar: "الانطلاق من المستودع" },
  douane_export: { fr: "Douane export", en: "Export customs", es: "Aduana de exportación", ar: "جمارك التصدير" },
  port_tmed: { fr: "Entrée au port de Tanger Med", en: "Entry into Tanger Med port", es: "Entrada al puerto de Tanger Med", ar: "الدخول إلى ميناء طنجة المتوسط" },
  embarque_aller: { fr: "Embarqué (aller)", en: "Boarded (outbound)", es: "Embarcado (ida)", ar: "الصعود إلى الباخرة (ذهاب)" },
  debarque_alg: { fr: "Débarqué à Algeciras", en: "Landed in Algeciras", es: "Desembarcado en Algeciras", ar: "النزول في الجزيرة الخضراء" },
  livre: { fr: "Livré", en: "Delivered", es: "Entregado", ar: "تم التسليم" },
  charge_retour: { fr: "Chargement retour", en: "Return load", es: "Carga de retorno", ar: "الشحن للعودة" },
  embarque_retour: { fr: "Embarqué (retour)", en: "Boarded (return)", es: "Embarcado (vuelta)", ar: "الصعود إلى الباخرة (عودة)" },
  debarque_tmed: { fr: "Débarqué à Tanger Med", en: "Landed in Tanger Med", es: "Desembarcado en Tanger Med", ar: "النزول في طنجة المتوسط" },
  douane_import: { fr: "Douane import", en: "Import customs", es: "Aduana de importación", ar: "جمارك الاستيراد" },
  retour: { fr: "Retour au dépôt", en: "Back at depot", es: "Regreso al depósito", ar: "العودة إلى المستودع" },
};
/** Message d'équipe générique, puis messages particuliers (client, comptabilité, chauffeur). */
const MODELE_EQUIPE = { fr: "{ref} — {jalon} ({heure}). {camion} · {chauffeur} · {origine} → {destination}.", en: "{ref} — {jalon} ({heure}). {camion} · {chauffeur} · {origine} → {destination}.", es: "{ref} — {jalon} ({heure}). {camion} · {chauffeur} · {origine} → {destination}.", ar: "{ref} — {jalon} ({heure}). {camion} · {chauffeur} · {origine} ← {destination}." };
const MODELES_NOTIF = {
  equipe: MODELE_EQUIPE,
  client_livre: {
    fr: "Bonjour, votre marchandise ({ref}) a été livrée à {destination} le {heure}. Merci de votre confiance — {entreprise}.",
    en: "Hello, your goods ({ref}) were delivered in {destination} on {heure}. Thank you for your trust — {entreprise}.",
    es: "Hola, su mercancía ({ref}) fue entregada en {destination} el {heure}. Gracias por su confianza — {entreprise}.",
    ar: "مرحبًا، تم تسليم بضاعتكم ({ref}) في {destination} بتاريخ {heure}. شكرًا على ثقتكم — {entreprise}.",
  },
  client_etape: {
    fr: "Votre envoi {ref} : {jalon} ({heure}). Suivi : {lien}", en: "Your shipment {ref}: {jalon} ({heure}). Tracking: {lien}",
    es: "Su envío {ref}: {jalon} ({heure}). Seguimiento: {lien}", ar: "شحنتكم {ref}: {jalon} ({heure}). التتبع: {lien}",
  },
  compta_livre: { fr: "Voyage {ref} livré le {heure} ({client}) : facture à émettre.", en: "Trip {ref} delivered on {heure} ({client}): invoice to issue.", es: "Viaje {ref} entregado el {heure} ({client}): factura por emitir.", ar: "الرحلة {ref} سُلّمت بتاريخ {heure} ({client}): يجب إصدار الفاتورة." },
  compta_retour: { fr: "Voyage {ref} clôturé ({heure}) : marge directe {marge}.", en: "Trip {ref} closed ({heure}): direct margin {marge}.", es: "Viaje {ref} cerrado ({heure}): margen directo {marge}.", ar: "الرحلة {ref} أُغلقت ({heure}): الهامش المباشر {marge}." },
  transitaire_export: { fr: "Voyage {ref} ({client}) à la douane export le {heure}. Camion {camion}, chauffeur {chauffeur}. Documents : DUM, CMR, facture.", en: "Trip {ref} ({client}) at export customs on {heure}. Truck {camion}, driver {chauffeur}. Documents: DUM, CMR, invoice.", es: "Viaje {ref} ({client}) en la aduana de exportación el {heure}. Camión {camion}, conductor {chauffeur}. Documentos: DUM, CMR, factura.", ar: "الرحلة {ref} ({client}) في جمارك التصدير بتاريخ {heure}. الشاحنة {camion}، السائق {chauffeur}. الوثائق: DUM، CMR، الفاتورة." },
  recap_veille: { fr: "Récap : voyage {ref} demain {heure} — {origine} → {destination}, {camion}, {chauffeur}. Contrôles : {controles}.", en: "Recap: trip {ref} tomorrow {heure} — {origine} → {destination}, {camion}, {chauffeur}. Checks: {controles}.", es: "Resumen: viaje {ref} mañana {heure} — {origine} → {destination}, {camion}, {chauffeur}. Controles: {controles}.", ar: "ملخص: الرحلة {ref} غدًا {heure} — {origine} ← {destination}، {camion}، {chauffeur}. المراقبة: {controles}." },
  chauffeur_port: { fr: "Présentation au port de Tanger Med dans 2 h ({heure}) — voyage {ref}.", en: "Check-in at Tanger Med port in 2 h ({heure}) — trip {ref}.", es: "Presentación en el puerto de Tanger Med en 2 h ({heure}) — viaje {ref}.", ar: "التقديم في ميناء طنجة المتوسط بعد ساعتين ({heure}) — الرحلة {ref}." },
  chauffeur_embarque: { fr: "Embarquement dans 3 h ({heure}) — réservation {reservation}.", en: "Boarding in 3 h ({heure}) — booking {reservation}.", es: "Embarque en 3 h ({heure}) — reserva {reservation}.", ar: "الصعود إلى الباخرة بعد 3 ساعات ({heure}) — الحجز {reservation}." },
  chauffeur_livraison: { fr: "Livraison dans environ 1 h ({heure}) — préparez la CMR et la signature.", en: "Delivery in about 1 h ({heure}) — have the CMR and signature ready.", es: "Entrega en aproximadamente 1 h ({heure}) — prepare el CMR y la firma.", ar: "التسليم بعد ساعة تقريبًا ({heure}) — جهّز وثيقة CMR والتوقيع." },
};

/** Routage par défaut, d'après le cahier des charges (une entrée par étape ; id = étape, pour la synchronisation). */
function routageDefaut() {
  const e = (jalon, auto, audiences, plus = {}) => ({ id: jalon, jalon, auto, audiences, modeles: {}, pre_notifications: [], post_notifications: [], ...plus });
  const equipe = { dispatcher_casa: ["ntfy"], exploitante_frankfurt: ["ntfy"] };
  return [
    e("depart", true, { ...equipe, chef_entreprise: ["in_app"] }, { pre_notifications: [{ jour: -1, heure: "18:00", audience: "dispatcher_casa", canal: "ntfy", modele: "recap_veille" }] }),
    e("douane_export", false, { dispatcher_casa: ["ntfy"], transitaire: ["email"] }),
    e("port_tmed", true, equipe, { pre_notifications: [{ offset_h: -2, audience: "chauffeur", canal: "prefere", modele: "chauffeur_port" }] }),
    e("embarque_aller", true, { ...equipe, chef_entreprise: ["in_app"] }, { pre_notifications: [{ offset_h: -3, audience: "chauffeur", canal: "prefere", modele: "chauffeur_embarque" }] }),
    e("debarque_alg", true, { ...equipe, commercial: ["in_app"] }),
    e("livre", false, { client_externe: ["prefere"], comptabilite: ["email"], commercial: ["in_app"], chef_entreprise: ["in_app"] }, { pre_notifications: [{ offset_h: -1, audience: "chauffeur", canal: "prefere", modele: "chauffeur_livraison" }], post_notifications: [{ offset_h: 24, audience: "comptabilite", canal: "email", modele: "compta_livre", siNonFacture: true }] }),
    e("charge_retour", false, equipe),
    e("embarque_retour", true, equipe),
    e("debarque_tmed", true, { dispatcher_casa: ["ntfy"] }),
    e("douane_import", false, { dispatcher_casa: ["ntfy"], comptabilite: ["in_app"] }),
    e("retour", true, { chef_entreprise: ["in_app", "ntfy"], comptabilite: ["email"], dispatcher_casa: ["ntfy"] }),
  ];
}
/** Routage en vigueur : celui de l'entreprise, complété par les étapes manquantes du routage par défaut. */
function routageJalons() {
  const r = Array.isArray(S.routageJalons) ? S.routageJalons : [];
  return routageDefaut().map((d) => r.find((x) => x.jalon === d.jalon) || d);
}
/** Erreurs d'une entrée de routage (liste vide = valide). */
function routageErreurs(r) {
  const e = [], aud = AUDIENCES_NOTIF.map((a) => a[0]);
  if (!r || typeof r !== "object") return ["Entrée illisible"];
  if (!JALONS_VOYAGE.some(([k]) => k === r.jalon)) e.push("Étape inconnue");
  if (typeof r.auto !== "boolean") e.push("« auto » doit valoir vrai ou faux");
  for (const [a, canaux] of Object.entries(r.audiences || {})) {
    if (!aud.includes(a)) e.push(`Destinataire inconnu : ${a}`);
    if (!Array.isArray(canaux) || !canaux.length || canaux.some((c) => !CANAUX_NOTIF.includes(c))) e.push(`Canaux invalides pour ${a}`);
  }
  for (const [nom, l] of [["avant", r.pre_notifications], ["après", r.post_notifications]]) for (const p of l || []) {
    if (!aud.includes(p.audience)) e.push(`Rappel ${nom} : destinataire inconnu`);
    if (!CANAUX_NOTIF.includes(p.canal)) e.push(`Rappel ${nom} : canal inconnu`);
    const fixe = Number.isInteger(p.jour) && /^\d{2}:\d{2}$/.test(p.heure || "");
    if (!fixe && !Number.isFinite(p.offset_h)) e.push(`Rappel ${nom} : décalage en heures ou jour et heure attendus`);
  }
  for (const [k, m] of Object.entries(r.modeles || {})) if (!LANGUES_NOTIF.includes(k) || typeof m !== "string") e.push(`Message invalide (${k})`);
  return e;
}

/* ---------- rédaction ---------- */
const MAROC_MS = 3600000; // le Maroc est à UTC+1 toute l'année
/** Date et heure lisibles (heure du Maroc), dans la langue du destinataire. */
function heureNotif(ms, langue = "fr") {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms + MAROC_MS), j = String(d.getUTCDate()).padStart(2, "0"), m = String(d.getUTCMonth() + 1).padStart(2, "0"), h = String(d.getUTCHours()).padStart(2, "0"), mi = String(d.getUTCMinutes()).padStart(2, "0");
  return langue === "en" ? `${d.getUTCFullYear()}-${m}-${j} ${h}:${mi}` : `${j}/${m} ${h}:${mi}`;
}
/** Variables d'un voyage pour les messages. `quand` : heure de l'étape (réelle ou prévue), en ms. */
function variablesNotif(v, jalon, langue = "fr", quand = null) {
  const lib = LIB_JALONS_LANGUES[jalon]?.[langue] || LIB_JALONS_LANGUES[jalon]?.fr || jalon;
  const ch = parId(S.chauffeurs, v.chauffeurId), ctl = ["prevu", "en_cours"].includes(v.statut) ? controlesVoyage(v) : [];
  const m = typeof margeVoyage === "function" ? margeVoyage(v) : null, t = (v.traversees || []).find((x) => x.sens === (jalon === "embarque_retour" ? "retour" : "aller"));
  const lien = typeof lienClient === "function" ? lienClient(v) : v.partage?.lien || "";
  return { ref: v.ref || "", client: v.clientId ? nomClient(v.clientId) : "", origine: v.origine || "", destination: v.destination || "", jalon: lib, heure: heureNotif(quand, langue),
    camion: v.camionId ? nomCamion(v.camionId) : "—", chauffeur: ch?.nom || "—", reservation: t?.ref || "—", controles: ctl.length ? `${ctl.length} point(s) à régler` : "OK",
    marge: m && m.revenu ? `${fmt(m.marge_directe)} MAD` : "—", lien: lien || "—", entreprise: S.entreprise?.nom || "", eta: v.eta?.arrivee ? heureNotif(v.eta.arrivee * 1000, langue) : "—" };
}
/** Remplace les {variables} ; une variable inconnue reste visible pour être corrigée. */
const remplirModele = (texte, vars) => String(texte || "").replace(/\{(\w+)\}/g, (x, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : x));
/** Texte d'un message : modèle personnalisé de l'étape (s'il existe pour cette langue), sinon modèle par défaut ; repli en français. */
function texteNotif(v, jalon, { audience, langue = "fr", quand = null, modele = null, routage = null } = {}) {
  const r = routage || routageJalons().find((x) => x.jalon === jalon) || {};
  const cle = modele || (audience === "client_externe" ? (jalon === "livre" ? "client_livre" : "client_etape") : audience === "comptabilite" && jalon === "livre" ? "compta_livre" : audience === "comptabilite" && jalon === "retour" ? "compta_retour" : audience === "transitaire" && jalon === "douane_export" ? "transitaire_export" : "equipe");
  const perso = !modele && cle === "equipe" ? r.modeles?.[langue] : null; // message personnalisé de l'étape, dans la langue du destinataire
  const base = perso || MODELES_NOTIF[cle]?.[langue] || MODELES_NOTIF[cle]?.fr || MODELE_EQUIPE.fr;
  return remplirModele(base, variablesNotif(v, jalon, langue, quand));
}

/* ---------- destinataires ---------- */
const sujetNtfyValide = (u) => typeof u === "string" && /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9_-]{6,64}$/.test(u.trim());
const emailValide = (e) => typeof e === "string" && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(e.trim());
/**
 * Destinataire concret d'une audience pour un voyage : { canal, destination, langue, nom } ou { manque: "raison" }.
 * Le client n'est jamais prévenu sans son accord (client.notificationsClientAutorisees).
 */
function destinataireNotif(audience, canal, v) {
  const langueDefaut = S.entreprise?.langueDefaut || "fr";
  if (canal === "in_app") return { canal, destination: "", langue: "fr", nom: libDe(AUDIENCES_NOTIF, audience) };
  if (canal === "equipe") return { canal, destination: "", langue: "fr", nom: "Canaux du relais" };
  if (AUDIENCES_INTERNES.includes(audience)) {
    const a = S.entreprise?.audiences?.[audience] || {}, nom = libDe(AUDIENCES_NOTIF, audience), langue = a.langue || "fr";
    if (canal === "ntfy") return sujetNtfyValide(a.ntfy) ? { canal, destination: a.ntfy.trim(), langue, nom } : { manque: `${nom} : sujet ntfy à renseigner` };
    if (canal === "email") return emailValide(a.email) ? { canal, destination: a.email.trim(), langue, nom } : { manque: `${nom} : adresse e-mail à renseigner` };
    if (canal === "whatsapp" || canal === "sms") return telInternational(a.whatsapp) ? { canal, destination: telInternational(a.whatsapp), langue, nom } : { manque: `${nom} : numéro à renseigner` };
    if (canal === "prefere") return a.ntfy ? destinataireNotif(audience, "ntfy", v) : a.email ? destinataireNotif(audience, "email", v) : { manque: `${nom} : aucun moyen de contact` };
  }
  if (audience === "client_externe") {
    const c = parId(S.clients, v.clientId); if (!c) return { manque: "Voyage sans client" };
    if (!c.notificationsClientAutorisees) return { manque: `${c.nom} : notifications non autorisées par le client` };
    const langue = c.langueNotif || langueDefaut, voulu = canal === "prefere" ? c.canalNotifPrefere || (c.tel ? "whatsapp" : "email") : canal;
    const parMail = () => (emailValide(c.email) ? { canal: "email", destination: c.email.trim(), langue, nom: c.nom } : null), parTel = (k) => (telInternational(c.tel) ? { canal: k, destination: telInternational(c.tel), langue, nom: c.nom } : null);
    const r = voulu === "email" ? parMail() : parTel(voulu === "sms" ? "sms" : "whatsapp");
    if (!r) return { manque: `${c.nom} : ${voulu === "email" ? "adresse e-mail" : "téléphone"} à renseigner` };
    if (r.canal === "whatsapp") { const repli = parMail(); if (repli) r.repli = { canal: "email", destination: repli.destination }; }
    return r;
  }
  if (audience === "chauffeur") {
    const ch = parId(S.chauffeurs, v.chauffeurId); if (!ch) return { manque: "Voyage sans chauffeur" };
    const langue = ch.langueNotif || langueDefaut;
    if ((canal === "ntfy" || canal === "prefere") && sujetNtfyValide(ch.ntfy)) return { canal: "ntfy", destination: ch.ntfy.trim(), langue, nom: ch.nom };
    if ((canal === "whatsapp" || canal === "prefere") && telInternational(ch.tel)) return { canal: "whatsapp", destination: telInternational(ch.tel), langue, nom: ch.nom };
    return { manque: `${ch.nom} : ${canal === "whatsapp" ? "téléphone" : "sujet ntfy ou téléphone"} à renseigner` };
  }
  return { manque: `${audience} : destinataire inconnu` };
}
const sujetNotif = (v, jalon, langue) => `${v.ref || ""} — ${LIB_JALONS_LANGUES[jalon]?.[langue] || LIB_JALONS_LANGUES[jalon]?.fr || jalon}`;

/** Messages à envoyer quand une étape est atteinte : { messages: [...], manques: [...] }. */
function notificationsJalon(v, jalon, { quand = null, maintenant = Date.now() } = {}) {
  const r = routageJalons().find((x) => x.jalon === jalon); if (!r) return { messages: [], manques: [] };
  const j = (v.jalons || []).find((x) => x.type === jalon), t = quand ?? (j && Number.isFinite(Date.parse(j.date)) ? Date.parse(j.date) : maintenant);
  const messages = [], manques = [];
  for (const [audience, canaux] of Object.entries(r.audiences || {})) for (const canal of canaux) {
    const d = destinataireNotif(audience, canal, v); if (d.manque) { manques.push(d.manque); continue; }
    messages.push({ id: `${v.id}:${jalon}:jalon:${audience}:${d.canal}`, voyageId: v.id, jalon, type: "jalon", quand: t, audience, canal: d.canal, destination: d.destination, repli: d.repli, langue: d.langue, nom: d.nom,
      sujet: sujetNotif(v, jalon, d.langue), texte: texteNotif(v, jalon, { audience, langue: d.langue, quand: t, routage: r }), cle: `jalon:${v.id}:${jalon}:${audience}:${d.canal}` });
  }
  return { messages, manques };
}

/* ---------- programmation ---------- */
const dateHeureMaroc = (iso, hm = "06:00") => { const t = Date.parse(`${String(iso).slice(0, 10)}T${/^\d{2}:\d{2}$/.test(hm) ? hm : "06:00"}:00+01:00`); return Number.isFinite(t) ? t : null; };
/** Heures prévues des étapes d'un voyage (ms) : départ, présentation et embarquement d'après la réservation, livraison d'après l'arrivée estimée ou le créneau promis, retour. */
function heuresPrevuesJalons(v) {
  const r = {}, tr = (sens) => (v.traversees || []).find((x) => x.sens === sens);
  if (v.dateDepart) r.depart = dateHeureMaroc(v.dateDepart, v.heureDepart || "06:00");
  const a = tr("aller"); if (a?.date) { r.embarque_aller = dateHeureMaroc(a.date, a.heure || "12:00"); r.port_tmed = r.embarque_aller - 3 * 3600000; }
  const eta = Number.isFinite(v.eta?.arrivee) ? v.eta.arrivee * 1000 : null, promis = Date.parse(v.livraisonPrevue || "");
  if (eta || Number.isFinite(promis)) r.livre = eta || promis;
  const b = tr("retour"); if (b?.date) r.embarque_retour = dateHeureMaroc(b.date, b.heure || "12:00");
  if (v.dateRetourPrevue) r.retour = dateHeureMaroc(v.dateRetourPrevue, "18:00");
  return r;
}
/** Heure d'un rappel : décalage en heures, ou jour relatif et heure fixe (heure du Maroc). */
function quandRappel(base, p) {
  if (!Number.isFinite(base)) return null;
  if (Number.isInteger(p.jour) && /^\d{2}:\d{2}$/.test(p.heure || "")) return dateHeureMaroc(new Date(base + MAROC_MS + p.jour * 86400000).toISOString().slice(0, 10), p.heure);
  return Number.isFinite(p.offset_h) ? base + p.offset_h * 3600000 : null;
}
/**
 * Notifications programmées entre deux instants (ms) : rappels avant les étapes à venir, rappels après les étapes atteintes.
 * Les heures suivent le voyage : un départ décalé décale ses rappels. Les rappels annulés sont écartés, les reportés décalés (S.notifsEtat).
 * [{ id, voyageId, jalon, type: "pre" | "post", quand, audience, canal, destination, repli?, langue, nom, sujet, texte, cle }] trié par heure ; `manques` à part.
 */
function planNotifications({ depuis = Date.now(), jusqua = Date.now() + 7 * 86400000, maintenant = Date.now() } = {}) {
  const res = [], manques = [], etat = S.notifsEtat || {}, annulees = etat.annulees || {}, reports = etat.reports || {};
  for (const v of S.voyages) {
    if (v.statut === "annule") continue;
    const prevues = heuresPrevuesJalons(v), atteint = (k) => { const j = (v.jalons || []).find((x) => x.type === k); return j && Number.isFinite(Date.parse(j.date)) ? Date.parse(j.date) : null; };
    for (const r of routageJalons()) {
      const fait = atteint(r.jalon);
      const lots = [["pre", fait === null && v.statut !== "termine" ? prevues[r.jalon] : null, r.pre_notifications || []], ["post", fait, r.post_notifications || []]];
      for (const [type, base, liste] of lots) liste.forEach((p, i) => {
        const q = quandRappel(base, p); if (q === null) return;
        if (p.siNonFacture && (v.commandeId && parId(S.commandes, v.commandeId)?.factureId || v.factureId)) return;
        const id0 = `${v.id}:${r.jalon}:${type}:${i}`, quand = q + num(reports[id0]);
        if (annulees[id0] || quand < depuis || quand > jusqua || quand < maintenant - 5 * 60000) return;
        const d = destinataireNotif(p.audience, p.canal, v); if (d.manque) { manques.push({ id: id0, quand, texte: d.manque }); return; }
        const base_ = type === "pre" ? prevues[r.jalon] : fait;
        res.push({ id: id0, voyageId: v.id, jalon: r.jalon, type, quand, audience: p.audience, canal: d.canal, destination: d.destination, repli: d.repli, langue: d.langue, nom: d.nom, reporte: !!reports[id0],
          sujet: sujetNotif(v, r.jalon, d.langue), texte: texteNotif(v, r.jalon, { audience: p.audience, langue: d.langue, quand: base_, modele: p.modele }), cle: `${id0}:${Math.round(quand / 60000)}` });
      });
    }
  }
  res.sort((a, b) => a.quand - b.quand);
  return Object.assign(res, { manques });
}
/** Étapes atteintes récemment (6 h) dont le routage est automatique et qui n'ont pas encore été notifiées : [{ voyage, jalon }]. */
function jalonsANotifier(maintenant = Date.now()) {
  const r = [], routage = routageJalons();
  for (const v of S.voyages) {
    if (v.statut === "annule") continue;
    for (const j of v.jalons || []) {
      const t = Date.parse(j.date), regle = routage.find((x) => x.jalon === j.type);
      if (!regle?.auto || !Number.isFinite(t) || maintenant - t > 6 * 3600000 || t > maintenant + 600000 || (v.notifsJalons || []).includes(j.type)) continue;
      r.push({ voyage: v, jalon: j.type });
    }
  }
  return r;
}
