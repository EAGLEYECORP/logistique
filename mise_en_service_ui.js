"use strict";
/* ============================================================
   Mise en service (interface) — logique dans mise_en_service.js.
   · Réglages → Général, en tête : chaque point branché ou manquant, ce qu'il débloque, et un bouton qui mène à l'endroit où
     le régler (la fiche du premier camion, chauffeur, client ou voyage incomplet s'ouvre directement) ; rien sur les points prêts ;
   · tableau de bord : un bandeau « x sur y prêts » avec la prochaine étape, tant que tout n'est pas prêt
     (« Plus tard » le cache 7 jours) ;
   · profil Direction seulement ; l'état du relais est relu (GET /api/etat) au plus toutes les 5 minutes.
   ============================================================ */

const CLE_MES_PLUS_TARD = "logistique-mes-plus-tard";
let mesRelais = { base: "", t: 0, statut: "", etat: null, erreur: "" };
let mesRelaisEnCours = null, mesPersistant; // protection contre l'effacement : inconnue tant que non vérifiée

const mesPermise = () => typeof roleLire !== "function" || roleLire().role === "direction";
/** Ce que la logique reçoit du relais (et lance la relecture si elle est ancienne). */
function relaisPourMes() {
  const r = typeof partageRelais === "function" ? partageRelais() : null;
  if (!r) return { configure: false };
  if (mesRelais.base !== r.base) mesRelais = { base: r.base, t: 0, statut: "", etat: null, erreur: "" };
  if (!mesRelaisEnCours && Date.now() - mesRelais.t > 5 * 60000) setTimeout(() => lireRelaisMes(), 0);
  return { configure: true, statut: mesRelais.statut || "verif", etat: mesRelais.etat, erreur: mesRelais.erreur };
}
async function lireRelaisMes() {
  if (mesRelaisEnCours) return mesRelaisEnCours;
  const r = typeof partageRelais === "function" ? partageRelais() : null; if (!r) return;
  mesRelaisEnCours = (async () => {
    try {
      const e = await partageAppel("GET", "/api/etat");
      mesRelais = { base: r.base, t: Date.now(), statut: "ok", etat: e, erreur: "" };
      if (typeof capacitesRelais !== "undefined") capacitesRelais = { t: Date.now(), canaux: e.notifications || [] };
    } catch (err) {
      const m = String(err?.message || "");
      mesRelais = { base: r.base, t: Date.now(), statut: /refus/i.test(m) ? "refuse" : "injoignable", etat: null, erreur: /injoignable/i.test(m) ? "" : m };
    } finally { mesRelaisEnCours = null; }
    majMiseEnService();
  })();
  return mesRelaisEnCours;
}
async function verifierAppareilMes() {
  const avant = mesPersistant;
  mesPersistant = typeof stockagePersistant === "function" ? await stockagePersistant() : false;
  if (avant !== mesPersistant) majMiseEnService();
}
function etatMesCourant() {
  if (mesPersistant === undefined) setTimeout(verifierAppareilMes, 0);
  return etatMiseEnService({ relais: relaisPourMes(), appareil: { persistant: mesPersistant } });
}

