"use strict";
/* ============================================================
   Conseils d'exploitation — logique pure, testée :
   · prix plancher du fret de retour ; camions à l'arrêt et corridors les plus rentables ;
   · traversées à réserver ; faisabilité légale pour le chauffeur ; repos hebdomadaire à prévoir.
   Dépend de noyau.js, pilotage.js, rentabilite.js, tresorerie.js.
   ============================================================ */

const jalonFait = (v, k) => (v.jalons || []).some((j) => j.type === k);

/**
 * Prix plancher du fret de retour d'un voyage livré sans retour chargé : en dessous, l'aller-retour perd de l'argent.
 * Plancher = coût complet de l'aller-retour (coûts directs + part de charges fixes et générales) − prix de l'aller. Renvoie null si le voyage n'est pas concerné.
 */
function seuilRetour(v) {
  if (!v || ["annule", "termine"].includes(v.statut) || !jalonFait(v, "livre") || jalonFait(v, "charge_retour") || num(v.kmRetourCharge) > 0 || v.retourTrouve) return null;
  const m = margeVoyage(v), complet = m.total_direct + m.total_structure, seuilMad = Math.max(0, complet - m.revenu);
  return { voyageId: v.id, coutComplet: complet, revenu: m.revenu, seuilMad, seuilEur: seuilMad / S.params.tauxEUR, dejaCouvert: m.revenu >= complet, parKm: num(v.kmRetourVide) > 0 ? seuilMad / num(v.kmRetourVide) : 0 };
}

/** Corridors classés par marge directe au kilomètre pour un camion (12 derniers mois) ; à défaut, ceux de la flotte. [{ nom, margeKm, nb, propre }] */
function meilleursCorridors(camionId, n = 3, jusqua = today()) {
  const p = pnlPeriode(decalerJours(jusqua, -365), jusqua), avecKm = (l) => l.filter((x) => x.km > 0 && x.marge_directe > 0).map((x) => ({ nom: x.noms[x.noms.length - 1], margeKm: x.marge_directe / x.km, nb: x.nb }));
  const propres = avecKm(pivotPnl(p.lignes.filter((l) => l.camion === camionId), ["corridor"])).map((x) => ({ ...x, propre: true }));
  const liste = propres.length ? propres : avecKm(p.par_corridor).map((x) => ({ ...x, propre: false }));
  return liste.sort((a, b) => b.margeKm - a.margeKm).slice(0, n);
}
/**
 * Camions à l'arrêt depuis plus de `heures` heures sans voyage prévu ou en cours.
 * positions (facultatif) : [{ camionId, zone, arretMin }] venant du suivi en direct. Sans position : d'après la fin du dernier voyage.
 * [{ camionId, immat, heures, lieu, corridors }]
 */
function camionsALArret({ positions = [], maintenant = Date.now(), heures = 24 } = {}) {
  const auj = dateISO(maintenant), r = [];
  for (const c of S.camions) {
    if (S.voyages.some((v) => v.camionId === c.id && (v.statut === "en_cours" || (v.statut === "prevu" && v.dateDepart && joursEntre(auj, v.dateDepart) <= 2)))) continue;
    const pos = positions.find((p) => p.camionId === c.id), finis = S.voyages.filter((v) => v.camionId === c.id && v.statut === "termine" && finVoyage(v) && finVoyage(v) <= auj).map(finVoyage).sort();
    let h = null, lieu = "";
    if (pos && pos.zone) { h = num(pos.arretMin) / 60; lieu = pos.zone; }
    else if (finis.length) { h = (maintenant - Date.parse(finis[finis.length - 1] + "T23:59:59Z")) / 3600000; lieu = "depuis son dernier voyage"; }
    if (h === null || h < heures) continue;
    r.push({ camionId: c.id, immat: c.immat, heures: h, lieu, corridors: meilleursCorridors(c.id, 3, auj) });
  }
  return r.sort((a, b) => b.heures - a.heures);
}

