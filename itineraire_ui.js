"use strict";
/* ============================================================
   Itinéraire poids lourd (interface) :
   · fiche du voyage → Suivi : tronçons routiers (la traversée du détroit à part), lien Google Maps de chaque tronçon,
     et, si le relais a un service d'itinéraire, kilomètres et durée réels, kilomètres par pays et à péage, appliqués au voyage
     (péages d'Europe, consigne de plein, coût au km) sans écraser une saisie ;
   · devis : l'itinéraire réel est calculé avant le prix conseillé, quand c'est possible ;
   · Réglages → Général → Itinéraire poids lourd : état, lignes à ajouter au relais, conditions du service.
   Logique pure dans itineraire.js ; appel au service par le relais (serveur/itineraire.js).
   ============================================================ */

let etatItineraireRelais = null; // { actif, source, calculsDuJour, quotaJour } d'après /api/etat
async function lireEtatItineraire() {
  if (!partageRelais()) return null;
  try { etatItineraireRelais = (await partageAppel("GET", "/api/etat")).itineraire || { actif: false }; } catch { /* relais injoignable */ }
  return etatItineraireRelais;
}
/** Calcule les tronçons par le relais : { it } ou { erreur }. */
async function calculerTroncons(x) {
  const t = tronconsRoute(x); if (t.erreur) return { erreur: t.erreur };
  const cam = x.camionId ? parId(S.camions, x.camionId) : null, camion = { poids: num(x.ptacT) || num(cam?.ptac) || 40, essieu: 11.5 };
  try { const res = []; for (const tr of t) res.push(await partageAppel("POST", "/api/itineraire", { points: tr.points, camion })); return { it: sommeTroncons(t, res) }; }
  catch (e) { return { erreur: e.message }; }
}
/** Itinéraire d'une commande, calculé une fois avant le devis (silencieux : sans service, l'estimation reste). */
async function itineraireCommande(c) {
  if (c.itineraire || !partageRelais()) return c.itineraire || null;
  if (etatItineraireRelais === null) await lireEtatItineraire();
  if (!etatItineraireRelais?.actif) return null;
  const r = await calculerTroncons(c); if (r.it) { c.itineraire = r.it; sauver(); }
  return c.itineraire || null;
}
const dureeRoute = (h) => { const m = Math.round(num(h) * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };

/* ---------- fiche du voyage ---------- */
function blocItineraire(v) {
  if (v.statut === "annule") return "";
  const t = tronconsRoute(v), it = v.itineraire, relais = !!partageRelais(), actif = !!etatItineraireRelais?.actif;
  if (t.erreur && !it) return `<div class="section-title">Itinéraire poids lourd</div><p class="hint" style="margin-top:0">${esc(t.erreur)}</p>`;
  const lignes = (Array.isArray(t) ? t : []).map((tr, i) => {
    const calc = it?.troncons?.[i];
    return `<div class="trav"><div><strong>${esc(tr.lib)}</strong><span class="sub">${calc ? `${fmt(calc.km)} km · ${dureeRoute(calc.heures)} de conduite` : `≈ ${fmt(kmEstimesTroncon(tr))} km (à vol d'oiseau × 1,25 : estimation)`}</span></div>
      <div class="r"><a class="btn ghost sm" href="${esc(lienGoogleMaps(tr.points))}" target="_blank" rel="noopener">${ic("route")}Google Maps</a></div></div>`; }).join("");
  const resume = it ? `<p class="hint itineraire-resume">${ic("check")}<span><strong>${fmt(it.km)} km de route, ${dureeRoute(it.heures)} de conduite</strong> (hors pauses, attentes aux ports et traversée) · ${Object.entries(it.kmPays || {}).sort((a, b) => b[1] - a[1]).map(([p, k]) => `${NOMS_PAYS_ROUTE[p] || p} ${fmt(k)} km`).join(", ")}${it.kmPeage ? ` · dont ${fmt(it.kmPeage)} km à péage` : ""}. Calculé le ${esc(dateHeureFr(it.calcule))} (${esc(it.source)}, données OpenStreetMap). ${v.kmAllerAuto ? "Kilomètres aller et par pays repris dans le voyage." : "Vos kilomètres saisis sont gardés."}</span></p>` : "";
  const bouton = relais && actif ? btn("itineraire-calculer", it ? "Recalculer" : "Calculer l'itinéraire réel", { id: v.id, icone: "route", cls: `btn ${it ? "ghost " : ""}sm` }) : "";
  const aide = !it && !actif ? `<p class="hint">Google Maps donne un itinéraire en voiture (sans restrictions poids lourd : hauteurs, tonnages et interdictions à vérifier). Pour les kilomètres réels d'un camion par pays, branchez un service d'itinéraire sur le relais (Réglages → Général → Itinéraire poids lourd).</p>` : "";
  return `<div class="section-title">Itinéraire poids lourd</div>${lignes}${resume}${bouton ? `<div class="row">${bouton}</div>` : ""}${aide}`;
}
enregistrerBlocVoyage({ onglet: "suivi", ordre: 35, rendu: blocItineraire });

surAction("voyages", "*", async function (act, id, b) {
  if (act !== "itineraire-calculer") return PASSER;
  const v = parId(S.voyages, id); if (!v) return;
  if (b) b.disabled = true;
  const r = await calculerTroncons(v);
  if (r.erreur) { if (b) b.disabled = false; return toast(r.erreur, "danger"); }
  const a = appliquerItineraire(v, r.it); voyagesOuverts.add(v.id);
  if (typeof recalculerMargeVoyage === "function") recalculerMargeVoyage(v.id);
  sauver(); toast(`Itinéraire : ${fmt(r.it.km)} km, ${dureeRoute(r.it.heures)} de conduite${a.kmPays === "rempli" ? " · péages d'Europe recalculés" : a.kmPays === "garde" ? " · vos km par pays sont gardés" : ""}`); rafraichir();
});

/* ---------- devis : l'itinéraire réel avant le prix conseillé ---------- */
if (typeof chiffrerCommande === "function") {
  const chiffrerAvantItineraire = chiffrerCommande;
  chiffrerCommande = async function (c) { try { await itineraireCommande(c); } catch { /* l'estimation reste */ } return chiffrerAvantItineraire(c); };
}

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 14,
  rendu: () => { const e = etatItineraireRelais;
    return `<div class="card" id="carte-itineraire"><div class="card-head"><h2>Itinéraire poids lourd</h2>${badge(e?.actif ? (e.source === "prive" ? "Serveur du relais" : "Service public") : partageRelais() ? "Non configuré" : "Relais non branché", e?.actif ? "ok" : "neutral")}</div>
    <p style="margin:0 0 8px">Kilomètres et durée réels d'un camion (gabarit, tonnage), par pays et à péage, calculés par le relais avec <strong>openrouteservice</strong> (données OpenStreetMap). Ils remplissent les péages d'Europe, la consigne de plein et le devis. Sans service, l'application garde l'estimation (à vol d'oiseau × 1,25) et propose les liens Google Maps.${e?.actif ? ` Aujourd'hui : ${e.calculsDuJour} calcul(s) sur ${e.quotaJour} au plus ; un trajet déjà calculé est repris sans nouvel appel pendant 60 jours.` : ""}</p>
    <pre class="bloc-code"># votre propre serveur openrouteservice (logiciel libre, gratuit) :
ITINERAIRE_URL=http://localhost:8080/ors
# ou le service public, avec une clé :
ITINERAIRE_CLE=votre-cle-openrouteservice</pre>
    <p class="hint"><strong>Conditions à vérifier</strong> : la formule gratuite du service public d'openrouteservice semble réservée à un usage non commercial (et limitée en nombre de calculs par jour) ; avant de l'utiliser pour votre entreprise, lisez ses conditions sur openrouteservice.org ou prenez leur formule payante. Votre propre serveur openrouteservice n'a pas cette limite mais demande une machine plus puissante (mémoire) et les cartes des pays traversés. Google Maps n'a pas de mode poids lourd.</p></div>`; },
  apres() { if (partageRelais() && etatItineraireRelais === null) lireEtatItineraire().then((e) => { if (e && ongletActif === "parametres") rafraichir(); }); },
});
/** Au démarrage : état du service d'itinéraire (pour montrer le bouton « Calculer » sur les fiches). */
function itineraireDemarrer() { if (partageRelais()) setTimeout(() => lireEtatItineraire().then((e) => { if (e?.actif && ongletActif === "voyages" && !document.querySelector("dialog[open]")) rafraichir(); }), 3000); }
