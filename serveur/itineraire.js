"use strict";
/* ============================================================
   Itinéraire poids lourd par le relais, sans dépendance : appel d'un serveur openrouteservice (profil « driving-hgv »).
   · votre propre serveur openrouteservice (logiciel libre) : ITINERAIRE_URL=http://… ;
   · ou le service public (https://api.openrouteservice.org) avec une clé : ITINERAIRE_CLE=… — ses conditions sont à vérifier
     avant un usage par une entreprise (la formule gratuite semble réservée à un usage non commercial).
   Renvoie kilomètres, durée, kilomètres par pays et kilomètres à péage ; les ferries sont évités (la traversée du détroit est comptée à part).
   Résultats gardés 60 jours (mêmes points, même camion) et quota quotidien pour rester sous les limites du service.
   ============================================================ */
const path = require("path");

/** Identifiants de pays d'openrouteservice → codes ISO (liste « Country IDs » de sa documentation). */
const PAYS_ORS = { 4: "AD", 11: "AT", 17: "BE", 52: "CZ", 53: "DK", 70: "FR", 74: "DE", 75: "DE", 77: "GI", 88: "HU", 97: "IT", 117: "LU", 134: "MA", 141: "NL", 159: "PL", 160: "PT", 180: "SI", 187: "ES", 193: "CH", 200: "NL", 213: "GB" };
const rad = (x) => (x * Math.PI) / 180;
const metres = (a, b) => { const R = 6371000, dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/** Réponse GeoJSON d'openrouteservice → { km, heures, kmPays: { MA: …, ES: … }, kmPeage }. */
function lireReponse(j) {
  const f = j?.features?.[0]; if (!f) throw new Error("Aucun itinéraire trouvé entre ces points.");
  const s = f.properties?.summary || {}, coords = f.geometry?.coordinates || [], extras = f.properties?.extras || {};
  const parValeur = (x) => { // { valeur: mètres } : résumé du service, sinon recalcul sur le tracé
    const r = {};
    if (Array.isArray(x?.summary) && x.summary.length) for (const e of x.summary) r[e.value] = (r[e.value] || 0) + Number(e.distance || 0);
    else for (const [i, k, v] of x?.values || []) { let m = 0; for (let n = i; n < k && n + 1 < coords.length; n++) m += metres(coords[n], coords[n + 1]); r[v] = (r[v] || 0) + m; }
    return r;
  };
  const kmPays = {}, pays = parValeur(extras.countryinfo);
  for (const [id, m] of Object.entries(pays)) { const iso = PAYS_ORS[id] || `#${id}`; kmPays[iso] = Math.round((kmPays[iso] || 0) + m / 1000); }
  const peage = parValeur(extras.tollways);
  return { km: Math.round(Number(s.distance || 0) / 1000), heures: Math.round((Number(s.duration || 0) / 3600) * 10) / 10, kmPays, kmPeage: Math.round((peage[1] || 0) / 1000) };
}

/** Service d'itinéraire du relais : calculer({ points: [[lat, lon], …], camion }) avec cache et quota. */
function creerItineraire({ url = "", cle = "", quotaJour = 1500, http_ = (...a) => fetch(...a), dossier = null, coffre = null, maintenant = () => Date.now() } = {}) {
  const actif = !!(url || cle), base = String(url || "https://api.openrouteservice.org").replace(/\/+$/, "");
  const cache = new Map(), fichier = dossier ? path.join(dossier, "itineraires.json") : null; let quota = { jour: "", n: 0 };
  if (fichier && coffre) { try { const d = JSON.parse(coffre.lireTexte(fichier)); for (const [k, v] of d.cache || []) cache.set(k, v); quota = d.quota || quota; } catch { /* aucun cache */ } }
  const sauver = () => { if (fichier && coffre) { try { coffre.ecrire(fichier, JSON.stringify({ cache: [...cache.entries()].slice(-2000), quota })); } catch { /* en mémoire */ } } };
  async function calculer({ points, camion = {} }) {
    if (!actif) { const e = new Error("Itinéraire poids lourd non configuré sur le relais (ITINERAIRE_URL ou ITINERAIRE_CLE)."); e.code = 503; throw e; }
    const pts = (Array.isArray(points) ? points : []).map((p) => [Number(p?.[0]), Number(p?.[1])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180);
    if (pts.length < 2 || pts.length > 10) { const e = new Error("De 2 à 10 points (latitude, longitude)."); e.code = 400; throw e; }
    const c = { weight: Math.min(60, Number(camion.poids) || 40), height: Math.min(5, Number(camion.hauteur) || 4), length: Math.min(25, Number(camion.longueur) || 16.5), width: Math.min(3, Number(camion.largeur) || 2.55), axleload: Math.min(20, Number(camion.essieu) || 11.5) };
    const cle_ = JSON.stringify([pts.map(([a, b]) => [a.toFixed(3), b.toFixed(3)]), c]), deja = cache.get(cle_);
    if (deja && maintenant() - deja.t < 60 * 86400000) return { ...deja.r, cache: true };
    const jour = new Date(maintenant()).toISOString().slice(0, 10); if (quota.jour !== jour) quota = { jour, n: 0 };
    if (quota.n >= quotaJour) { const e = new Error(`Quota du jour atteint (${quotaJour} calculs) : réessayez demain.`); e.code = 429; throw e; }
    quota.n++;
    let r;
    try { r = await http_(`${base}/v2/directions/driving-hgv/geojson`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/geo+json, application/json", ...(cle ? { Authorization: cle } : {}) },
      body: JSON.stringify({ coordinates: pts.map(([a, b]) => [b, a]), extra_info: ["countryinfo", "tollways"], instructions: false, options: { avoid_features: ["ferries"], vehicle_type: "hgv", profile_params: { restrictions: c } } }) }); }
    catch (e) { const x = new Error(`Service d'itinéraire injoignable : ${e.cause?.code || e.message}`); x.code = 502; throw x; }
    if (!r.ok) { let m = ""; try { const j = await r.json(); m = j?.error?.message || j?.error || ""; } catch { /* corps illisible */ } const x = new Error(r.status === 401 || r.status === 403 ? `Clé refusée ou quota du service atteint (réponse ${r.status}).` : `Service d'itinéraire : réponse ${r.status}${m ? ` (${String(m).slice(0, 160)})` : ""}.`); x.code = 502; throw x; }
    const res = { ...lireReponse(await r.json()), source: url ? "serveur openrouteservice du relais" : "openrouteservice (service public)", calcule: new Date(maintenant()).toISOString() };
    cache.set(cle_, { t: maintenant(), r: res }); sauver();
    return res;
  }
  return { actif, calculer, etat: () => ({ actif, source: actif ? (url ? "prive" : "public") : "", calculsDuJour: quota.jour === new Date(maintenant()).toISOString().slice(0, 10) ? quota.n : 0, quotaJour }) };
}

module.exports = { creerItineraire, lireReponse, PAYS_ORS };