/** Traversées non réservées des voyages prévus ou en cours (le retour n'est signalé qu'une fois le voyage parti) : [{ voyageId, ref, sens, jours (avant le départ), urgent }] */
function traverseesAReserver(auj = today()) {
  const r = [];
  for (const v of S.voyages) {
    if (!["prevu", "en_cours"].includes(v.statut)) continue;
    for (const sens of ["aller", "retour"]) {
      const t = (v.traversees || []).find((x) => x.sens === sens);
      if ((t && t.statut !== "a_reserver") || jalonFait(v, sens === "aller" ? "embarque_aller" : "embarque_retour")) continue;
      if (sens === "retour" && v.statut === "prevu") continue;
      const jours = sens === "aller" && v.dateDepart ? joursEntre(auj, v.dateDepart) : v.dateRetourPrevue ? joursEntre(auj, v.dateRetourPrevue) : null;
      r.push({ voyageId: v.id, ref: v.ref || "", sens, jours, urgent: jours !== null && jours <= 2 });
    }
  }
  return r.sort((a, b) => (a.jours ?? 999) - (b.jours ?? 999));
}

/** Heures de conduite légalement possibles en n jours consécutifs : 9 h par jour, 10 h deux fois par semaine, 56 h par semaine, 90 h sur deux semaines, un repos hebdomadaire par semaine. */
function conduiteLegaleMax(jours) {
  let total = 0;
  for (let reste = Math.max(0, Math.floor(jours)), sem = 0; reste > 0; sem++) {
    const j = Math.min(6, reste), brut = Math.min(56, j * 9 + Math.min(2, j));
    total += sem % 2 === 1 ? Math.min(brut, 90 - Math.min(56, 6 * 9 + 2)) : brut; // la deuxième semaine d'une quinzaine est plafonnée par les 90 h
    reste -= 7;
  }
  return total;
}
/**
 * Le chauffeur peut-il légalement faire ce voyage ? Conduite nécessaire (kilomètres / vitesse moyenne) contre la conduite possible sur la durée prévue,
 * diminuée de ce que sa carte montre déjà sur la semaine en cours ; séjour Schengen sur 180 jours.
 * { ok, heuresNecessaires, heuresPossibles, joursMin, raisons[] } — null sans chauffeur ni kilomètres.
 */
function faisabiliteChauffeur(v) {
  const ch = parId(S.chauffeurs, v?.chauffeurId), km = num(v?.kmAller) + num(v?.kmRetourCharge) + num(v?.kmRetourVide);
  if (!ch || !(km > 0) || !v.dateDepart) return null;
  const jours = joursVoyage(v), heuresNecessaires = km / Math.max(30, num(S.params.vitesseMoyenne, 70)), raisons = [];
  let heuresPossibles = conduiteLegaleMax(jours);
  const lundi = (iso) => decalerJours(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));
  const deja = (ch.tachy?.semaines || []).find((s) => s.debut === lundi(v.dateDepart));
  if (deja && num(deja.conduiteH) > 0) { heuresPossibles = Math.max(0, heuresPossibles - num(deja.conduiteH)); raisons.push(`${fmt(deja.conduiteH, 0)} h déjà conduites cette semaine-là (carte conducteur)`); }
  let joursMin = 1; while (conduiteLegaleMax(joursMin) < heuresNecessaires && joursMin < 60) joursMin++;
  const conduiteOk = heuresNecessaires <= heuresPossibles;
  if (!conduiteOk) raisons.unshift(`${fmt(heuresNecessaires, 0)} h de conduite nécessaires pour ${fmt(km)} km, ${fmt(heuresPossibles, 0)} h légalement possibles en ${jours} jour(s) : il faut au moins ${joursMin} jours ou un deuxième chauffeur`);
  const sch = schengenPrevu(ch.sejours, v.dateDepart, finVoyage(v) || v.dateDepart);
  if (!sch.ok) raisons.push(`séjour Schengen dépassé : ${sch.pic} jours sur 180 (limite 90)`);
  return { ok: conduiteOk && sch.ok, conduiteOk, schengenOk: sch.ok, heuresNecessaires, heuresPossibles, joursMin, jours, raisons };
}

/** Repos hebdomadaire à prévoir hors cabine quand le voyage dépasse 6 jours : coût estimé (S.params.reposHebdoEur par repos) et effet sur la marge. null si non concerné ou déjà prévu (ligne « hébergement »). */
function reposHebdoAPrevoir(v) {
  if (!v || ["annule", "termine"].includes(v.statut)) return null;
  const jours = joursVoyage(v); if (jours <= 6) return null;
  const nb = Math.floor((jours - 1) / 6), prevus = (v.lignesCout || []).filter((l) => l.type === "hebergement").length;
  if (prevus >= nb) return null;
  const coutEur = (nb - prevus) * num(S.params.reposHebdoEur, 70), coutMad = coutEur * S.params.tauxEUR, m = margeVoyage(v);
  return { voyageId: v.id, jours, nb: nb - prevus, coutEur, coutMad, margeAvant: m.marge_directe, margeApres: m.marge_directe - coutMad };
}

