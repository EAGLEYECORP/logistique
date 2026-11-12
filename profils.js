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
    onglets: ["tableau", "operations", "planning", "commandes", "direct", "voyages", "gps", "itineraires", "douane", "international", "peages", "camions", "chauffeurs", "tachy", "carburant", "nomenclature"] },
  commercial: { lib: "Commercial", detail: "Commandes, clients, factures, voyages et suivi", finances: true, onglets: ["tableau", "commandes", "clients", "factures", "direct", "voyages", "planning", "nomenclature"] },
  comptabilite: { lib: "Comptabilité", detail: "Factures, clients, rentabilité, gasoil, péages", finances: true, onglets: ["tableau", "factures", "clients", "direction", "rentabilite", "commandes", "voyages", "carburant", "peages"] },
  // profils des comptes du mode multi-utilisateur (non proposés comme profil d'appareil)
  exploitant: { lib: "Exploitant", detail: "Toute l'exploitation, prix et marges compris", finances: true, compte: true, onglets: ["tableau", "operations", "planning", "commandes", "direct", "voyages", "gps", "itineraires", "douane", "international", "peages", "camions", "chauffeurs", "tachy", "carburant", "clients", "factures", "direction", "rentabilite", "nomenclature"] },
  chauffeur: { lib: "Chauffeur", detail: "Ses voyages", finances: false, compte: true, onglets: ["chauffeur"] },
  transitaire: { lib: "Transitaire", detail: "Ses dossiers de douane et voyages", finances: false, compte: true, onglets: ["douane", "voyages", "nomenclature"] },
};
const ONGLETS_TOUS = ONGLETS.map((o) => o.slice());
const roleLire = () => { if (typeof roleMulti === "function" && roleMulti()) return { role: PROFIL_DU_ROLE[roleMulti()] || "exploitation", verrou: null, compte: true }; try { const r = JSON.parse(localStorage.getItem(CLE_ROLE) || "{}"); return { role: ROLES[r.role] ? r.role : "direction", verrou: r.verrou || null }; } catch { return { role: "direction", verrou: null }; } };
const roleEcrire = (r) => { try { localStorage.setItem(CLE_ROLE, JSON.stringify(r)); } catch { /* ignoré */ } };
const roleCourant = () => ROLES[roleLire().role];
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
// En profil restreint, les Réglages ne montrent que le changement de profil.
const rendreReglagesBase = VUES.parametres.rendu;
VUES.parametres.rendu = function () { if (roleLire().role === "direction") return rendreReglagesBase.call(this); return typeof multiActif === "function" && multiActif() ? (typeof carteCompte === "function" ? carteCompte() : "") : carteProfil(); };
roleAppliquer();
