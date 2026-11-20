"use strict";
/* ============================================================
   Fiche du voyage — logique pure, testée.
   · frise : où en est le voyage d'un coup d'œil (départ, port de départ, port d'arrivée, livraison, retour, dépôt) ;
   · prochaine action : la seule chose à faire maintenant, calculée d'après l'état du voyage
     (équipe, traversée, documents, départ, étape de port suivante, livraison, retour à trouver ou à charger, dépôt,
      puis l'argent : facturer, envoyer, relancer, encaisser) ;
   · points d'attention : ce qui demande un geste sans être l'action du moment (documents, retour, traversée, attente au port, preuve, facture) ;
   · poser une étape précise du voyage (et ses effets : statut, traversée effectuée).
   Dépend de noyau.js, aller_retour.js, documents_commande.js, fret_retour.js, portuaire.js, passages.js.
   ============================================================ */

const jalonDe = (v, type) => (v?.jalons || []).find((j) => j.type === type) || null;
const traverseeDe = (v, sens) => (v?.traversees || []).find((t) => t.sens === sens) || null;
/** Les étapes de port Tanger Med ⇄ Algeciras s'appliquent-elles à ce sens ? (traversée du détroit, ou aucune traversée saisie) */
function sensParDetroit(v, sens) {
  const t = traverseeDe(v, sens);
  if (t) return t.ligne === (sens === "aller" ? "tmed-alg" : "alg-tmed");
  return !(v.traversees || []).length;
}
const FMT_JOUR_HEURE = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" }), FMT_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
const jourHeureCourt = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? FMT_JOUR_HEURE.format(d).replace(",", "") : ""; };
const jourCourt = (iso) => { const d = new Date(String(iso).length <= 10 ? iso + "T12:00:00" : iso); return Number.isFinite(d.getTime()) ? FMT_JOUR_COURT.format(d) : ""; };
const dureeCourte = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}` : `${Math.round(m / 1440)} j`; };

/**
 * Frise du voyage : { noeuds: [{ cle, lib, etat: "fait" | "encours" | "avenir", sous, alerte }], courant (index ou -1), fraction (0 à 1), legende }.
 * Un nœud est fait si son étape l'est, ou si une étape plus loin l'est déjà (le GPS peut en sauter).
 */
function friseVoyage(v, maintenant = Date.now()) {
  const J = (t) => jalonDe(v, t), aller = traverseeDe(v, "aller"), n = [];
  const ports = (aller && LIGNES_TRAVERSEE[aller.ligne]?.lib.split(" → ")) || ["Tanger Med", "Algeciras"];
  const etapeFaite = (id) => { const e = etapePort(id); return e ? etatEtapePort(v, e) : { fait: false }; };
  const entreePort = J("port_tmed")?.date || (etapeFaite("tme_parc").fait ? etapeFaite("tme_parc").date : ""), sortieAlg = v.sortiesPort?.alg_entry || (etapeFaite("alg_sortie").fait ? etapeFaite("alg_sortie").date : "");
  n.push({ cle: "depart", lib: "Départ", fait: !!J("depart"), date: J("depart")?.date, prevu: v.dateDepart });
  if (aller || sensParDetroit(v, "aller")) {
    n.push({ cle: "port_depart", lib: ports[0], fait: !!J("embarque_aller"), debut: entreePort, fin: J("embarque_aller")?.date });
    n.push({ cle: "port_arrivee", lib: ports[1] || "Europe", fait: !!sortieAlg, debut: J("debarque_alg")?.date, fin: sortieAlg, enMer: !!J("embarque_aller") && !J("debarque_alg") });
  }
  n.push({ cle: "livraison", lib: "Livraison", fait: !!J("livre"), date: J("livre")?.date, prevu: v.livraisonPrevue });
  n.push({ cle: "retour", lib: "Retour", fait: !!(J("debarque_tmed") || J("douane_import")), date: (J("douane_import") || J("debarque_tmed"))?.date });
  n.push({ cle: "depot", lib: "Dépôt", fait: !!J("retour") || v.statut === "termine", date: J("retour")?.date, prevu: v.dateRetourPrevue });
  let dernierFait = -1; n.forEach((x, i) => { if (x.fait) dernierFait = i; });
  const courant = v.statut === "en_cours" && dernierFait < n.length - 1 ? dernierFait + 1 : -1;
  const retourCmd = typeof commandeRetour === "function" ? commandeRetour(v) : null;
  const noeuds = n.map((x, i) => {
    const etat = i <= dernierFait ? "fait" : i === courant ? "encours" : "avenir"; let sous = "", alerte = false;
    if (etat === "fait") sous = x.debut && x.fin && Date.parse(x.fin) > Date.parse(x.debut) ? dureeCourte(Date.parse(x.fin) - Date.parse(x.debut)) : x.date || x.fin ? jourHeureCourt(x.date || x.fin) : "";
    else if (x.cle === "retour") {
      if (retourCmd) sous = J("embarque_retour") ? "en mer" : J("charge_retour") ? "chargé" : "à charger";
      else if (v.retourAVide) sous = "à vide";
      else if (typeof chercheRetour === "function" && chercheRetour(v)) { sous = "à trouver"; alerte = true; }
    } else if (etat === "encours") sous = x.enMer ? "en mer" : x.debut ? `depuis ${dureeCourte(maintenant - Date.parse(x.debut))}` : "en route";
    else if (x.prevu) sous = String(x.prevu).length > 10 ? jourHeureCourt(x.prevu) : jourCourt(x.prevu);
    return { cle: x.cle, lib: x.lib, etat, sous, alerte };
  });
  const c = courant >= 0 ? noeuds[courant] : null;
  return { noeuds, courant, fraction: n.length > 1 ? Math.max(0, courant >= 0 ? courant : dernierFait) / (n.length - 1) : 0, legende: c ? `${c.lib}${c.sous ? " · " + c.sous : ""}` : "" };
}

/** Pose une étape précise du voyage (sans doublon) et ses effets : voyage en cours, traversée effectuée, voyage terminé au retour au dépôt. */
function poserJalon(v, type, date = new Date().toISOString()) {
  if (!v || !JALONS_VOYAGE.some(([k]) => k === type) || jalonDe(v, type)) return false;
  (v.jalons ||= []).push({ type, date }); v.jalons.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (v.statut === "prevu") v.statut = "en_cours";
  const t = type === "embarque_aller" ? traverseeDe(v, "aller") : type === "embarque_retour" ? traverseeDe(v, "retour") : null;
  if (t) t.statut = "effectuee";
  if (type === "retour") v.statut = "termine";
  return true;
}

/** Prochaine étape de port d'un sens : la première étape obligatoire non faite après la dernière faite (les étapes sautées ne bloquent pas). */
function prochaineEtapePort(v, sens) {
  if (!sensParDetroit(v, sens)) return null;
  const ch = chainePassage(v, sens); let dernier = -1; ch.forEach((x, i) => { if (x.s.fait) dernier = i; });
  return ch.slice(dernier + 1).find((x) => !x.e.facultatif) || null;
}
/**
 * La chose à faire maintenant : { cle, titre, detail, bouton, act, id, ton: "action" | "alerte" | "attente" | "ok", second?: { bouton, act, id } } ; null pour un voyage annulé.
 * `act` et `id` sont ceux des boutons de la page Voyages (data-act, data-id).
 */
function prochaineAction(v, maintenant = Date.now()) {
  if (!v || v.statut === "annule") return null;
  const auj = new Date(maintenant).toISOString().slice(0, 10), fait = (t) => !!jalonDe(v, t), aller = commandeAller(v), retour = commandeRetour(v);
  const A = (cle, titre, detail, bouton, act, id, plus = {}) => ({ cle, titre, detail, bouton, act, id, ton: "action", ...plus });
  const montant = (f) => `${fmt(totauxFacture(f).ttc, 2)} ${f.devise === "EUR" ? "€" : "MAD"}`;

  if (v.statut === "prevu") {
    if (!v.chauffeurId || !v.camionId) return A("equipe", "Affecter un chauffeur et un camion", "Le voyage ne peut pas partir sans son équipe.", "Modifier le voyage", "modifier", v.id);
    const jours = v.dateDepart ? joursEntre(auj, v.dateDepart) : 99, t = traverseeDe(v, "aller");
    if (t && t.statut === "a_reserver") return A("traversee", "Réserver la traversée aller", `${LIGNES_TRAVERSEE[t.ligne]?.lib || "Traversée"}${v.dateDepart ? ` · départ du dépôt le ${dateFr(v.dateDepart)}` : ""}. Présentation au port environ 3 h avant.`, "Noter la réservation", "trav", `${v.id}|aller`);
    const docs = aller ? etatDocuments(aller) : null;
    if (docs && docs.bloquantsManquants.length && jours > 0) return A("documents", "Demander les documents au client", `Il manque : ${docs.bloquantsManquants.map((x) => x.lib).join(", ")}.`, "Voir les documents", "docs-voyage", aller.id);
    const bloquants = controlesVoyage(v).filter((c) => c.niveau === "danger" && !/^Documents /.test(c.texte));
    if (bloquants.length) return A("blocage", "À régler avant le départ", `${bloquants[0].texte}${bloquants.length > 1 ? ` (et ${bloquants.length - 1} autre${bloquants.length > 2 ? "s" : ""})` : ""}`, "Voir les points", "fiche-onglet", `${v.id}|equipe`, { ton: "alerte" });
    return A("depart", "Départ du dépôt", v.dateDepart ? `Prévu le ${dateFr(v.dateDepart)}${jours < 0 ? ` : en retard de ${-jours} j` : jours === 0 ? " : aujourd'hui" : jours === 1 ? " : demain" : ""}.` : "", "Marquer le départ", "jalon", `${v.id}|depart`, jours < 0 ? { ton: "alerte" } : {});
  }

  if (v.statut === "en_cours" && !fait("retour")) {
    const etape = (p) => { const s = SUITES_PASSAGE[p.e.id] || {}, seuil = seuilPassage(p.e.id);
      return A(`port:${p.e.id}`, etapePortLib(p), `${p.e.docs?.length ? `À présenter : ${p.e.docs.join(", ")}. ` : ""}${seuil ? `Habituellement moins de ${dureePassage(seuil)}.` : p.e.detail || ""}`.trim(), "Marquer « fait »", "port-etape", `${v.id}|${p.e.id}`, { acteur: ACTEURS_PASSAGE[s.acteur] || "" }); };
    if (!fait("livre")) {
      const p = prochaineEtapePort(v, "aller"); if (p) return etape(p);
      return A("livraison", `Livraison à ${v.destination || "destination"}`, v.livraisonPrevue ? `Promise le ${jourCourt(v.livraisonPrevue)} à ${String(v.livraisonPrevue).slice(11, 16)}.` : "Faites signer la preuve de livraison par le destinataire.", "Marquer « livré »", "jalon", `${v.id}|livre`, { second: { bouton: "Preuve de livraison", act: "preuve", id: v.id } });
    }
    if (!fait("charge_retour") && !fait("embarque_retour")) {
      if (retour) return A("charge_retour", `Charger le retour ${retour.ref || ""}`.trim(), `${nomClient(retour.clientId)} · ${retour.origine || "?"} → ${retour.destination || "?"}${retour.dateChargement ? ` · le ${dateFr(retour.dateChargement)}` : ""}.`, "Marquer « chargé »", "jalon", `${v.id}|charge_retour`);
      if (chercheRetour(v)) { const pl = plancherRetour(v); return A("retour", "Trouver un chargement de retour", pl.couvert ? "L'aller couvre déjà l'aller-retour : tout retour est du bénéfice." : `Prix plancher ${fmt(pl.eur)} € : en dessous, l'aller-retour perd de l'argent.`, "Trouver un retour", "retour-chercher", v.id, { second: { bouton: "Rentrer à vide", act: "retour-avide", id: v.id } }); }
    }
    const p = prochaineEtapePort(v, "retour"); if (p) return etape(p);
    return A("depot", "Retour au dépôt", v.dateRetourPrevue ? `Prévu le ${dateFr(v.dateRetourPrevue)}.` : "", "Marquer « rentré »", "jalon", `${v.id}|retour`);
  }

  // voyage fait : l'argent
  const f = factureDuVoyage(v), fr = retour ? factureDeCommande(retour) : null;
  if (!f) {
    if (!v.clientId) return A("client", "Choisir le client du voyage", "Sans client, le voyage ne peut pas être facturé.", "Modifier le voyage", "modifier", v.id);
    if (!num(v.prix)) return A("prix", "Renseigner le prix du voyage", "Sans prix, ni facture ni marge.", "Modifier le voyage", "modifier", v.id);
    return A("facturer", "Facturer le voyage", `${nomClient(v.clientId)} · ${fmt(v.prix, 0)} ${v.devise === "EUR" ? "€" : "MAD"}.`, "Facturer", "facturer-voyage", v.id);
  }
  if (f.statut !== "payee" && !f.envoi) return A("envoyer", `Envoyer la facture ${f.numero}`, `${nomClient(f.clientId)} · ${montant(f)}, avec le CMR signé et la preuve de livraison.`, "Envoyer", "fiche-envoyer-facture", f.id);
  if (retour && retour.statut === "livre" && !fr) return A("facturer_retour", "Facturer le retour", `${nomClient(retour.clientId)} · ${fmt(retour.prix, 0)} ${retour.devise === "EUR" ? "€" : "MAD"} · ${retour.ref || ""}.`, "Facturer le retour", "retour-facturer", v.id);
  if (fr && fr.id !== f.id && fr.statut !== "payee" && !fr.envoi) return A("envoyer", `Envoyer la facture ${fr.numero}`, `${nomClient(fr.clientId)} · ${montant(fr)} (retour).`, "Envoyer", "fiche-envoyer-facture", fr.id);
  const dues = [f, fr].filter((x, i, l) => x && x.statut !== "payee" && l.indexOf(x) === i).sort((a, b) => String(a.echeance).localeCompare(String(b.echeance)));
  if (dues.length) { const x = dues[0], e = etatFacture(x);
    return e.code === "retard" ? A("relancer", `Relancer ${x.numero}`, `${nomClient(x.clientId)} · ${montant(x)} · ${e.texte}.`, "Relancer", "fiche-relancer", x.id, { ton: "alerte", second: { bouton: "Encaissée", act: "fiche-encaisser", id: x.id } })
      : A("paiement", "En attente du paiement", `${x.numero} · ${nomClient(x.clientId)} · ${montant(x)} · ${e.texte.toLowerCase()}.`, "Marquer encaissée", "fiche-encaisser", x.id, { ton: "attente" }); }
  return { cle: "solde", titre: "Voyage soldé", detail: "Facturé et encaissé.", bouton: "", act: "", id: "", ton: "ok" };
}

/**
 * Documents du client à relancer, par sens : [{ sens, commande, e (état complet), liste, bloquants }].
 * Avant le chargement, tout ce qui manque ; ensuite seulement ce qui bloque en douane, jusqu'à la livraison.
 */
function documentsARelancer(v) {
  const r = [];
  for (const [sens, c] of [["aller", commandeAller(v)], ["retour", commandeRetour(v)]]) {
    if (!c || ["livre", "annule"].includes(c.statut)) continue;
    const e = etatDocuments(c), avant = ["devis", "confirme"].includes(c.statut), liste = e.bloquantsManquants.length ? e.bloquantsManquants : avant ? e.manquants : [];
    if (liste.length) r.push({ sens, commande: c, e, liste, bloquants: e.bloquantsManquants.length > 0 });
  }
  return r;
}
/** Ce qui demande un geste sans être l'action du moment : [{ cle, niveau, texte, bouton, act, id, onglet }] (4 au plus). */
function pointsAttention(v, maintenant = Date.now()) {
  if (!v || v.statut === "annule") return [];
  const p = [], auj = new Date(maintenant).toISOString().slice(0, 10), fait = (t) => !!jalonDe(v, t), principale = prochaineAction(v, maintenant)?.cle, actif = ["prevu", "en_cours"].includes(v.statut);
  const attente = actif ? evenementsPassage(v, maintenant).find((e) => e.type === "retard") : null;
  if (attente) p.push({ cle: "attente", niveau: attente.niveau, texte: attente.titre.replace(`${v.ref || ""} · `, "").replace(/^./, (c) => c.toUpperCase()), bouton: "", act: "", id: "", onglet: "suivi" });
  for (const d of documentsARelancer(v)) p.push({ cle: "documents", niveau: d.bloquants ? "warn" : "info", texte: `Documents ${d.sens === "aller" ? "de l'aller" : "du retour"} : ${d.bloquants ? `il manque ${d.liste[0].lib}${d.liste.length > 1 ? ` et ${d.liste.length - 1} autre${d.liste.length > 2 ? "s" : ""}` : ""}` : `${d.e.recus} sur ${d.e.total} reçus`}`, bouton: "Demander", act: "docs-voyage", id: d.commande.id, onglet: "documents" });
  if (actif) for (const sens of ["aller", "retour"]) { const t = traverseeDe(v, sens); if (t && t.statut === "a_reserver" && !fait(sens === "aller" ? "embarque_aller" : "embarque_retour") && (sens === "aller" || v.statut === "en_cours")) p.push({ cle: sens === "aller" ? "traversee" : "traversee_retour", niveau: "warn", texte: `Traversée ${sens} à réserver`, bouton: "Réserver", act: "trav", id: `${v.id}|${sens}`, onglet: "suivi" }); }
  if (chercheRetour(v) && (fait("livre") || joursEntre(auj, livraisonAller(v) || auj) <= 5)) { const pl = plancherRetour(v); p.push({ cle: "retour", niveau: "warn", texte: pl.couvert ? "Pas encore de chargement de retour" : `Pas de retour · prix plancher ${fmt(pl.eur)} €`, bouton: "Trouver", act: "retour-chercher", id: v.id, onglet: "suivi" }); }
  if (fait("livre") && !v.pod && v.statut === "en_cours") p.push({ cle: "preuve", niveau: "info", texte: "Preuve de livraison à faire signer", bouton: "Signer", act: "preuve", id: v.id, onglet: "documents" });
  const b = actif && typeof bateauVoyage === "function" ? bateauVoyage(v) : null; // bateau réservé trop juste pour l'arrivée estimée
  if (b && (b.niveau === "danger" || b.niveau === "warn")) p.unshift({ cle: "bateau", niveau: b.niveau, texte: b.niveau === "danger" ? `Bateau de ${heurePort(b.depart, b.fuseau)} : arrivée estimée trop tard de ${dureeTexte(-b.margeMin * 60000)}` : `Bateau de ${heurePort(b.depart, b.fuseau)} : arrivée juste (${dureeTexte(b.margeMin * 60000)} d'avance)`, bouton: "Traversée", act: "trav", id: `${v.id}|${b.sens}`, onglet: "suivi" });
  if (fait("livre") && v.statut === "en_cours" && v.clientId && num(v.prix) && !factureDuVoyage(v)) p.push({ cle: "facturer", niveau: "warn", texte: "Aller livré : à facturer", bouton: "Facturer", act: "facturer-voyage", id: v.id, onglet: "argent" });
  return p.filter((x) => x.cle !== principale).slice(0, 4);
}