/**
 * Tous les conseils du moment, les plus urgents d'abord : [{ type, niveau, voyageId?, camionId?, titre, texte, action: { act, id, lib } }].
 * positions : état de la flotte en direct (facultatif).
 */
function conseils({ positions = [], maintenant = Date.now() } = {}) {
  const r = [], auj = dateISO(maintenant);
  for (const v of S.voyages) {
    const s = seuilRetour(v);
    if (s) r.push({ type: "retour", niveau: "warn", voyageId: v.id, titre: `${v.ref} — retour à vide`, texte: s.dejaCouvert ? `L'aller couvre déjà l'aller-retour : tout fret de retour est du bénéfice.` : `En dessous de ${fmt(s.seuilEur, 0)} € de fret de retour (${fmt(s.seuilMad)} MAD), cet aller-retour perd de l'argent.`, action: { act: "aller", id: "rentabilite", lib: "Proposer le retour" } });
    if (["prevu", "en_cours"].includes(v.statut)) {
      const f = v.statut === "prevu" ? faisabiliteChauffeur(v) : null;
      if (f && !f.ok) r.push({ type: "chauffeur", niveau: "danger", voyageId: v.id, titre: `${v.ref} — ${nomChauffeur(v.chauffeurId)} ne peut pas faire ce voyage dans les règles`, texte: f.raisons.join(" · "), action: { act: "voyage", id: v.id, lib: "Ouvrir le voyage" } });
      const h = reposHebdoAPrevoir(v);
      if (h) r.push({ type: "repos", niveau: "warn", voyageId: v.id, titre: `${v.ref} — ${h.jours} jours : repos hebdomadaire hors cabine à prévoir`, texte: `Réservez ${h.nb > 1 ? h.nb + " nuits" : "une nuit"} et un parking sécurisé : environ ${fmt(h.coutEur, 0)} €.`, finance: `La marge directe passe de ${fmt(h.margeAvant)} à ${fmt(h.margeApres)} MAD.`, action: { act: "voyage", id: v.id, lib: "Ajouter la dépense" } });
    }
  }
  for (const t of traverseesAReserver(auj)) r.push({ type: "traversee", niveau: t.urgent ? "danger" : "warn", voyageId: t.voyageId, titre: `${t.ref} — traversée ${t.sens} à réserver`, texte: t.jours === null ? "Aucune réservation enregistrée." : t.jours < 0 ? "Le départ est passé et aucune réservation n'est enregistrée." : t.sens === "aller" ? `Départ dans ${t.jours} jour(s).` : `Retour prévu dans ${t.jours} jour(s).`, action: { act: "voyage", id: t.voyageId, lib: "Réserver" } });
  for (const c of camionsALArret({ positions, maintenant })) r.push({ type: "arret", niveau: "warn", camionId: c.camionId, titre: `${c.immat} — à l'arrêt depuis ${c.heures >= 48 ? fmt(c.heures / 24, 0) + " jours" : fmt(c.heures, 0) + " h"}${c.lieu && !/depuis/.test(c.lieu) ? ` (${c.lieu})` : ""}`,
    texte: c.corridors.length ? `Corridors les plus rentables${c.corridors[0].propre ? " pour ce camion" : " de la flotte"} : ${c.corridors.map((x) => `${x.nom} (${fmt(x.margeKm, 2)} MAD/km)`).join(", ")}.` : "Aucun voyage prévu pour ce camion.", action: { act: "aller", id: "voyages", lib: "Planifier un voyage" } });
  const ordre = { danger: 0, warn: 1 };
  return r.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}

/* ---------- tableau des opérations : une carte par camion ---------- */
/**
 * Une carte par camion : état, voyage en cours, prochaine étape, chauffeur, arrivée estimée, alertes, marge en direct, bureau responsable.
 * flotte : entrées du suivi en direct [{ camion, etat, eta, alertes, voyage }] (facultatif). Trié : alertes d'abord, puis en voyage, puis disponibles.
 */
