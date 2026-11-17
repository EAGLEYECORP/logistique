"use strict";
/* ============================================================
   Consigne de plein par pays (interface) :
   · fiche du voyage : où faire le plein et combien, économie estimée, « Envoyer au chauffeur » (WhatsApp) ; après coup, litres
     achetés en France d'après la carte carburant et surcoût par rapport à la consigne ;
   · mode chauffeur : la consigne sur la mission.
   Logique pure dans plein.js.
   ============================================================ */

const NOM_PAYS_PLEIN = { MA: "Maroc", ES: "Espagne", FR: "France" };
const prixAffiche = (p, a) => (a.pays === "MA" && p.prix.maMad ? `${fmt(p.prix.maMad, 2)} MAD/L` : `${fmt(a.prixL, 3)} €/L`);
function lignesConsigne(p) { return p.achats.map((a) => `<li><b>${NOM_PAYS_PLEIN[a.pays]}</b>, ${esc(a.lieu)} : <strong>${a.litres >= p.reservoir - 5 ? "plein complet" : `${fmt(a.litres)} L`}</strong> <span class="sub">${prixAffiche(p, a)}</span></li>`).join(""); }
function blocPleinVoyage(v) {
  if (["annule"].includes(v.statut)) return "";
  const p = planPlein(v); if (!p) return "";
  const e = ecartPlein(v, p), ch = parId(S.chauffeurs, v.chauffeurId), tel = ch && typeof telInternational === "function" ? telInternational(ch.tel) : "";
  return `<div class="section-title">Consigne de plein</div><div class="trav plein-voyage"><div><ol class="plein-liste">${lignesConsigne(p)}</ol>
      <span class="sub">${p.economieEuros ? `≈ ${fmt(p.economieEuros)} € d'économie par rapport à des pleins pris au fil de la route` : "Peu d'écart de prix sur ce trajet"} · ${fmt(p.conso, 1)} L/100, réservoir ${fmt(p.reservoir)} L${p.prixManquants ? " · prix du jour incomplets : valeurs de repli" : p.prix.date ? ` · prix du ${dateFr(p.prix.date)}` : ""}</span>
      ${e ? `<span class="sub ${e.surcoutEuros ? "plein-ecart" : ""}">Carte carburant : ${Object.entries(e.parPays).map(([k, l]) => `${NOM_PAYS_PLEIN[k] || k} ${fmt(l)} L`).join(" · ")}${e.surcoutEuros ? ` — ${fmt(e.reelFR - e.prevuFR)} L pris en France hors consigne, ≈ ${fmt(e.surcoutEuros)} € de plus` : " — consigne suivie"}</span>` : ""}</div>
    <div class="r">${tel ? `<a class="btn ghost sm" href="https://wa.me/${tel}?text=${encodeURIComponent(texteConsignePlein(v, p))}" target="_blank" rel="noopener">${ic("phone")}Envoyer au chauffeur</a>` : ""}</div></div>`;
}
if (typeof enregistrerBlocVoyage === "function") enregistrerBlocVoyage({ onglet: ongletArgentOuSuivi, ordre: 50, rendu: blocPleinVoyage });

/* ---------- mode chauffeur : la consigne de plein est en tête de l'écran (chauffeur_ui.js, « Ma route ») ---------- */

/* ---------- réglages ---------- */
enregistrerCarteReglages({
  onglet: "general", ordre: 41,
  rendu: () => `<div class="card" id="carte-plein"><div class="card-head"><h2>Consigne de plein</h2></div>
    <form id="f-plein"><div class="form-grid"><label class="f">Réservoir par défaut (litres, si le camion n'en a pas)<input type="number" name="reservoirL" min="100" step="10" value="${num(S.params.reservoirL, 700)}"></label></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form>
    <p class="hint">Sur chaque voyage vers l'Espagne ou la France : où faire le plein et combien, d'après les prix du jour (Maroc : vos pleins ; Espagne et France : prix officiels). Le gasoil des réservoirs d'origine entre dans l'Union en franchise ; pas de jerricans.</p></div>`,
  soumettre(fid, v) { if (fid !== "f-plein") return false; S.params.reservoirL = num(v.reservoirL, 700); sauver(); toast("Réservoir enregistré"); rafraichir(); return true; },
});
