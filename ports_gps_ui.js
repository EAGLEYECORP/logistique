"use strict";
/* ============================================================
   Étapes de port posées par le GPS (interface) : dans la vue de chaque port (page Passages douane), ce que le GPS sait déjà
   reconnaître, ce qu'il apprend (passages relevés sur 2), « Oublier » une zone apprise par erreur.
   Logique pure dans ports_gps.js ; appliquée par la carte en direct (direct.js) et à l'import des traces (traces.js).
   ============================================================ */

function blocApprentissageGps(lieu) {
  const L = LIEUX_PASSAGE[lieu]; if (!L) return "";
  const ports = apprentissagePorts().filter((p) => L.ports.includes(p.port)), toutes = ports.flatMap((p) => p.etapes), pretes = toutes.filter((e) => e.prete).length;
  return `<div class="card gps-apprentissage"><div class="card-head"><h2>Reconnaissance par le GPS</h2>${badge(`${pretes}/${toutes.length} étapes reconnues`, pretes ? "ok" : "neutral")}</div>
    <p style="margin-top:0" class="sub">Déjà vues par le GPS, sans rien apprendre : entrée et sortie du port, embarquement, débarquement${lieu === "alg" ? ", arrivée au port au retour" : ", mainlevée et sortie au retour"}. Les étapes à l'intérieur du port s'apprennent : notez-les quand le camion y est arrêté ; à 2 passages, le GPS les pose seul.</p>
    ${ports.map((p) => `<div class="groupe">${esc(p.lib)}</div><ul class="gps-etapes">${p.etapes.map((e) => `<li class="${e.prete ? "ok" : e.n ? "encours" : ""}">${ic(e.prete ? "check" : "pin")}<span>${esc(e.lib)}<span class="sub">${e.prete ? `reconnue (${e.n} passages)` : e.n ? `${e.n}/2 passage relevé` : "pas encore relevée"}</span></span>${e.n ? btn("zone-oublier", "Oublier", { id: e.id, cls: "btn ghost sm", titre: "Oublier l'emplacement appris (s'il est faux)" }) : ""}</li>`).join("")}</ul>`).join("")}</div>`;
}
if (typeof blocLieu === "function") { const blocLieuAvantGps = blocLieu; blocLieu = function (p) { return blocLieuAvantGps(p) + (p ? blocApprentissageGps(p.lieu) : ""); }; }
if (VUES.passages) {
  surAction("passages", "*", async function (act, id, b) {
    if (act === "zone-oublier") { if (!(await confirmer("Oublier cet emplacement ?", "Le GPS ne posera plus cette étape tant qu'elle n'aura pas été relevée de nouveau, deux fois.", "Oublier"))) return; oublierZoneEtape(id); sauver(); toast("Emplacement oublié"); return rafraichir(); }
    return PASSER;
  });
}