function cartesOperations({ flotte = [], auj = today() } = {}) {
  return S.camions.map((c) => {
    const live = flotte.find((f) => f.camion?.id === c.id);
    const voyage = S.voyages.find((v) => v.camionId === c.id && v.statut === "en_cours") || S.voyages.filter((v) => v.camionId === c.id && v.statut === "prevu" && v.dateDepart).sort((a, b) => a.dateDepart.localeCompare(b.dateDepart))[0] || null;
    const chauffeur = (voyage && parId(S.chauffeurs, voyage.chauffeurId)) || S.chauffeurs.find((h) => h.camionId === c.id) || null;
    const prochain = voyage ? JALONS_VOYAGE.find(([k]) => !jalonFait(voyage, k)) : null, dernier = voyage && (voyage.jalons || []).length ? voyage.jalons[voyage.jalons.length - 1] : null;
    const alertesVoyage = voyage && ["prevu", "en_cours"].includes(voyage.statut) ? controlesVoyage(voyage).filter((x) => x.niveau === "danger").length : 0;
    const nbAlertes = (live?.alertes || []).length + alertesVoyage;
    const etat = live?.etat?.libelle && live.etat.code !== "inconnu" ? { libelle: live.etat.libelle, niveau: live.etat.niveau || "neutral", zone: live.etat.zone?.nom || "" }
      : voyage?.statut === "en_cours" ? { libelle: dernier ? JALONS_VOYAGE.find((j) => j[0] === dernier.type)?.[1] || "En voyage" : "En voyage", niveau: "ok", zone: "" }
      : voyage ? { libelle: `Départ le ${dateFr(voyage.dateDepart)}`, niveau: joursEntre(auj, voyage.dateDepart) < 0 ? "warn" : "neutral", zone: "" } : { libelle: "Disponible", niveau: "neutral", zone: "" };
    const m = voyage ? margeVoyage(voyage) : null;
    return { camionId: c.id, immat: c.immat, bureau: c.officeResponsable || "", etat, voyage: voyage ? { id: voyage.id, ref: voyage.ref || "", statut: voyage.statut, trajet: `${voyage.origine || "?"} ⇄ ${voyage.destination || "?"}`, livraisonPrevue: voyage.livraisonPrevue || "" } : null,
      chauffeur: chauffeur ? { id: chauffeur.id, nom: chauffeur.nom, tel: chauffeur.tel || "" } : null, prochain: prochain ? prochain[1] : "", eta: live?.eta || null, nbAlertes, marge: m && m.revenu ? m.marge_directe : null, rang: nbAlertes ? 0 : voyage?.statut === "en_cours" ? 1 : voyage ? 2 : 3 };
  }).sort((a, b) => a.rang - b.rang || a.immat.localeCompare(b.immat));
}

/* ---------- chaque alerte à un geste de l'action ---------- */
/** Actions directes pour une alerte, d'après sa clé : appeler ou écrire au chauffeur, écrire au client, ouvrir le voyage. [{ genre, lib, href? , id? }] */
function actionsAlerte(a) {
  const [genre, x, y] = String(a?.cle || "").split(":"), r = [];
  const versChauffeur = (ch) => { if (!ch?.tel) return; r.push({ genre: "tel", lib: "Appeler", href: `tel:+${telInternational(ch.tel)}` }, { genre: "whatsapp", lib: "WhatsApp", href: lienWhatsApp(ch.tel, `Bonjour ${ch.nom}, ${a.texte}`) }); };
  if (["repos", "schengen", "tachy"].includes(genre)) versChauffeur(parId(S.chauffeurs, x));
  else if (genre === "docs" && x === "ch") versChauffeur(parId(S.chauffeurs, y));
  else if (genre === "conso" || genre === "anomalie" || (genre === "docs" && x === "cam")) versChauffeur(S.chauffeurs.find((h) => h.camionId === (genre === "docs" ? y : x)));
  else if (genre === "fac") { const f = parId(S.factures, x), cl = f && parId(S.clients, f.clientId); if (cl?.email) r.push({ genre: "mail", lib: "Écrire au client", href: `mailto:${cl.email}?subject=${encodeURIComponent(`Facture ${f.numero}`)}` }); if (cl?.tel) r.push({ genre: "tel", lib: "Appeler", href: `tel:+${telInternational(cl.tel)}` }); }
  else if (genre === "voy") { const v = parId(S.voyages, x); if (v) { r.push({ genre: "voyage", lib: "Ouvrir le voyage", id: v.id }); versChauffeur(parId(S.chauffeurs, v.chauffeurId)); } }
  return r;
}
