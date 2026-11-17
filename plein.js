"use strict";
/* ============================================================
   Consigne de plein par pays — logique pure, testée.
   · le trajet d'un voyage découpé par pays : Maroc jusqu'à Tanger Med, Espagne d'Algeciras à la frontière (La Jonquera ou Irun),
     France jusqu'à la livraison, puis le retour dans l'autre sens ;
   · prix du jour : Maroc d'après vos pleins (MAD/L), Espagne et France officiels (€/L) ;
   · règle des stations : à chaque arrêt, si un pays moins cher est à portée, ne prendre que de quoi l'atteindre (plus la réserve),
     sinon faire le plein (ou juste de quoi finir le voyage) ;
   · économie par rapport à des pleins pris au fil de la route, dans chaque pays traversé ;
   · après coup : litres réellement achetés par pays (carte carburant) comparés à la consigne.
   Le gasoil des réservoirs d'origine d'un véhicule utilitaire entre dans l'Union en franchise (directive 2003/96/CE, art. 24) ; pas de jerricans.
   Dépend de noyau.js, gps.js, fret_retour.js (coordsVille, kmEntre), aller_retour.js.
   ============================================================ */

const FRONTIERE_EST = { nom: "La Jonquera / Le Perthus", c: [42.4196, 2.875] }, FRONTIERE_OUEST = { nom: "Irun / Hendaye", c: [43.3381, -1.7889] };
const ALGECIRAS_C = [36.1408, -5.4562], TANGERMED_C = [35.889, -5.5], DETOUR_PLEIN = 1.25, KM_MAROC_APRES_PORT = 40;
/** Découpage du trajet aller : { kmMA, kmES, kmFR, frontiere, paysDest } ; null si le voyage ne va pas en Espagne ou en France. */
function trajetParPays(v) {
  const aller = typeof commandeAller === "function" ? commandeAller(v) : null, d = coordsVille(v.destination), o = coordsVille(v.origine);
  if (!d) return null;
  const pays = aller?.paysDest || (d[1] > -1.8 && d[0] > 42.5 ? "France" : d[0] > 36 ? "Espagne" : "Maroc");
  if (!["Espagne", "France"].includes(pays)) return null;
  const it = typeof kmPleinItineraire === "function" ? kmPleinItineraire(v) : null; // itinéraire poids lourd calculé : kilomètres réels par pays
  if (it) return { ...it, frontiere: it.kmFR ? (d[1] < 0.5 ? FRONTIERE_OUEST : FRONTIERE_EST).nom : null, paysDest: it.kmFR ? "France" : pays, source: "itineraire" };
  const kmMA = o ? Math.round(kmEntre(o, TANGERMED_C) * DETOUR_PLEIN) : 0;
  if (pays === "Espagne") return { kmMA, kmES: Math.round(kmEntre(ALGECIRAS_C, d) * DETOUR_PLEIN), kmFR: 0, frontiere: null, paysDest: pays };
  const f = d[1] < 0.5 ? FRONTIERE_OUEST : FRONTIERE_EST;
  return { kmMA, kmES: Math.round(kmEntre(ALGECIRAS_C, f.c) * DETOUR_PLEIN), kmFR: Math.round(kmEntre(f.c, d) * DETOUR_PLEIN), frontiere: f.nom, paysDest: pays };
}
/** Prix du jour en €/L par pays : { MA, ES, FR, date, complet }. */
function prixPleinParPays() {
  const j = S.params?.prixGasoilJour || {}, taux = num(S.params?.tauxEUR, 10.9), ma = num(j.MA?.prix, num(S.params?.prixGasoil, 0));
  const r = { MA: ma > 0 ? ma / taux : null, ES: num(j.ES?.algeciras || j.ES?.prix) || null, FR: num(j.FR?.pyreneesOrientales || j.FR?.poidsLourds || j.FR?.prix) || null, maMad: ma || null, date: j.maj ? new Date(j.maj).toISOString().slice(0, 10) : "" };
  r.complet = !!(r.MA && r.ES && r.FR); return r;
}
/** Points d'arrêt possibles, dans l'ordre : [{ lieu, pays, km (depuis le point précédent) }]. */
function arretsPlein(t) {
  const p = [{ lieu: "avant Tanger Med", pays: "MA", km: 0 }, { lieu: "Algeciras", pays: "ES", km: KM_MAROC_APRES_PORT }];
  if (t.paysDest === "Espagne") return [...p, { lieu: "à la livraison", pays: "ES", km: t.kmES }, { lieu: "avant Algeciras (retour)", pays: "ES", km: t.kmES }, { lieu: "après Tanger Med (retour)", pays: "MA", km: KM_MAROC_APRES_PORT, fin: true }];
  return [...p, { lieu: `avant la frontière (${t.frontiere})`, pays: "ES", km: t.kmES }, { lieu: "après la frontière", pays: "FR", km: 5 }, { lieu: "à la livraison", pays: "FR", km: t.kmFR },
    { lieu: `avant la frontière (retour)`, pays: "FR", km: t.kmFR }, { lieu: "après la frontière (retour)", pays: "ES", km: 5 }, { lieu: "avant Algeciras (retour)", pays: "ES", km: t.kmES }, { lieu: "après Tanger Med (retour)", pays: "MA", km: KM_MAROC_APRES_PORT, fin: true }];
}
/**
 * Consigne de plein d'un voyage : { trajet, conso, reservoir, achats: [{ lieu, pays, litres, prixL, euros }], totalEuros, baseEuros, economieEuros, prix } ; null si non concerné.
 * Règle : à chaque arrêt, on ne prend que de quoi atteindre le prochain arrêt à portée qui n'est pas plus cher (on y reprendra) ; sinon plein (ou de quoi finir). Réserve : 10 % du réservoir.
 */
