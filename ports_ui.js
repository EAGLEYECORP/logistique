"use strict";
/* ============================================================
   Passage des ports sur la fiche du voyage : Tanger Med → Algeciras à l'aller, Algeciras → Tanger Med au retour.
   Chaque étape : ce qui s'y passe, les documents à présenter, la référence à noter (DUM, TIR, MRN, CHED…), l'heure ;
   le temps passé dans chaque port. Logique pure dans portuaire.js, étapes dans data.js (PORTS_PASSAGE).
   ============================================================ */

const hmPort = (iso) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dureePort = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
function blocPort(v, port) {
  const p = PORTS_PASSAGE[port], r = resumePort(v, port), etapes = etapesApplicables(v, port);
  return `<div class="port-bloc ${r.fini ? "fini" : r.enCours ? "en-cours" : ""}"><div class="port-titre"><strong>${esc(p.lib)}</strong><span class="sub">${r.faites}/${r.total} étapes${r.debut ? ` · ${r.fini ? "" : "au port depuis "}${dureePort(r.dureeMs)}${r.fini ? " au port" : ""}` : ""}${r.prochaine && r.debut ? ` · prochaine : ${esc(r.prochaine.lib)}` : ""}</span></div>
    <ol class="port-etapes">${etapes.map((e) => { const s = etatEtapePort(v, e); return `<li class="${s.fait ? "fait" : ""} ${e.facultatif ? "facultatif" : ""}">
      <span class="port-pt">${s.fait ? ic("check") : ""}</span><div class="port-txt"><strong>${esc(e.lib)}</strong>${e.facultatif ? ` <span class="sub">(si nécessaire)</span>` : ""}
        <span class="sub">${s.fait ? `${hmPort(s.date)}${s.source === "gps" ? " · GPS" : s.source === "etape" ? " · étape du voyage" : ""}${s.ref ? ` · ${esc(e.ref || "Réf.")} : <strong>${esc(s.ref)}</strong>` : ""}${s.inspection ? " · inspection physique" : ""}${s.note ? ` · ${esc(s.note)}` : ""}` : esc(e.detail)}</span>
        ${!s.fait && e.docs.length ? `<span class="sub port-docs">À présenter : ${e.docs.map(esc).join(" · ")}</span>` : ""}</div>
      <div class="r">${v.statut === "annule" ? "" : s.fait ? (s.source === "saisie" ? iconBtn("port-etape", "edit", "Modifier", `${v.id}|${e.id}`) : btn("port-etape", "Compléter", { id: `${v.id}|${e.id}`, cls: "btn ghost sm", titre: "Ajouter une référence ou une note" })) : btn("port-etape", "Fait", { id: `${v.id}|${e.id}`, cls: "btn sm" })}</div></li>`; }).join("")}</ol></div>`;
}
function blocPorts(v) {
  if (v.statut === "annule") return "";
  const sens = [["aller", "Aller : Tanger Med → Algeciras"], ["retour", "Retour : Algeciras → Tanger Med"]];
  const ouvert = (s) => portsDuSens(s).some((p) => resumePort(v, p.id).enCours) || (s === "aller" && v.statut === "en_cours" && !portsDuSens("aller").every((p) => resumePort(v, p.id).fini) && !(v.jalons || []).some((j) => j.type === "livre")) || (s === "retour" && (v.jalons || []).some((j) => j.type === "charge_retour" || j.type === "livre") && !portsDuSens("retour").every((p) => resumePort(v, p.id).fini));
  return `<div class="section-title">Passage des ports</div>${sens.map(([s, lib]) => { const ports = portsDuSens(s), fini = ports.every((p) => resumePort(v, p.id).fini), faites = ports.reduce((n, p) => n + resumePort(v, p.id).faites, 0), total = ports.reduce((n, p) => n + resumePort(v, p.id).total, 0);
    return `<details class="ports-sens" ${ouvert(s) ? "open" : ""}><summary><strong>${lib}</strong><span class="sub">${fini ? "terminé" : `${faites}/${total} étapes`}</span></summary>${ports.map((p) => blocPort(v, p.id)).join("")}</details>`; }).join("")}
    <p class="hint">Étapes de départ à confirmer avec votre transitaire. « Fait » note l'heure ; l'entrée au port, l'embarquement, le débarquement et la mainlevée posent aussi l'étape du voyage (attentes mesurées, arrivée estimée, notifications), et la police d'Algeciras ouvre ou ferme le séjour Schengen du chauffeur.</p>`;
}
const isoLocal = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
async function saisirEtapePort(v, id) {
  const e = etapePort(id); if (!e) return;
  const s = etatEtapePort(v, e), saisie = v.etapesPort?.[id];
  const f = await formulaire(`${e.lib} — ${v.ref}`, [
    { name: "date", label: "Date et heure", type: "datetime-local", value: isoLocal(s.fait ? s.date : new Date().toISOString()), required: true },
    ...(e.ref ? [{ name: "ref", label: e.ref, value: saisie?.ref || "" }] : []),
    ...(e.scanner ? [{ name: "inspection", label: "Inspection physique (couloir rouge)", type: "checkbox", value: !!saisie?.inspection, full: true }] : []),
    { name: "note", label: "Note", value: saisie?.note || "", full: true },
  ], { valider: "Enregistrer", aide: `${esc(e.detail)}${e.docs.length ? `<br><strong>À présenter :</strong> ${e.docs.map(esc).join(" · ")}` : ""}` });
  if (!f) return;
  if (saisie) annulerEtapePort(v, id);
  const effets = marquerEtapePort(v, id, { date: new Date(f.date).toISOString(), ref: f.ref, note: f.note, inspection: !!f.inspection });
  voyagesOuverts.add(v.id); sauver(); toast(`${e.lib} : fait${effets.length ? " · " + effets.join(" · ") : ""}`); rafraichir();
}
const agirVoyagesAvantPorts = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (act === "port-etape") { const [vid, eid] = String(id).split("|"), v = parId(S.voyages, vid); if (!v) return; const saisie = v.etapesPort?.[eid];
    if (saisie && !(await new Promise((ok) => modale({ titre: etapePort(eid)?.lib || "Étape", valider: "Modifier", annuler: "Annuler l'étape", corps: `<p style="margin:0">Notée le ${hmPort(saisie.date)}${saisie.ref ? ` · ${esc(saisie.ref)}` : ""}.</p>` }).then((r) => ok(r !== null ? true : (annulerEtapePort(v, eid), voyagesOuverts.add(v.id), sauver(), toast("Étape annulée"), rafraichir(), false)))))) return;
    return saisirEtapePort(v, eid); }
  return agirVoyagesAvantPorts.call(this, act, id, b);
};
