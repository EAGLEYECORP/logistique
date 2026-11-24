"use strict";
/* ============================================================
   Mise en service — logique pure, testée. Ce qui est branché, ce qui manque, et ce que chaque point débloque :
   · le relais et ce qu'il sait faire (e-mail, boîte des demandes, itinéraire poids lourd, alertes au bureau), d'après /api/etat ;
   · les données qui font marcher les fonctions automatiques : balise de chaque camion, chauffeurs joignables, charges fixes,
     contacts, accord et tarif d'attente des clients, heure promise et bateau réservé des voyages, identité des factures, copie
     hors de l'appareil ;
   · ce qui se remplit avec l'usage (attentes aux ports, quais des clients) : affiché, jamais compté comme « à faire ».
   Interface (Réglages → Général, bandeau du tableau de bord) : mise_en_service_ui.js.
   ============================================================ */

const VERSION_RELAIS_MIN = "2.2.0"; // veille jour et nuit (coupures, quais), relances de documents, résumés du lundi
const ACTIFS_JOURS = 120;           // un client est « actif » s'il a une commande ou un voyage dans les 120 derniers jours (ou à venir)

/** Compare deux versions « 2.10.1 » / « 2.2.0 » : négatif, 0 ou positif. */
const comparerVersions = (a, b) => { const x = String(a || "0").split(".").map(Number), y = String(b || "0").split(".").map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
/** « A, B, C (+2) » : les premiers noms d'une liste. */
const listeCourte = (noms, n = 3) => { const l = noms.filter(Boolean); return l.length <= n ? l.join(", ") : `${l.slice(0, n).join(", ")} (+${l.length - n})`; };
/** ok si tout, partiel si une partie, a_faire si rien (liste non vide). */
const etatPart = (faits, total) => (faits >= total ? "ok" : faits > 0 ? "partiel" : "a_faire");

/** Clients actifs : commande ou voyage depuis 120 jours (ou à venir) ; à défaut, tous les clients. */
function clientsActifs(maintenant = Date.now()) {
  const depuis = dateISO(maintenant - ACTIFS_JOURS * 86400000), ids = new Set();
  for (const c of S.commandes || []) if ((c.dateChargement || c.dateLivraison || "") >= depuis && c.clientId) ids.add(c.clientId);
  for (const v of S.voyages || []) if ((v.dateDepart || v.dateRetourPrevue || "") >= depuis && v.clientId) ids.add(v.clientId);
  const actifs = (S.clients || []).filter((c) => ids.has(c.id));
  return actifs.length ? actifs : S.clients || [];
}
/** La prochaine traversée d'un voyage pas encore embarquée (même choix que bateauVoyage). */
function traverseeAReserver(v) {
  const fait = (t) => (v.jalons || []).some((j) => j.type === t);
  return ["aller", "retour"].map((s) => (v.traversees || []).find((x) => x.sens === s)).find((x) => x && x.statut !== "effectuee" && !fait(x.sens === "aller" ? "embarque_aller" : "embarque_retour")) || null;
}
/** Le chauffeur reçoit-il ses messages sans geste du bureau ? ntfy, ou WhatsApp quand le relais sait l'envoyer. */
function chauffeurJoignable(ch, canauxRelais = []) {
  if (typeof sujetNtfyValide === "function" && sujetNtfyValide(ch.ntfy)) return { ok: true, canal: "ntfy" };
  const tel = typeof telInternational === "function" ? telInternational(ch.tel) : "";
  if (tel && canauxRelais.includes("whatsapp")) return { ok: true, canal: "whatsapp" };
  return { ok: false, raison: tel ? "téléphone seul, WhatsApp à envoyer à la main" : "ni ntfy ni téléphone" };
}

/**
 * État de la mise en service.
 * relais : { configure, statut: "verif" | "ok" | "injoignable" | "refuse", etat (réponse de /api/etat), erreur } ;
 * appareil : { persistant: true | false | undefined }.
 * Renvoie { groupes: [{ id, titre, items }], prets, total, prochaine } ; item = { cle, titre, etat, detail, valeur, action, compte }.
 * etat : "ok" | "partiel" | "a_faire" | "attente" (vérification en cours) | "info" (se remplit avec l'usage, non compté).
 * action : { page, onglet?, ancre?, act?, id?, lib } — où le régler.
 */
function etatMiseEnService({ relais = { configure: false }, appareil = {}, maintenant = Date.now() } = {}) {
  const groupes = [], ajouter = (id, titre, items) => { const l = items.filter(Boolean); if (l.length) groupes.push({ id, titre, items: l }); };
  const item = (cle, titre, etat, detail, valeur, action = null) => ({ cle, titre, etat, detail, valeur, action, compte: etat !== "info" });
  const P = S.params || {};
  /** Où régler un point : la fiche du premier élément incomplet (act + id), sinon la page. */
  const vers = (page, act, id, lib) => (id ? { page, act, id, lib } : { page, lib: "Voir" });

  /* ---------- le relais ---------- */
  const e = relais.statut === "ok" ? relais.etat || {} : null, can = e?.notifications || [];
  const versRelais = { page: "parametres", onglet: "general", ancre: "carte-relais", lib: relais.configure ? "Voir" : "Brancher" };
  const relaisItem = !relais.configure ? item("relais", "Relais branché", "a_faire", "Pas encore branché : adresse et jeton de lecture à saisir.", "Envoie factures et relances, prévient clients et chauffeurs application fermée, reçoit les balises GPS, sert le lien de suivi et les prix du jour.", versRelais)
    : relais.statut === "verif" ? item("relais", "Relais branché", "attente", "Vérification…", "", versRelais)
    : relais.statut === "refuse" ? item("relais", "Relais branché", "a_faire", "Jeton de lecture refusé : recopiez-le depuis la machine du relais.", "", versRelais)
    : relais.statut !== "ok" ? item("relais", "Relais branché", "a_faire", `Injoignable${relais.erreur ? ` (${relais.erreur})` : ""} : machine éteinte, adresse ou https à revoir.`, "", versRelais)
    : comparerVersions(e.version, VERSION_RELAIS_MIN) < 0 ? item("relais", "Relais branché", "partiel", `Version ${e.version || "ancienne"} : à mettre à jour (git pull, puis redémarrer) pour la veille jour et nuit, les relances de documents et les résumés du lundi.`, "", versRelais)
    : item("relais", "Relais branché", "ok", `Joignable · version ${e.version}`, "", versRelais);
  const sansRelais = !e ? (relais.statut === "verif" ? "attente" : "a_faire") : null;
  const dep = (cle, titre, ok, detailOk, detailManque, valeur, action, partiel = null) =>
    sansRelais ? item(cle, titre, sansRelais, sansRelais === "attente" ? "Vérification…" : "Demande d'abord le relais.", valeur) // le bouton est sur la ligne du relais
      : partiel ? item(cle, titre, "partiel", partiel, valeur, action)
      : item(cle, titre, ok ? "ok" : "a_faire", ok ? detailOk : detailManque, valeur, action);
  const bo = e?.boite, iti = e?.itineraire;
  ajouter("relais", "Le relais (serveur du bureau)", [
    relaisItem,
    dep("email", "E-mail d'envoi", can.includes("email"), "Prêt : factures et relances partent du relais.", "Lignes SMTP_… à ajouter à la configuration du relais.", "Factures avec le PDF joint, relances de paiement et de documents, résumés du lundi aux clients.", { ...versRelais, lib: "Voir" }),
    dep("boite", "Boîte des demandes", !!bo?.active && !bo?.erreur, `Relevée${bo?.adresse ? ` : ${bo.adresse}` : ""}.`, "Lignes IMAP_… à ajouter à la configuration du relais.", "Les demandes de transport reçues par e-mail arrivent dans Commandes → Demandes, lues et pré-remplies.", { page: "parametres", onglet: "general", ancre: "carte-boite", lib: "Voir" }, bo?.active && bo?.erreur ? `Erreur de relève : ${bo.erreur}` : null),
    dep("itineraire", "Itinéraire poids lourd", !!iti?.actif, iti?.source === "prive" ? "Serveur openrouteservice du relais." : "Service public openrouteservice (usage interne).", "Clé openrouteservice (gratuite) à ajouter au relais : ITINERAIRE_CLE.", "Kilomètres, heures et péages calculés pour un camion (hauteur, poids, interdictions), pas pour une voiture.", { page: "parametres", onglet: "general", ancre: "carte-itineraire", lib: "Voir" }),
    dep("equipe", "Alertes au bureau", can.includes("equipe"), "Canal de l'équipe branché.", "Canal de l'équipe à ajouter au relais : NTFY_URL (ou Telegram, WhatsApp).", "Le bureau est prévenu même application fermée : pause dépassée, retard, demande reçue.", { ...versRelais, lib: "Voir" }),
  ]);

  /* ---------- flotte et chauffeurs ---------- */
  const camions = S.camions || [], chauffeurs = S.chauffeurs || [];
  const sansBalise = camions.filter((c) => !String(c.balise || "").trim());
  const sansFixes = camions.filter((c) => !(typeof fixesMensuelsCamion === "function" ? fixesMensuelsCamion(c).total > 0 : num(c.fixeMensuel) > 0));
  const injoignables = chauffeurs.map((ch) => ({ ch, j: chauffeurJoignable(ch, can) })).filter((x) => !x.j.ok);
  ajouter("flotte", "Flotte et chauffeurs", camions.length || chauffeurs.length ? [
    camions.length && item("balises", "Balise GPS sur chaque camion", etatPart(camions.length - sansBalise.length, camions.length),
      sansBalise.length ? `${camions.length - sansBalise.length} sur ${camions.length} · sans balise : ${listeCourte(sansBalise.map((c) => c.immat))}` : `${camions.length} sur ${camions.length}`,
      "Position sur la carte, arrivée estimée pour le client, passages aux quais et coupures surveillés jour et nuit.",
      vers("camions", "modifier", sansBalise[0]?.id, "Compléter")),
    chauffeurs.length && item("chauffeurs", "Chauffeurs joignables", etatPart(chauffeurs.length - injoignables.length, chauffeurs.length),
      injoignables.length ? `${chauffeurs.length - injoignables.length} sur ${chauffeurs.length} · ${[...new Set(injoignables.map((x) => x.j.raison))].map((r) => `${r} : ${listeCourte(injoignables.filter((x) => x.j.raison === r).map((x) => x.ch.nom), 2)}`).join(" · ")}` : `${chauffeurs.length} sur ${chauffeurs.length} (ntfy${can.includes("whatsapp") ? " ou WhatsApp" : ""})`,
      "Messages avant la pause et la fin de journée, rappels de port et d'embarquement, dans la langue du chauffeur.",
      vers("chauffeurs", "modifier", injoignables[0]?.ch.id, "Compléter")),
    camions.length && item("fixes", "Charges fixes de chaque camion", etatPart(camions.length - sansFixes.length, camions.length),
      sansFixes.length ? `${camions.length - sansFixes.length} sur ${camions.length} · à renseigner : ${listeCourte(sansFixes.map((c) => c.immat))}` : `${camions.length} sur ${camions.length}`,
      "Marge réelle de chaque voyage : crédit ou amortissement, assurance, taxes et salaire répartis sur les jours de route.",
      vers("rentabilite", "fixes-camion", sansFixes[0]?.id, "Compléter")),
  ] : [item("flotte", "Camions et chauffeurs", "a_faire", "Aucun camion ni chauffeur.", "Tout le reste en dépend : voyages, coûts, suivi.", { page: "camions", lib: "Ajouter" })]);

  /* ---------- clients ---------- */
  const actifs = clientsActifs(maintenant);
  if (actifs.length) {
    const sansContact = actifs.filter((c) => !String(c.email || "").trim() && !String(c.tel || "").trim());
    const accord = actifs.filter((c) => c.notificationsClientAutorisees), resume = actifs.filter((c) => c.resumeHebdo);
    const tarifGeneral = num(P.tarifAttente) > 0, sansTarif = tarifGeneral ? [] : actifs.filter((c) => !(num(c.tarifAttente) > 0));
    const sansAccord = actifs.filter((c) => !c.notificationsClientAutorisees);
    const n = actifs.length, deQui = n < (S.clients || []).length ? " actifs" : "";
    ajouter("clients", `Clients${deQui}`, [
      item("contacts", "Contact de chaque client", etatPart(n - sansContact.length, n),
        sansContact.length ? `${n - sansContact.length} sur ${n} · sans e-mail ni téléphone : ${listeCourte(sansContact.map((c) => c.nom))}` : `${n} sur ${n}`,
        "Factures, relances et résumés partent au bon endroit, en un geste.",
        vers("clients", "modifier", sansContact[0]?.id, "Compléter")),
      item("accord", "Accord pour être prévenus", etatPart(accord.length, n),
        `${accord.length} sur ${n} d'accord${resume.length ? ` · résumé du lundi : ${resume.length}` : ""}${sansAccord.length ? ` · à demander : ${listeCourte(sansAccord.map((c) => c.nom), 2)}` : ""}`,
        "Le client reçoit lui-même « chargé », « embarqué », « livré » et la relance de ses documents manquants. Sans son accord, rien ne lui est envoyé.",
        vers("clients", "modifier", sansAccord[0]?.id, "Noter l'accord")),
      item("attente", "Tarif d'attente aux quais", tarifGeneral ? "ok" : etatPart(n - sansTarif.length, n),
        tarifGeneral ? `Tarif général : ${fmt(num(P.tarifAttente))} ${(P.deviseAttente || "EUR") === "EUR" ? "€" : "MAD"} par heure au-delà de la franchise` : sansTarif.length ? `${n - sansTarif.length} sur ${n} · à fixer : ${listeCourte(sansTarif.map((c) => c.nom))}` : `${n} sur ${n}`,
        "L'attente au-delà de la franchise est calculée d'après les heures notées et proposée sur la facture.",
        vers("clients", "modifier", sansTarif[0]?.id, "Fixer")),
    ]);
  } else ajouter("clients", "Clients", [item("clients", "Clients", "a_faire", "Aucun client.", "Commandes, factures et suivi partent du client.", { page: "clients", lib: "Ajouter" })]);

  /* ---------- voyages prévus et en cours ---------- */
  const enCours = (S.voyages || []).filter((v) => ["prevu", "en_cours"].includes(v.statut));
  if (enCours.length) {
    const sansHeure = enCours.filter((v) => !v.livraisonPrevue);
    const aReserver = enCours.map((v) => ({ v, t: traverseeAReserver(v) })).filter((x) => x.t), nonReserves = aReserver.filter((x) => !x.t.date || !/^\d{2}:\d{2}$/.test(x.t.heure || ""));
    const n = enCours.length;
    ajouter("voyages", "Voyages prévus et en cours", [
      item("heure", "Heure de livraison promise", etatPart(n - sansHeure.length, n),
        sansHeure.length ? `${n - sansHeure.length} sur ${n} · sans heure : ${listeCourte(sansHeure.map((v) => v.ref || v.id))}` : `${n} sur ${n}`,
        "Retard vu avant qu'il arrive, client prévenu, ponctualité mesurée dans son résumé.",
        vers("voyages", "modifier", sansHeure[0]?.id, "Compléter")),
      aReserver.length && item("bateau", "Bateau réservé (date et heure)", etatPart(aReserver.length - nonReserves.length, aReserver.length),
        nonReserves.length ? `${aReserver.length - nonReserves.length} sur ${aReserver.length} · à saisir : ${listeCourte(nonReserves.map((x) => `${x.v.ref || x.v.id} (${x.t.sens})`))}` : `${aReserver.length} sur ${aReserver.length}`,
        "Heure limite d'entrée au port calculée et comparée à l'arrivée estimée du camion.",
        vers("voyages", "trav", nonReserves[0] && `${nonReserves[0].v.id}|${nonReserves[0].t.sens}`, "Saisir")),
    ]);
  }

  /* ---------- entreprise et données ---------- */
  const E = S.entreprise || {}, manque = [["nom", "raison sociale"], ["ice", "ICE"], ["rib", "RIB"], ["adresse", "adresse"]].filter(([k]) => !String(E[k] || "").trim()).map(([, l]) => l);
  const ds = S.meta?.derniereSauvegarde, jours = ds ? Math.floor((maintenant - Date.parse(ds)) / 86400000) : null, rappel = num(P.rappelSauvegarde, 7);
  const synchro = typeof synchroActive === "function" && synchroActive() && !(typeof synchroEtat === "function" && synchroEtat().erreur);
  ajouter("entreprise", "Entreprise et données", [
    item("identite", "Identité sur les factures", manque.length ? (manque.length === 4 ? "a_faire" : "partiel") : "ok",
      manque.length ? `À compléter : ${manque.join(", ")}` : `${E.nom} · ICE ${E.ice}`,
      "Factures et relances conformes, prêtes à envoyer.",
      { page: "parametres", onglet: "general", ancre: "carte-entreprise", lib: manque.length ? "Compléter" : "Voir" }),
    item("copie", "Copie hors de l'appareil", synchro ? "ok" : jours === null ? "a_faire" : jours > rappel ? "partiel" : "ok",
      synchro ? "Synchronisée avec le relais." : jours === null ? "Jamais exportée." : jours > rappel ? `Dernière exportation il y a ${jours} jours.` : jours === 0 ? "Exportée aujourd'hui." : `Exportée il y a ${jours} jour${jours > 1 ? "s" : ""}.`,
      "Rien n'est perdu si le téléphone ou l'ordinateur est perdu, volé ou en panne.",
      { page: "parametres", onglet: "donnees", lib: synchro || (jours !== null && jours <= rappel) ? "Voir" : "Exporter" }),
    item("protection", "Protection contre l'effacement (cet appareil)", appareil.persistant === true ? "ok" : appareil.persistant === false ? "a_faire" : "attente",
      appareil.persistant === true ? "Activée." : appareil.persistant === false ? "Non activée : le navigateur peut effacer les données s'il manque de place." : "Vérification…",
      "Le navigateur ne vide jamais les données de l'application, même quand l'appareil manque d'espace.",
      appareil.persistant === false ? { page: "parametres", act: "persister", lib: "Activer" } : { page: "parametres", onglet: "donnees", lib: "Voir" }),
  ]);

  /* ---------- avec l'usage (non compté) ---------- */
  const seuil = Math.max(1, num(P.seuilCalibrationAttente, 10));
  const ports = (typeof PORTS_ATTENTE !== "undefined" ? PORTS_ATTENTE : []).map(([id, lib]) => ({ lib, n: (S.attentesPort || []).filter((x) => x.portId === id && !x.scanRouge && num(x.dureeMs) > 0).length }));
  const avecSites = actifs.filter((c) => (c.sites || []).some((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
  ajouter("usage", "Se remplit avec l'usage", [
    ports.length && item("ports", "Attentes aux ports apprises", "info",
      `${ports.map((p) => `${p.lib} : ${Math.min(p.n, seuil)}/${seuil}`).join(" · ")}${ports.every((p) => p.n >= seuil) ? " — prévisions tirées de vos passages" : ""}`,
      "Attente prévue à chaque port d'après vos propres passages, au lieu d'une valeur générale. Chaque passage noté (ou vu par la balise) compte."),
    actifs.length && item("sites", "Quais des clients repérés", "info", `${avecSites.length} client${avecSites.length > 1 ? "s" : ""} sur ${actifs.length}`,
      "Arrivée et départ aux quais notés seuls par le GPS : attente facturable sans saisie. Les quais s'apprennent aux livraisons suivies par une balise."),
  ]);

  const tous = groupes.flatMap((g) => g.items), comptes = tous.filter((x) => x.compte);
  return { groupes, prets: comptes.filter((x) => x.etat === "ok").length, total: comptes.length, prochaine: comptes.find((x) => x.etat !== "ok" && x.etat !== "attente") || null };
}
