"use strict";
/* ============================================================
   Profil de l'appareil : chaque poste ne montre que ce qui sert à son rôle
   (direction, exploitation, commercial, comptabilité ; le mode chauffeur existe à part).
   Sans relais multi-utilisateur, c'est un tri de l'affichage protégé par un code. Avec un relais MULTI_UTILISATEUR=true (comptes_ui.js),
   le profil suit le rôle du compte et les droits sont appliqués par le serveur : ce qu'un rôle ne doit pas voir n'arrive pas sur l'appareil.
   ============================================================ */

const CLE_ROLE = "logistique-role";
const ROLES = {
  direction: { lib: "Direction", detail: "Tout voir et tout régler", onglets: null, finances: true },
  exploitation: { lib: "Exploitation", detail: "Suivi, voyages, flotte, chauffeurs, douane — sans les prix ni les marges", finances: false,
    onglets: ["tableau", "operations", "planning", "commandes", "direct", "voyages", "gps", "itineraires", "douane", "passages", "international", "peages", "camions", "chauffeurs", "tachy", "carburant", "nomenclature"] },
  commercial: { lib: "Commercial", detail: "Commandes, clients, factures, voyages et suivi", finances: true, onglets: ["tableau", "commandes", "clients", "factures", "direct", "voyages", "planning", "nomenclature"] },
  comptabilite: { lib: "Comptabilité", detail: "Factures, clients, rentabilité, gasoil, péages", finances: true, onglets: ["tableau", "factures", "clients", "direction", "rentabilite", "commandes", "voyages", "carburant", "peages"] },
  // profils des comptes du mode multi-utilisateur (non proposés comme profil d'appareil)
  exploitant: { lib: "Exploitant", detail: "Toute l'exploitation, prix et marges compris", finances: true, compte: true, onglets: ["tableau", "operations", "planning", "commandes", "direct", "voyages", "gps", "itineraires", "douane", "passages", "international", "peages", "camions", "chauffeurs", "tachy", "carburant", "clients", "factures", "direction", "rentabilite", "nomenclature"] },
  chauffeur: { lib: "Chauffeur", detail: "Ses voyages", finances: false, compte: true, onglets: ["chauffeur"] },
  transitaire: { lib: "Transitaire", detail: "Ses dossiers de douane et voyages", finances: false, compte: true, onglets: ["douane", "passages", "voyages", "nomenclature"] },
};
const ONGLETS_TOUS = ONGLETS.map((o) => o.slice());
const roleLire = () => { if (typeof roleMulti === "function" && roleMulti()) return { role: PROFIL_DU_ROLE[roleMulti()] || "exploitation", verrou: null, compte: true }; try { const r = JSON.parse(localStorage.getItem(CLE_ROLE) || "{}"); return { role: ROLES[r.role] ? r.role : "direction", verrou: r.verrou || null }; } catch { return { role: "direction", verrou: null }; } };
const roleEcrire = (r) => { try { localStorage.setItem(CLE_ROLE, JSON.stringify(r)); } catch { /* ignoré */ } };
/** Profil courant ; sur un appareil seul, la direction peut changer les pages et l'affichage des prix de chaque profil (S.params.pagesProfils). */
const roleCourant = () => {
  const l = roleLire(), b = ROLES[l.role], p = !l.compte && !b.compte && l.role !== "direction" ? S.params?.pagesProfils?.[l.role] : null;
  return p ? { ...b, onglets: Array.isArray(p.onglets) ? p.onglets : b.onglets, finances: typeof p.finances === "boolean" ? p.finances : b.finances } : b;
};
const PAGES_NON_REGLABLES = ["tableau", "parametres", "chauffeur", "utilisateurs", "acces", "journal"];
const ongletPermis = (id) => { if (typeof comptesOngletPermis === "function") { const x = comptesOngletPermis(id); if (x !== undefined) return x; } const r = roleCourant(); return !r.onglets || r.onglets.includes(id) || id === "parametres" || id === "chauffeur"; };

function roleAppliquer() {
  ONGLETS.length = 0; ONGLETS.push(...ONGLETS_TOUS.filter((o) => ongletPermis(o[0])));
  document.body.dataset.role = roleLire().role;
  document.body.classList.toggle("sans-finances", !roleCourant().finances);
}
// Toute navigation (menu, lien direct, recherche) vers une page hors du profil revient à l'accueil.
const afficherSansProfil = afficher;
afficher = function (onglet = ongletActif, options) { return afficherSansProfil(ongletPermis(onglet) ? onglet : "tableau", options); };