/* ---------- rendu ---------- */
const ICONES_MES = { ok: "check", partiel: "alert", a_faire: "alert", attente: "clock", info: "gauge" };
const pageMesPermise = (page) => typeof ongletPermis !== "function" || ongletPermis(page);
const boutonMes = (a, cls = "btn ghost sm") => (a && pageMesPermise(a.page) ? `<button type="button" class="${cls}" data-mes="${esc(JSON.stringify(a))}">${esc(a.lib)}</button>` : "");
const jaugeMes = (r) => `<div class="jauge-mes" role="progressbar" aria-valuemin="0" aria-valuemax="${r.total}" aria-valuenow="${r.prets}" aria-label="Points prêts"><i style="width:${r.total ? Math.round((r.prets / r.total) * 100) : 0}%"></i></div>`;
function ligneMes(x) {
  return `<li class="mes-item ${x.etat}"><span class="mes-icone" aria-hidden="true">${x.etat === "attente" ? '<span class="spinner"></span>' : ic(ICONES_MES[x.etat] || "alert")}</span>
    <div class="mes-texte"><strong>${esc(x.titre)}</strong><span class="sub" dir="auto">${esc(x.detail)}</span>${x.etat !== "ok" && x.valeur ? `<span class="mes-valeur" dir="auto">${esc(x.valeur)}</span>` : ""}</div>
    ${x.etat === "ok" ? "" : boutonMes(x.action)}</li>`;
}
function carteMiseEnService() {
  if (!mesPermise()) return "";
  const r = etatMesCourant();
  return `<div class="card" id="carte-mise-en-service"><div class="card-head"><h2>Mise en service</h2><span class="badge ${r.prets === r.total ? "ok" : "warn"}" dir="auto">${r.prets} sur ${r.total} prêts</span></div>
    <p class="hint" style="margin-top:0" dir="auto">Ce qui est branché, ce qui manque, et ce que chaque point débloque. Le bouton mène à l'endroit où le régler.</p>
    ${jaugeMes(r)}
    ${r.groupes.map((g) => `<div class="section-title">${esc(g.titre)}</div><ul class="mes-liste">${g.items.map(ligneMes).join("")}</ul>`).join("")}
    <div class="row" style="margin-top:8px">${btn("mes-verifier", "Vérifier à nouveau", { icone: "check", cls: "btn ghost sm" })}</div>
  </div>`;
}
const mesPlusTard = () => { try { return Date.now() - Number(localStorage.getItem(CLE_MES_PLUS_TARD) || 0) < 7 * 86400000; } catch { return false; } };
function bandeauMiseEnService() {
  if (!mesPermise() || mesPlusTard() || !(S.camions.length || S.chauffeurs.length)) return "";
  const r = etatMesCourant(), p = r.prochaine; if (!p) return "";
  return `<div class="card bandeau-mes" id="bandeau-mes"><div class="mes-tete">${ic("settings")}<div><strong dir="auto">Mise en service : ${r.prets} sur ${r.total} prêts</strong>
      <span class="sub" dir="auto">Prochaine étape : ${esc(p.titre)} — ${esc(p.detail)}</span></div></div>
    ${jaugeMes(r)}
    <div class="row">${boutonMes(p.action, "btn sm")}${boutonMes({ page: "parametres", onglet: "general", ancre: "carte-mise-en-service", lib: "Tout voir" })}<button type="button" class="btn ghost sm" data-mes-plus-tard>Plus tard</button></div></div>`;
}
/** Remet à jour la carte et le bandeau affichés (sans redessiner la page : un formulaire en cours reste intact). */
function majMiseEnService() {
  const c = document.getElementById("carte-mise-en-service"); if (c) c.outerHTML = carteMiseEnService() || "<div hidden></div>";
  const b = document.getElementById("bandeau-mes"); if (b) b.outerHTML = bandeauMiseEnService() || "<div hidden></div>";
}

/* ---------- aller régler ---------- */
async function allerMiseEnService(a) {
  if (a.act === "persister") {
    const ok = typeof stockageDemanderPersistance === "function" && (await stockageDemanderPersistance());
    toast(ok ? "Protection activée" : "Le navigateur n'a pas accordé la protection (installez l'application pour l'obtenir).", ok ? "ok" : "warn");
    mesPersistant = undefined; return verifierAppareilMes();
  }
  if (a.page === "parametres" && a.onglet && typeof ongletReglages !== "undefined") ongletReglages = a.onglet;
  if (ongletActif !== a.page || a.onglet) afficher(a.page);
  if (a.ancre) {
    const el = document.getElementById(a.ancre);
    if (el) { el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); el.classList.add("mes-surligne"); setTimeout(() => el.classList.remove("mes-surligne"), 1800); }
  }
  if (a.act && a.id && ongletActif === a.page) await VUES[a.page].agir(a.act, a.id);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest?.("[data-mes], [data-mes-plus-tard]"); if (!t || t.closest("dialog")) return;
  e.preventDefault();
  if (t.hasAttribute("data-mes-plus-tard")) {
    try { localStorage.setItem(CLE_MES_PLUS_TARD, String(Date.now())); } catch { /* ignoré */ }
    document.getElementById("bandeau-mes")?.remove(); toast("La mise en service reste dans Réglages → Général.");
    return;
  }
  let a = null; try { a = JSON.parse(t.dataset.mes); } catch { return; }
  allerMiseEnService(a);
});

enregistrerCarteReglages({
  onglet: "general", ordre: -10, rendu: carteMiseEnService,
  async agir(act) {
    if (act !== "mes-verifier") return false;
    mesRelais.t = 0; mesPersistant = undefined;
    await Promise.all([lireRelaisMes(), verifierAppareilMes()]); majMiseEnService(); toast("Mise en service vérifiée", "ok");
    return true;
  },
});
blocPage("tableau", { position: "avant", ordre: 5, rendu: bandeauMiseEnService });
