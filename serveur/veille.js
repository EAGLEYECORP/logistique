"use strict";
/* ============================================================
   Veille du relais (sans dépendance) : ce que l'application ne faisait que tant qu'elle était ouverte, le relais le fait
   jour et nuit avec les positions qu'il reçoit.
   · Coupures : avant la pause de 45 min et avant la fin de la conduite du jour, message au chauffeur (son canal, sa langue) ;
     pause dépassée de plus de 15 min en roulant : une alerte au bureau (canaux de l'équipe), une seule jusqu'à la pause.
     ESTIMATION d'après le GPS : le tachygraphe fait foi.
   · Quais : arrivée et départ sur les sites de chargement et de livraison, gardés jusqu'à ce que l'application les reprenne
     (elle les pose comme ses propres relevés GPS, sans jamais remplacer une heure notée à la main).
   L'application envoie ce qu'il faut surveiller (PUT /api/veille) ; le relais ne connaît rien d'autre de ses données.
   Calculs : ceux de l'application (coupures.js, quais_gps.js), chargés par moteur.js.
   ============================================================ */
const path = require("path");

const SIGNAL_RECENT_S = 20 * 60;      // au-delà, la position est trop ancienne pour prévenir qui que ce soit
const DEPASSEMENT_EQUIPE_MIN = 15;    // pause dépassée de tant de minutes en roulant : le bureau est prévenu
const SERIE_MAX_H = 4.5;              // conduite avant la pause de 45 min (REGLES_CONDUITE.serieH de coupures.js)
const GARDE_S = 7 * 86400;            // messages envoyés et passages aux quais gardés 7 jours
const LANGUES = ["fr", "ar", "es", "en"];

