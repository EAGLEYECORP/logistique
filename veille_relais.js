"use strict";
/* ============================================================
   Veille par le relais — logique pure, testée. Le relais (serveur/veille.js) surveille jour et nuit, même quand personne
   n'a l'application ouverte : les coupures des chauffeurs (message avant la pause et la fin de journée, alerte au bureau si
   la pause est dépassée) et les passages aux quais (arrivée et départ sur les sites de chargement et de livraison).
   · listeVeille : ce que l'application lui confie — voyages en cours avec balise, moyen de prévenir le chauffeur (si le relais
     sait l'envoyer), sites des quais encore ouverts ;
   · appliquerQuaisRelais : les passages vus par le relais, posés comme les relevés GPS de l'application (jamais à la place
     d'une heure notée à la main).
   Interface et envoi : veille_relais_ui.js. Dépend de noyau.js, aller_retour.js, quais.js, quais_gps.js, coupures.js,
   jalons_notifications.js (destinataireNotif).
   ============================================================ */

/** Ce que le relais doit surveiller. caps : canaux que le relais sait envoyer (ntfy, email, whatsapp…). Résultat stable d'une minute à l'autre. */
function listeVeille(caps = [], maintenant = Date.now()) {
  const t = Math.floor(maintenant / 1000), jour = Math.floor(t / 86400) * 86400, voyages = [];
  const auto = S.params.alerteCoupureAuto !== false, equipe = S.params.alerteCoupureEquipe !== false;
  for (const v of S.voyages.filter((x) => x.statut === "en_cours")) {
    const balise = parId(S.camions, v.camionId)?.balise?.trim(); if (!balise) continue;
    const fin = v.dateRetourPrevue ? Date.parse(`${v.dateRetourPrevue}T00:00:00Z`) / 1000 + 3 * 86400 : NaN;
    const e = { id: v.id, reference: v.ref || v.id, balise, jusqua: Number.isFinite(fin) && fin > t ? Math.min(fin, jour + 15 * 86400) : jour + 10 * 86400 };
    if (auto || equipe) {
      const ch = parId(S.chauffeurs, v.chauffeurId), sem = compteursSemaine(ch ? S.conduiteJournal?.[ch.id] || {} : {}, dateLocale(t));
      e.coupures = { chauffeur: ch?.nom || "", langue: "fr", avantMin: num(S.params.alerteCoupureMin, 30), etendusSemaine: sem.joursEtendus, equipe };
      if (auto) { const d = destinataireNotif("chauffeur", "prefere", v); if (!d.manque && caps.includes(d.canal)) Object.assign(e.coupures, { canal: d.canal, destination: d.destination, langue: d.langue || "fr", ...(d.repli ? { repli: d.repli } : {}) }); }
    }
    const quais = [];
    for (const c of [commandeAller(v), commandeRetour(v)].filter(Boolean)) for (const [q] of QUAIS) {
      const x = quaiDe(c, q); if (x?.arrivee && x.depart) continue;
      const site = siteQuai(c, q, v); if (!site) continue;
      const debut = Date.parse(`${q === "chargement" ? c.dateChargement || v.dateDepart : v.dateDepart}T00:00:00Z`) / 1000 - 86400;
      quais.push({ cle: `${c.id}:${q}`, lat: site.lat, lon: site.lon, depuis: Number.isFinite(debut) ? debut : jour - 3 * 86400, arrivee: x?.arrivee ? Math.floor(Date.parse(x.arrivee) / 1000) : null });
    }
    if (quais.length) e.quais = quais;
    voyages.push(e);
  }
  let fuseau = ""; try { fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* inconnu : heure du serveur */ }
  return { fuseau, voyages };
}

/** Pose les passages aux quais vus par le relais ({ quais: { "o1:livraison": { arrivee, depart } } }). Renvoie les messages pour le fil. */
function appliquerQuaisRelais(lu) {
  const messages = [];
  for (const [cle, p] of Object.entries(lu?.quais || {})) {
    const i = cle.lastIndexOf(":"), c = parId(S.commandes, cle.slice(0, i)), q = cle.slice(i + 1);
    if (!c || !QUAIS.some(([k]) => k === q)) continue;
    const effets = appliquerPassageQuai(c, q, p); if (!effets.length) continue;
    const v = S.voyages.find((x) => x.commandeId === c.id || x.commandeRetourId === c.id);
    messages.push(`${v ? `${v.ref} · ` : ""}${c.ref} : ${effets.join(", ")} (GPS, vu par le relais)`);
  }
  return messages;
}
