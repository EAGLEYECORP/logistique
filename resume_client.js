"use strict";
/* ============================================================
   Résumé hebdomadaire par client — logique pure, testée. Pour la relation commerciale :
   · livraisons de la semaine et ponctualité (livré à l'heure promise, à 30 min près ; un jour promis sans heure : le jour même) ;
   · attente aux quais du client (temps sur place, au-delà de l'attente gratuite) ;
   · documents arrivés après la date demandée (deux jours avant le chargement) ou manquants au chargement — seulement pour les
     commandes dont la liste des documents est tenue (documentsSuivis) ;
   · à préparer pour les jours suivants (documents qui manquent encore).
   Le message part chaque lundi (8 h, heure du Maroc) aux clients qui l'ont demandé, une fois la semaine finie, par le relais.
   Dépend de noyau.js, quais.js, documents_commande.js, aller_retour.js, coupures.js (lundiDeLaSemaine, joursPlus),
   jalons_notifications.js (dateHeureMaroc).
   ============================================================ */

const TOLERANCE_PONCTUALITE_MIN = 30;
const DELAI_DOCUMENTS_J = 2; // documents demandés pour deux jours avant le chargement (comme la relance)

/** Semaine (lundi → dimanche, dates ISO) contenant une date ISO. */
const semaineDe = (iso) => { const debut = lundiDeLaSemaine(iso); return { debut, fin: joursPlus(debut, 6) }; };
const dansSemaineResume = (iso, debut, fin) => !!iso && iso.slice(0, 10) >= debut && iso.slice(0, 10) <= fin;
/** Date locale (ISO) d'un instant ISO. */
const jourLocalResume = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? dateLocale(t / 1000) : ""; };
const voyageAllerDe = (c) => S.voyages.find((v) => v.commandeId === c.id && v.statut !== "annule") || null;

/** Livraison d'une commande : { livre (ISO), promis (ISO ou date), aLHeure, retardMin } ou null si pas livrée. */
function livraisonCommande(c) {
  const v = voyageAllerDe(c), livre = (c.jalons || []).find((j) => j.statut === "livre")?.date || (v?.jalons || []).find((j) => j.type === "livre")?.date || "";
  if (!livre || !Number.isFinite(Date.parse(livre))) return null;
  const promis = v?.livraisonPrevue || c.dateLivraison || "";
  if (!promis) return { livre, promis: "", aLHeure: null, retardMin: 0 };
  const avecHeure = /T\d{2}:\d{2}/.test(promis), t = Date.parse(livre);
  if (avecHeure) { const r = Math.round((t - Date.parse(promis)) / 60000); return { livre, promis, aLHeure: r <= TOLERANCE_PONCTUALITE_MIN, retardMin: Math.max(0, r) }; }
  const jour = jourLocalResume(livre); if (jour <= promis.slice(0, 10)) return { livre, promis, aLHeure: true, retardMin: 0 };
  return { livre, promis, aLHeure: false, retardMin: Math.max(0, Math.round((t - Date.parse(`${promis.slice(0, 10)}T23:59:59`)) / 60000)) };
}

/**
 * Résumé d'un client sur une période [debut, fin] (dates ISO incluses).
 * { client, debut, fin, livraisons: [...], aLHeure, enRetard, sansPromesse, attentes: [...], attenteMin, auDelaMin, documents: [...], aPreparer: [...], vide }.
 */
