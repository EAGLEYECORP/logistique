"use strict";
/* ============================================================
   Meilleur créneau au port (interface) :
   · fiche du voyage → Suivi : arrivée estimée au prochain port, attente habituelle à cette heure, créneau conseillé et à éviter ;
   · page Planning : attentes habituelles par jour et par tranche de 3 heures, pour chaque port (vos passages mesurés) ;
   · devis : le créneau conseillé à Tanger Med.
   Logique pure dans creneaux.js.
   ============================================================ */

let portGrille = "tmed_export";
const PORTS_GRILLE = [["tmed_export", "Tanger Med export", false], ["alg_entry", "Algeciras", false], ["alg_frais", "Algeciras, frais", true], ["tmed_import", "Tanger Med import", false]];

function bandeTranches(c, arrivee) {
  const max = Math.max(...c.tranches.map((x) => x.p50)), hArr = arrivee ? trancheDe(heureMaroc(arrivee)) : null;
  return `<div class="tranches-port">${TRANCHES_PORT.map((h) => { const t = c.tranches.find((x) => x.h === h);
    return `<span class="${!t ? "vide" : t.h === c.meilleur.h ? "meilleur" : t.h === c.pire.h ? "pire" : ""} ${h === hArr ? "arrivee" : ""}" title="${esc(libTranche(h))}${t ? ` : ${esc(dureeTexte(t.p50))} (${t.n} passages)` : " : trop peu de passages"}"><i style="height:${t ? Math.max(12, Math.round((t.p50 / max) * 100)) : 0}%"></i><b>${String(h).padStart(2, "0")}</b></span>`; }).join("")}</div>`;
}
function blocCreneau(v) {
  const k = conseilCreneau(v); if (!k) return "";
  return `<div class="section-title">Créneau au port</div><div class="trav creneau-port"><div><span>${esc(k.conseil)}</span>
    <span class="sub">D'après vos ${k.n} passage(s) mesuré(s) à ${esc(k.port.lib)} (entrée au port jusqu'à l'embarquement ou la sortie, heure du Maroc)${k.arrivee ? " ; arrivée estimée : départ du dépôt à 6 h, 70 km/h, pauses et repos de nuit compris" : ""}. Les passages au scanner sont écartés.</span></div>
    ${k.creneau ? bandeTranches(k.creneau, k.arrivee) : ""}</div>`;
}
enregistrerBlocVoyage({ onglet: "suivi", ordre: 15, rendu: blocCreneau });

/* ---------- page Planning : la grille des attentes ---------- */
function carteGrilleAttentes() {
  const [id, lib, frais] = PORTS_GRILLE.find((p) => p[0] === portGrille) || PORTS_GRILLE[0], portId = id === "alg_frais" ? "alg_entry" : id;
  const { grille, total } = grilleAttentes(portId, { avecSPS: frais }), vals = [];
  for (let j = 0; j < 7; j++) for (const h of TRANCHES_PORT) if (grille[j][h].n >= 2) vals.push(grille[j][h].p50);
  const min = Math.min(...vals), max = Math.max(...vals), ordre = [1, 2, 3, 4, 5, 6, 0];
  const teinte = (x) => (vals.length < 2 || max === min ? 0.5 : (x - min) / (max - min));
  return `<div class="card" id="grille-attentes"><div class="card-head"><h2>Attentes aux ports par jour et heure</h2>${badge(`${total} passage(s) mesuré(s)`, "neutral")}</div>
    <div class="segmented">${PORTS_GRILLE.map(([k, l]) => `<button type="button" data-act="grille-port" data-id="${k}" aria-selected="${k === portGrille}">${l}</button>`).join("")}</div>
    ${total ? `<div class="table-wrap"><table class="grille-attentes sans-cartes"><thead><tr><th></th>${TRANCHES_PORT.map((h) => `<th>${String(h).padStart(2, "0")} h</th>`).join("")}</tr></thead><tbody>
      ${ordre.map((j) => `<tr><th scope="row">${JOURS_PORT_COURTS[j]}</th>${TRANCHES_PORT.map((h) => { const c = grille[j][h];
        return c.n >= 2 ? `<td style="--t:${teinte(c.p50).toFixed(2)}" title="${esc(`${JOURS_PORT_LONGS[j]} ${libTranche(h)} : médiane ${dureeTexte(c.p50)}, 9 fois sur 10 moins de ${dureeTexte(c.p90)} — ${c.n} passages${c.scans ? `, ${c.scans} au scanner` : ""}`)}"><b>${esc(dureeTexte(c.p50).replace(" h ", "h").replace(" min", "m"))}</b><span>${c.n}</span></td>` : `<td class="vide">${c.n ? `<span>${c.n}</span>` : ""}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="hint">Médiane de l'attente (entrée au port → embarquement ou sortie), par jour et par tranche de 3 heures d'arrivée, heure du Maroc ; vert : rapide, rouge : lent. Une case s'affiche à partir de 2 passages (le petit nombre) ; les passages au scanner sont écartés. ${esc(lib)}${frais ? " : marchandises fraîches (contrôle sanitaire)" : ""}.</p>`
    : vide("clock", "Aucun passage mesuré", "Les attentes se mesurent seules à chaque passage (entrée au port et embarquement, posés à la main ou par le GPS).")}</div>`;
}
if (VUES.planning) {
  blocPage("planning", { position: "apres", ordre: 10, rendu: carteGrilleAttentes });
  surAction("planning", "*", async function (act, id, b) { if (act === "grille-port") { portGrille = id; return rafraichir(); } return PASSER; });
}

/* ---------- devis : le créneau conseillé à Tanger Med ---------- */
function ligneCreneauDevis(c) {
  const maroc = (p) => p === "Maroc", exportMa = maroc(c.paysOrigine || "Maroc") && c.paysDest && !maroc(c.paysDest), importMa = !maroc(c.paysOrigine || "Maroc") && maroc(c.paysDest || "");
  if (!exportMa && !importMa) return "";
  const portId = exportMa ? "tmed_export" : "tmed_import", jour = jourMaroc(Date.parse(`${c.dateChargement || today()}T12:00:00Z`)), k = meilleurCreneau(portId, jour);
  if (!k) return "";
  return `<p class="hint creneau-devis">${ic("clock")}<span>Tanger Med (${exportMa ? "export" : "import"}), ${k.portee === "jour" ? `le ${JOURS_PORT_LONGS[jour]}` : "en semaine"} : arrivée conseillée ${esc(k.meilleur.lib)} (attente habituelle ${esc(dureeTexte(k.meilleur.p50))}) ; à éviter ${esc(k.pire.lib)} (${esc(dureeTexte(k.pire.p50))}). D'après ${k.total} passages mesurés.</span></p>`;
}