const essaisProfil = { n: 0, jusqua: 0 };
async function demanderCodeProfil() {
  const r = roleLire(); if (!r.verrou) return true;
  if (Date.now() < essaisProfil.jusqua) { toast("Trop d'essais : patientez une minute.", "warn"); return false; }
  const f = await formulaire("Code du profil", [{ name: "code", label: "Code (ou code de secours)", type: "password", required: true, autocomplete: "off" }], { valider: "Déverrouiller" });
  if (!f) return false;
  if (await verrouVerifier(r.verrou, f.code)) { essaisProfil.n = 0; return true; }
  if (++essaisProfil.n >= 5) { essaisProfil.n = 0; essaisProfil.jusqua = Date.now() + 60000; }
  toast("Code incorrect.", "danger"); return false;
}
function carteProfil() {
  if (typeof multiActif === "function" && multiActif()) return ""; // remplacé par « Mon compte » (droits appliqués par le serveur)
  const r = roleLire();
  return `<div class="card" id="carte-profil"><div class="card-head"><h2>Profil de cet appareil</h2>${badge(ROLES[r.role].lib, r.role === "direction" ? "ok" : "neutral")}</div>
    <p class="hint" style="margin-top:0">Chaque poste ne montre que ce qui sert à son rôle. ${r.role === "direction" ? "Choisissez un profil pour ce poste ; un code sera demandé pour revenir au profil Direction." : `Ce poste est en profil <strong>${ROLES[r.role].lib}</strong> : ${ROLES[r.role].detail.toLowerCase()}.`}</p>
    <div class="liste-options">${Object.entries(ROLES).filter(([, x]) => !x.compte).map(([k, x]) => `<label class="check"><input type="radio" name="role-choix" value="${k}" ${k === r.role ? "checked" : ""}><span><strong>${x.lib}</strong><span class="sub">${x.detail}</span></span></label>`).join("")}</div>
    <div class="row" style="margin-top:10px">${btn("profil-appliquer", "Appliquer ce profil", { icone: "shield" })}</div>
    <p class="hint">C'est un <strong>tri de l'affichage</strong> protégé par un code, pas un contrôle d'accès : les données de l'appareil restent complètes (sauvegarde, synchronisation). Le téléphone d'un chauffeur se règle à part : Réglages → Appareil → Mode chauffeur.</p></div>`;
}
enregistrerCarteReglages({
  onglet: "appareil", ordre: 4,
  rendu: carteProfil,
  async agir(act) {
    if (act !== "profil-appliquer") return false;
    const choix = document.querySelector("input[name=role-choix]:checked")?.value, r = roleLire();
    if (!ROLES[choix] || choix === r.role) return true;
    if (r.role !== "direction" && !(await demanderCodeProfil())) return true; // sortir d'un profil restreint exige le code
    let verrou = r.verrou;
    if (choix !== "direction" && !verrou) {
      const f = await formulaire("Code de retour au profil Direction", [{ name: "pin", label: "Code (4 chiffres ou plus)", type: "password", required: true, autocomplete: "off" }, { name: "pin2", label: "Confirmer le code", type: "password", required: true, autocomplete: "off" }], { valider: "Verrouiller ce poste", aide: "Ce code sera demandé pour revenir au profil Direction ou changer de profil." });
      if (!f) return true;
      if (f.pin !== f.pin2 || f.pin.length < 4) { toast("Les deux codes doivent être identiques et faire au moins 4 caractères.", "danger"); return true; }
      const c = await verrouCreer(f.pin); verrou = c.verrou;
      await modale({ titre: "Code de secours", corps: `<p style="margin:0">Notez ce code de secours : il déverrouille ce poste si le code est oublié. Il ne sera plus affiché.</p><p style="font-size:1.4rem;font-weight:700;letter-spacing:.08em;text-align:center;user-select:all">${esc(c.secours)}</p>`, valider: "C'est noté", annuler: "" });
    }
    if (choix === "direction") verrou = null; // retour à la direction : le code est effacé, il sera redéfini au prochain verrouillage
    roleEcrire({ role: choix, verrou }); roleAppliquer(); toast(`Profil ${ROLES[choix].lib} appliqué`); afficher(choix === "direction" ? "parametres" : "tableau");
    return true;
  },
});
/* ---------- pages de chaque profil (appareil seul, réglé par la direction) ---------- */
const PROFILS_REGLABLES = () => Object.entries(ROLES).filter(([k, x]) => !x.compte && k !== "direction");
function cartePagesProfils() {
  if ((typeof multiActif === "function" && multiActif()) || roleLire().role !== "direction") return "";
  const profils = PROFILS_REGLABLES(), pages = ONGLETS_TOUS.filter(([id]) => !PAGES_NON_REGLABLES.includes(id));
  const voit = (k, id) => { const p = S.params.pagesProfils?.[k]; return (Array.isArray(p?.onglets) ? p.onglets : ROLES[k].onglets).includes(id); };
  const prix = (k) => { const p = S.params.pagesProfils?.[k]; return typeof p?.finances === "boolean" ? p.finances : ROLES[k].finances; };
  return `<div class="card" id="carte-pages-profils"><div class="card-head"><h2>Pages de chaque service</h2>${Object.keys(S.params.pagesProfils || {}).length ? badge("personnalisé", "warn") : badge("par défaut", "neutral")}</div>
    <p class="hint" style="margin-top:0">Cochez ce que chaque service voit sur un poste réglé à son profil. L'Accueil et les Réglages restent toujours visibles.</p>
    <form id="f-pages-profils"><div class="table-wrap"><table class="compact sans-cartes acces"><thead><tr><th>Page</th>${profils.map(([, x]) => `<th>${esc(x.lib)}</th>`).join("")}</tr></thead><tbody>
      <tr><th scope="row">Prix, coûts et marges</th>${profils.map(([k]) => `<td><input type="checkbox" name="${k}__finances" ${prix(k) ? "checked" : ""} aria-label="${esc(ROLES[k].lib)} : prix"></td>`).join("")}</tr>
      ${pages.map(([id, lib, , groupe]) => `<tr><th scope="row">${esc(lib)}${groupe ? `<span class="sub">${esc(groupe)}</span>` : ""}</th>${profils.map(([k]) => `<td><input type="checkbox" name="${k}__${id}" ${voit(k, id) ? "checked" : ""} aria-label="${esc(ROLES[k].lib)} : ${esc(lib)}"></td>`).join("")}</tr>`).join("")}
    </tbody></table></div><div class="row" style="justify-content:flex-end;margin-top:10px">${btn("pages-profils-defaut", "Remettre par défaut", { cls: "btn ghost" })}<button class="btn">${ic("shield")}Enregistrer</button></div></form>
    <p class="hint">Sur un appareil seul, c'est un tri de l'affichage protégé par le code du poste. Pour un vrai contrôle d'accès (données retirées par le serveur), utilisez le mode multi-utilisateur : page <strong>Accès par service</strong>.</p></div>`;
}
/** Lit le formulaire « pages de chaque service » : { profil: { onglets, finances } } (ne garde que ce qui diffère du défaut). */
function lirePagesProfils(v) {
  const r = {}, pages = ONGLETS_TOUS.map(([id]) => id).filter((id) => !PAGES_NON_REGLABLES.includes(id));
  for (const [k] of PROFILS_REGLABLES()) {
    const onglets = ["tableau", ...pages.filter((id) => v[`${k}__${id}`])], finances = !!v[`${k}__finances`];
    const def = ROLES[k].onglets.filter((id) => pages.includes(id)), choix = onglets.filter((id) => pages.includes(id));
    const memes = choix.length === def.length && def.every((id) => choix.includes(id));
    if (!memes || finances !== ROLES[k].finances) r[k] = { onglets, finances };
  }
  return r;
}
enregistrerCarteReglages({
  onglet: "appareil", ordre: 5, rendu: cartePagesProfils,
  agir(act) { if (act !== "pages-profils-defaut") return false; delete S.params.pagesProfils; sauver(); roleAppliquer(); rafraichir(); toast("Pages remises par défaut"); return true; },
  soumettre(fid, v) { if (fid !== "f-pages-profils") return false; const r = lirePagesProfils(v); if (Object.keys(r).length) S.params.pagesProfils = r; else delete S.params.pagesProfils; sauver(); roleAppliquer(); rafraichir(); toast("Pages de chaque service enregistrées"); return true; },
});
// En profil restreint, les Réglages ne montrent que le changement de profil.
const rendreReglagesBase = VUES.parametres.rendu;
VUES.parametres.rendu = function () { if (roleLire().role === "direction") return rendreReglagesBase.call(this); return typeof multiActif === "function" && multiActif() ? (typeof carteCompte === "function" ? carteCompte() : "") : carteProfil(); };
roleAppliquer();