function resumeClient(clientId, { debut, fin, maintenant = Date.now() } = {}) {
  const cl = parId(S.clients, clientId), commandes = S.commandes.filter((c) => c.clientId === clientId && c.statut !== "annule" && !c.perdu);
  const livraisons = [], attentes = [], documents = [], aPreparer = []; let chargementsSuivis = 0;
  for (const c of commandes) {
    const trajet = `${c.origine || "?"} → ${c.destination || "?"}`, l = livraisonCommande(c);
    if (l && dansSemaineResume(jourLocalResume(l.livre), debut, fin)) livraisons.push({ commandeId: c.id, ref: c.refClient || c.ref, trajet, ...l });
    for (const [q] of QUAIS) {
      const a = attenteQuai(c, q, maintenant); if (!a || a.enCours || !dansSemaineResume(jourLocalResume(a.arrivee), debut, fin)) continue;
      attentes.push({ commandeId: c.id, ref: c.refClient || c.ref, quai: q, lieu: lieuQuai(c, q), arrivee: a.arrivee, minutes: a.minutes, auDelaMin: a.auDelaMin, franchiseMin: a.franchiseMin });
    }
    if (dansSemaineResume(c.dateChargement, debut, fin) && !["devis", "confirme"].includes(c.statut) && documentsSuivis(c)) { // chargée cette semaine, liste des documents tenue
      chargementsSuivis++; const limite = joursPlus(c.dateChargement, -DELAI_DOCUMENTS_J), e = etatDocuments(c);
      for (const x of e.attendus.filter((y) => !y.nonRequis)) {
        if (!x.recu) documents.push({ commandeId: c.id, ref: c.refClient || c.ref, id: x.id, statut: "manquant", limite });
        else if (jourLocalResume(x.recu) > limite) documents.push({ commandeId: c.id, ref: c.refClient || c.ref, id: x.id, statut: "en_retard", recu: jourLocalResume(x.recu), limite });
      }
    }
    if (c.statut === "confirme" && documentsSuivis(c) && c.dateChargement > fin && c.dateChargement <= joursPlus(fin, 7)) { const e = etatDocuments(c); if (e.manquants.length) aPreparer.push({ commandeId: c.id, ref: c.refClient || c.ref, trajet, date: c.dateChargement, manquants: e.manquants.map((x) => x.id) }); }
  }
  livraisons.sort((a, b) => a.livre.localeCompare(b.livre)); attentes.sort((a, b) => a.arrivee.localeCompare(b.arrivee)); aPreparer.sort((a, b) => a.date.localeCompare(b.date));
  const avecPromesse = livraisons.filter((x) => x.aLHeure !== null), aLHeure = avecPromesse.filter((x) => x.aLHeure).length;
  return { client: cl, debut, fin, livraisons, aLHeure, enRetard: avecPromesse.length - aLHeure, sansPromesse: livraisons.length - avecPromesse.length, tauxPonctualite: avecPromesse.length ? Math.round((aLHeure / avecPromesse.length) * 100) : null,
    attentes, attenteMin: attentes.reduce((s, x) => s + x.minutes, 0), auDelaMin: attentes.reduce((s, x) => s + x.auDelaMin, 0), documents, chargementsSuivis, aPreparer, vide: !livraisons.length && !attentes.length && !documents.length };
}