function creerVeille({ dossier = null, coffre = null, moteur, historique, envoyer, alerterEquipe, valider, quota = () => true }) {
  let etat = { fuseau: "", voyages: [], envoyes: {}, quais: {}, maj: 0 };
  const fichier = () => path.join(dossier, "veille.json");
  if (dossier && coffre) { try { etat = { ...etat, ...JSON.parse(coffre.lireTexte(fichier())) }; } catch { /* rien à reprendre */ } }
  const sauver = () => { if (dossier && coffre) { try { coffre.ecrire(fichier(), JSON.stringify(etat)); } catch { /* garde en mémoire */ } } };
  const nombre = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  const texte = (x, max = 80) => String(x ?? "").slice(0, max).trim();
  const borne = (x, min, max, d) => { const n = nombre(x); return n === null ? d : Math.max(min, Math.min(max, n)); };
  const fuseauValide = (f) => { if (!f || typeof f !== "string" || f.length > 64) return false; try { new Intl.DateTimeFormat("fr-FR", { timeZone: f }); return true; } catch { return false; } };
  const duree = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };

  /** Remplace la liste à surveiller (envoyée par l'application). Renvoie { ok, voyages, refus } ou { erreur }. */
  function remplacer(b, maintenant = Date.now()) {
    if (!b || !Array.isArray(b.voyages) || b.voyages.length > 200) return { erreur: "voyages : liste de 200 au plus." };
    const t = Math.floor(maintenant / 1000), voyages = [], refus = [];
    for (const x of b.voyages) {
      const id = texte(x?.id, 60), balise = texte(x?.balise, 64);
      if (!id || !balise) { refus.push({ id, raison: "identifiant et balise obligatoires" }); continue; }
      const jusqua = Math.min(borne(x.jusqua, 0, Infinity, t + 10 * 86400), t + 15 * 86400); if (jusqua <= t) continue;
      const v = { id, balise, reference: texte(x.reference) || id, jusqua };
      if (x.coupures && typeof x.coupures === "object") {
        const c = x.coupures, langue = LANGUES.includes(c.langue) ? c.langue : "fr";
        v.coupures = { chauffeur: texte(c.chauffeur), langue, avantMin: borne(c.avantMin, 5, 120, 30), etendusSemaine: Math.round(borne(c.etendusSemaine, 0, 7, 0)), equipe: c.equipe !== false, message: null };
        if (c.canal) { const ok = valider({ id: `coupure:${id}`, canal: c.canal, destination: c.destination, repli: c.repli, texte: "-" }); if (ok.refus) refus.push({ id, raison: `chauffeur : ${ok.refus}` }); else v.coupures.message = { canal: ok.message.canal, destination: ok.message.destination, ...(ok.message.repli ? { repli: ok.message.repli } : {}) }; }
      }
      if (Array.isArray(x.quais)) {
        const quais = x.quais.slice(0, 8).map((q) => ({ cle: texte(q?.cle, 100), lat: nombre(q?.lat), lon: nombre(q?.lon), depuis: borne(q?.depuis, 0, Infinity, t - 3 * 86400), arrivee: nombre(q?.arrivee) }))
          .filter((q) => q.cle && q.lat !== null && q.lon !== null && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180);
        if (quais.length) v.quais = quais;
      }
      voyages.push(v);
    }
    etat.voyages = voyages; etat.fuseau = fuseauValide(b.fuseau) ? b.fuseau : ""; etat.maj = t;
    sauver();
    return { ok: true, voyages: voyages.length, coupures: voyages.filter((v) => v.coupures?.message).length, quais: voyages.reduce((n, v) => n + (v.quais?.length || 0), 0), refus };
  }

  /** Une vérification (chaque minute) : passages aux quais, messages avant la coupure, alerte au bureau. Renvoie le journal de ce qui a été fait. */
  async function verifier(maintenant = Date.now()) {
    if (!moteur?.disponible) return [];
    const t = Math.floor(maintenant / 1000), journal = []; let change = false;
    const avant = etat.voyages.length; etat.voyages = etat.voyages.filter((v) => v.jusqua > t); if (etat.voyages.length !== avant) change = true;
    for (const v of etat.voyages) {
      const liste = historique.get(v.balise) || [], pts = (depuis) => liste.filter((p) => p.t >= depuis).map((p) => [p.t, p.lat, p.lon, p.v ?? null]);
      // quais : arrivée puis départ (le départ est cherché après l'arrivée connue, notée à la main ou vue par le relais)
      for (const q of v.quais || []) {
        const d = etat.quais[q.cle] || {}; if (d.arrivee && d.depart) continue;
        const debut = (d.arrivee || q.arrivee || 0) ? (d.arrivee || q.arrivee) - 600 : q.depuis, r = moteur.appeler("passageSite", pts(debut), { lat: q.lat, lon: q.lon }, { depuis: debut });
        const arrivee = d.arrivee || r?.arrivee || null, depart = r?.depart && arrivee && r.depart > arrivee ? r.depart : null;
        if (arrivee !== (d.arrivee || null) || depart !== (d.depart || null)) { etat.quais[q.cle] = { voyageId: v.id, arrivee, depart, t }; change = true; journal.push({ quai: q.cle, arrivee, depart }); }
      }
      // coupures
      const c = v.coupures, p = pts(t - 30 * 3600), der = p[p.length - 1];
      if (!c || p.length < 2 || t - der[0] > SIGNAL_RECENT_S) continue;
      const r = moteur.appeler("prochainesCoupures", p, t, { etendusSemaine: c.etendusSemaine }); if (!r) continue;
      // un message par pause et par journée : réarmé seulement quand la pause est faite (série remise à zéro) ou après le repos de la nuit
      const cleDepasse = `${v.id}:depasse`, rearme = { pause: r.serieH < 1, finJour: r.jourH < 1, depasse: !r.pause.depasse };
      for (const k of ["pause", "finJour", "depasse"]) if (rearme[k] && etat.envoyes[`${v.id}:${k}`]) { delete etat.envoyes[`${v.id}:${k}`]; change = true; }
      if (r.enArret) continue;
      if (c.message) for (const type of ["pause", "finJour"]) {
        const b = r[type]; if (b.depasse || b.dansMin > c.avantMin || b.dansMin <= 0) continue;
        const cle = `${v.id}:${type}`; if (etat.envoyes[cle]) continue;
        if (!quota(maintenant)) break;
        etat.envoyes[cle] = t; change = true;
        const lien = moteur.appeler("lienAiresPL", [der[1], der[2]]), message = moteur.appeler("messageCoupure", type, b.dansMin, b.heure, c.langue, lien, etat.fuseau);
        const res = await envoyer({ id: `coupure:${cle}`, cle: `coupure:${cle}`, ...c.message, sujet: `${v.reference} — ${type === "pause" ? "pause" : "fin de journée"}`, texte: message, voyageId: v.id });
        journal.push({ coupure: cle, type, statut: res.envoyes.length ? "envoye" : "erreur", envoyes: res.envoyes, erreurs: res.erreurs });
      }
      if (c.equipe && r.pause.depasse && (r.serieH - SERIE_MAX_H) * 60 >= DEPASSEMENT_EQUIPE_MIN && !etat.envoyes[cleDepasse]) {
        etat.envoyes[cleDepasse] = t; change = true;
        const message = `${v.reference}${c.chauffeur ? ` · ${c.chauffeur}` : ""} : ${duree(r.serieH)} de conduite sans pause de 45 min (estimation GPS, le tachygraphe fait foi).`;
        const res = await alerterEquipe({ texte: message, niveau: "danger", cle: `coupure:${cleDepasse}:${t}` });
        journal.push({ coupure: cleDepasse, type: "depasse", statut: res.envoyes.length ? "envoye" : "erreur", envoyes: res.envoyes, erreurs: res.erreurs });
      }
    }
    for (const [k, x] of Object.entries(etat.envoyes)) if (t - x > GARDE_S) { delete etat.envoyes[k]; change = true; }
    for (const [k, x] of Object.entries(etat.quais)) if (t - x.t > GARDE_S) { delete etat.quais[k]; change = true; }
    if (change) sauver();
    return journal;
  }

  /** Ce que l'application relit : passages aux quais vus par le relais, messages de coupure déjà envoyés. */
  const lire = () => ({ maj: etat.maj, fuseau: etat.fuseau, voyages: etat.voyages.map((v) => ({ id: v.id, balise: v.balise, coupures: !!v.coupures?.message, equipe: !!v.coupures?.equipe, quais: (v.quais || []).length })), quais: etat.quais, envoyes: etat.envoyes });
  const resume = () => ({ voyages: etat.voyages.length, maj: etat.maj });
  return { remplacer, verifier, lire, resume };
}

module.exports = { creerVeille, DEPASSEMENT_EQUIPE_MIN };