function planPlein(v) {
  const t = trajetParPays(v); if (!t) return null;
  const cam = parId(S.camions, v.camionId), conso = (cam && typeof consoMoyenne === "function" && consoMoyenne(cam.id)) || num(S.params?.consoDefaut, 33);
  const reservoir = num(cam?.reservoirL, num(S.params?.reservoirL, 700)), reserve = reservoir * 0.1, L = (km) => (km * conso) / 100, prix = prixPleinParPays();
  const pL = (pays) => prix[pays] ?? (pays === "MA" ? 1.15 : pays === "ES" ? 1.9 : 2.1); // valeurs de repli si un prix manque (signalé)
  const arrets = arretsPlein(t), cumul = []; let s = 0; for (const a of arrets) { s += a.km; cumul.push(s); }
  const achats = []; let carb = 0;
  for (let i = 0; i < arrets.length - 1; i++) {
    if (i > 0) carb -= L(arrets[i].km);
    const ici = pL(arrets[i].pays), portee = (reservoir - reserve) * 100 / conso;
    const aPortee = (k) => k > i && cumul[k] - cumul[i] <= portee;
    let j = arrets.findIndex((a, k) => aPortee(k) && pL(a.pays) < ici - 1e-9); // un pays moins cher à portée (le Maroc au retour compris) : juste de quoi l'atteindre
    if (j < 0) j = arrets.findIndex((a, k) => aPortee(k) && !a.fin && pL(a.pays) <= ici + 1e-9); // sinon un arrêt au même prix plus loin : on y reprendra
    const besoin = j >= 0 ? L(cumul[j] - cumul[i]) + reserve : Math.min(reservoir, L(cumul[arrets.length - 1] - cumul[i]) + reserve);
    const litres = Math.max(0, Math.min(reservoir - carb, besoin - carb));
    if (litres > 0.5) { achats.push({ lieu: arrets[i].lieu, pays: arrets[i].pays, litres: Math.round(litres), prixL: ici, euros: Math.round(litres * ici) }); carb += litres; }
  }
  // repère : on remplit au fil de la route, dans le pays où l'on roule (chaque tronçon payé au prix de son pays)
  let base = 0; for (let k = 1; k < arrets.length; k++) base += L(arrets[k].km) * pL(arrets[k - 1].pays === arrets[k].pays ? arrets[k].pays : arrets[k - 1].pays);
  const totalEuros = achats.reduce((a, x) => a + x.euros, 0);
  return { trajet: t, conso, reservoir, achats, totalEuros, baseEuros: Math.round(base), economieEuros: Math.max(0, Math.round(base - totalEuros)), prix, prixManquants: !prix.complet };
}
/** Texte de la consigne pour le chauffeur. */
function texteConsignePlein(v, p = planPlein(v)) {
  if (!p) return "";
  const nom = { MA: "Maroc", ES: "Espagne", FR: "France" }, unite = (a) => (a.pays === "MA" && p.prix.maMad ? `${fmt(p.prix.maMad, 2)} MAD/L` : `${fmt(a.prixL, 3)} €/L`);
  return `Consigne de plein — ${v.ref} (${v.origine} → ${v.destination})\n${p.achats.map((a, i) => `${i + 1}. ${nom[a.pays]}, ${a.lieu} : ${a.litres >= p.reservoir - 5 ? "plein complet" : `${fmt(a.litres)} L`} (${unite(a)})`).join("\n")}\nNe pas faire le plein en France sauf indication. Réservoirs d'origine seulement, pas de jerricans.`;
}
/** Après coup : litres achetés par pays d'après les lignes carburant du voyage, et surcoût en France par rapport à la consigne. */
function ecartPlein(v, p = planPlein(v)) {
  const lignes = (v.lignesCout || []).filter((l) => l.type === "carburant" && num(l.litres) > 0);
  if (!p || !lignes.length) return null;
  const parPays = {}; for (const l of lignes) { const k = l.pays || (l.devise === "MAD" ? "MA" : "?"); parPays[k] = (parPays[k] || 0) + num(l.litres); }
  const prevuFR = p.achats.filter((a) => a.pays === "FR").reduce((s, a) => s + a.litres, 0), reelFR = parPays.FR || 0, ecart = p.prix.FR && p.prix.ES ? p.prix.FR - p.prix.ES : 0;
  return { parPays, prevuFR, reelFR, surcoutEuros: Math.max(0, Math.round((reelFR - prevuFR) * ecart)) };
}