/* ---------- le message au client (français, anglais, espagnol) ---------- */
const jjmmResume = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const hhmmResume = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && /T\d{2}:\d{2}/.test(iso) ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""; };
const dureeResume = (min) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
const MODELES_RESUME = {
  fr: { salut: "Bonjour", intro: (d, f, e) => `Voici votre semaine du ${d} au ${f}${e ? ` avec ${e}` : ""}.`, livraisons: (n, ok, t) => `Livraisons : ${n}${t !== null ? `, dont ${ok} à l'heure (${t} %)` : ""}.`, aucuneLivraison: "Livraisons : aucune cette semaine.",
    attente: (n, tot, moy, au) => `Attente à vos quais : ${n} passage(s), ${tot} au total (${moy} en moyenne)${au ? ` ; ${au} au-delà de l'attente gratuite` : " ; rien au-delà de l'attente gratuite"}.`,
    docs: (r, m) => `Documents : ${[r && `${r} arrivé(s) après la date demandée`, m && `${m} manquant(s) au chargement`].filter(Boolean).join(", ")}.`, docsOk: "Documents : tous reçus à temps, merci.",
    detail: "Détail", livre: (ref, tr, j, h, p, r) => `- ${ref} ${tr} : livré le ${j}${h ? ` à ${h}` : ""}${p ? `, promis ${p}` : ""}${r ? ` (+${r})` : ""}.`, quai: (ref, q, lieu, j, d) => `- ${ref}, ${q === "chargement" ? "chargement" : "livraison"}${lieu ? ` à ${lieu}` : ""} le ${j} : ${d} sur place.`,
    docRetard: (ref, lib, r, l) => `- ${ref} : ${lib} reçu le ${r} (demandé pour le ${l}).`, docManque: (ref, lib) => `- ${ref} : ${lib} manquant au chargement.`, aPreparer: "À préparer", prepa: (ref, tr, j, l) => `- ${ref} ${tr}, chargement le ${j} : il manque encore ${l}.`,
    fin: "Merci pour votre confiance,", sujet: (d, f) => `Votre semaine du ${d} au ${f}` },
  en: { salut: "Hello", intro: (d, f, e) => `Here is your week from ${d} to ${f}${e ? ` with ${e}` : ""}.`, livraisons: (n, ok, t) => `Deliveries: ${n}${t !== null ? `, ${ok} on time (${t}%)` : ""}.`, aucuneLivraison: "Deliveries: none this week.",
    attente: (n, tot, moy, au) => `Waiting at your docks: ${n} visit(s), ${tot} in total (${moy} on average)${au ? `; ${au} beyond the free waiting time` : "; nothing beyond the free waiting time"}.`,
    docs: (r, m) => `Documents: ${[r && `${r} received after the requested date`, m && `${m} missing at loading`].filter(Boolean).join(", ")}.`, docsOk: "Documents: all received on time, thank you.",
    detail: "Details", livre: (ref, tr, j, h, p, r) => `- ${ref} ${tr}: delivered on ${j}${h ? ` at ${h}` : ""}${p ? `, promised ${p}` : ""}${r ? ` (+${r})` : ""}.`, quai: (ref, q, lieu, j, d) => `- ${ref}, ${q === "chargement" ? "loading" : "delivery"}${lieu ? ` in ${lieu}` : ""} on ${j}: ${d} on site.`,
    docRetard: (ref, lib, r, l) => `- ${ref}: ${lib} received on ${r} (requested by ${l}).`, docManque: (ref, lib) => `- ${ref}: ${lib} missing at loading.`, aPreparer: "To prepare", prepa: (ref, tr, j, l) => `- ${ref} ${tr}, loading on ${j}: still missing ${l}.`,
    fin: "Thank you for your trust,", sujet: (d, f) => `Your week from ${d} to ${f}` },
  es: { salut: "Buenos días", intro: (d, f, e) => `Este es el resumen de su semana del ${d} al ${f}${e ? ` con ${e}` : ""}.`, livraisons: (n, ok, t) => `Entregas: ${n}${t !== null ? `, ${ok} a tiempo (${t} %)` : ""}.`, aucuneLivraison: "Entregas: ninguna esta semana.",
    attente: (n, tot, moy, au) => `Espera en sus muelles: ${n} paso(s), ${tot} en total (${moy} de media)${au ? `; ${au} por encima del tiempo de espera gratuito` : "; nada por encima del tiempo de espera gratuito"}.`,
    docs: (r, m) => `Documentos: ${[r && `${r} recibido(s) después de la fecha pedida`, m && `${m} faltante(s) en la carga`].filter(Boolean).join(", ")}.`, docsOk: "Documentos: todos recibidos a tiempo, gracias.",
    detail: "Detalle", livre: (ref, tr, j, h, p, r) => `- ${ref} ${tr}: entregado el ${j}${h ? ` a las ${h}` : ""}${p ? `, prometido ${p}` : ""}${r ? ` (+${r})` : ""}.`, quai: (ref, q, lieu, j, d) => `- ${ref}, ${q === "chargement" ? "carga" : "entrega"}${lieu ? ` en ${lieu}` : ""} el ${j}: ${d} en el lugar.`,
    docRetard: (ref, lib, r, l) => `- ${ref}: ${lib} recibido el ${r} (pedido para el ${l}).`, docManque: (ref, lib) => `- ${ref}: ${lib} faltante en la carga.`, aPreparer: "Por preparar", prepa: (ref, tr, j, l) => `- ${ref} ${tr}, carga el ${j}: todavía falta ${l}.`,
    fin: "Gracias por su confianza,", sujet: (d, f) => `Su semana del ${d} al ${f}` },
};
const langueResume = (cl) => (MODELES_RESUME[cl?.langueNotif] ? cl.langueNotif : "fr");

/** Message du résumé : { langue, sujet, texte } (texte vide si la semaine est vide). */
function messageResumeClient(r) {
  const langue = langueResume(r.client), M = MODELES_RESUME[langue], E = S.entreprise?.nom || "";
  const promis = (p) => (p ? `${jjmmResume(p.slice(0, 10))}${hhmmResume(p) ? " " + hhmmResume(p) : ""}` : "");
  const l = [`${M.salut}${r.client?.contact ? " " + r.client.contact : ""},`, "", M.intro(jjmmResume(r.debut), jjmmResume(r.fin), E), ""];
  l.push(r.livraisons.length ? M.livraisons(r.livraisons.length, r.aLHeure, r.tauxPonctualite) : M.aucuneLivraison);
  if (r.attentes.length) l.push(M.attente(r.attentes.length, dureeResume(r.attenteMin), dureeResume(r.attenteMin / r.attentes.length), r.auDelaMin ? dureeResume(r.auDelaMin) : ""));
  const retard = r.documents.filter((x) => x.statut === "en_retard").length, manque = r.documents.length - retard;
  if (r.documents.length) l.push(M.docs(retard, manque)); else if (r.chargementsSuivis) l.push(M.docsOk); // « à temps » seulement si la liste a été tenue
  if (r.livraisons.length || r.attentes.length || r.documents.length) {
    l.push("", M.detail);
    for (const x of r.livraisons) l.push(M.livre(x.ref, x.trajet, jjmmResume(jourLocalResume(x.livre)), hhmmResume(x.livre), promis(x.promis), x.aLHeure === false && x.retardMin ? dureeResume(x.retardMin) : ""));
    for (const x of r.attentes) l.push(M.quai(x.ref, x.quai, x.lieu, jjmmResume(jourLocalResume(x.arrivee)), dureeResume(x.minutes)));
    for (const x of r.documents) l.push(x.statut === "en_retard" ? M.docRetard(x.ref, libDoc(x.id, langue), jjmmResume(x.recu), jjmmResume(x.limite)) : M.docManque(x.ref, libDoc(x.id, langue)));
  }
  if (r.aPreparer.length) { l.push("", M.aPreparer); for (const x of r.aPreparer) l.push(M.prepa(x.ref, x.trajet, jjmmResume(x.date), x.manquants.map((id) => libDoc(id, langue)).join(", "))); }
  l.push("", M.fin, E);
  return { langue, sujet: `${M.sujet(jjmmResume(r.debut), jjmmResume(r.fin))}${E ? ` — ${E}` : ""}`, texte: r.vide ? "" : l.join("\n").trim() };
}

/** Destinataire du résumé : l'e-mail du client, sinon son WhatsApp. */
function destinataireResume(cl) {
  if (!cl) return { manque: "Client inconnu" };
  if (emailValide(cl.email)) return { canal: "email", destination: cl.email.trim(), langue: langueResume(cl), nom: cl.nom };
  const tel = telInternational(cl.tel); if (tel) return { canal: "whatsapp", destination: tel, langue: langueResume(cl), nom: cl.nom };
  return { manque: `${cl.nom} : e-mail ou téléphone à renseigner` };
}
/**
 * Résumés de la semaine passée à envoyer (clients qui l'ont demandé : client.resumeHebdo), une fois la semaine finie :
 * le lundi à 8 h (heure du Maroc), ou dès que l'application s'ouvre après — jusqu'au mercredi, ensuite il est trop tard.
 * Même forme que planNotifications ; `manques` à part.
 */
function planResumesClients({ maintenant = Date.now() } = {}) {
  const res = [], manques = [], aujourdhui = dateLocale(maintenant / 1000), lundi = lundiDeLaSemaine(aujourdhui), sem = { debut: joursPlus(lundi, -7), fin: joursPlus(lundi, -1) };
  const huit = dateHeureMaroc(lundi, "08:00"), limite = dateHeureMaroc(joursPlus(lundi, 2), "23:59");
  if (maintenant > limite) return Object.assign(res, { manques });
  const quand = Math.max(huit, Math.floor(maintenant / 900000) * 900000), annulees = S.notifsEtat?.annulees || {};
  for (const cl of S.clients || []) {
    if (!cl.resumeHebdo) continue;
    const id = `resume:${cl.id}:${sem.debut}`; if (annulees[id]) continue;
    const r = resumeClient(cl.id, { ...sem, maintenant }); if (r.vide) continue;
    const d = destinataireResume(cl); if (d.manque) { manques.push({ id, texte: d.manque }); continue; }
    const m = messageResumeClient(r);
    res.push({ id, clientId: cl.id, type: "resume_client", quand, audience: "client_externe", canal: d.canal, destination: d.destination, langue: m.langue, nom: d.nom, sujet: m.sujet, texte: m.texte, cle: id });
  }
  return Object.assign(res, { manques });
}
