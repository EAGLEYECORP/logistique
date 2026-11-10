"use strict";
/* ============================================================
   Phase 2 : gares de péage (positions relevées sur vos traces) et relevés Jawaz Pro.
   S'ajoute à la page « Péages Maroc ». Logique pure dans gps.js.
   ============================================================ */

const peagesBase = VUES.peages;
const ADM_NOMS = admGares();
const libGare = (n) => n.charAt(0) + n.slice(1).toLowerCase();
const optsGares = (vide) => [["", vide], ...ADM_NOMS.map((n) => [n, libGare(n)])];
let releveEnCours = null; // { nom, texte, offH, lu }
let releveMessage = "";
let osmMessage = "";

/* ---------- relever les gares depuis une trace ---------- */
async function ouvrirReleveGares(traceId) {
  const t = parId(S.traces, traceId); if (!t?.ralentis?.length) return toast("Aucun ralentissement détecté sur cette trace.", "warn");
  const proche = (c) => S.gares.find((g) => gpsDistance([0, g.lat, g.lon], [0, c.lat, c.lon]) <= (g.rayon || 300) * 2);
  const marques = t.ralentis.map((c, i) => ({ lat: c.lat, lon: c.lon, label: i + 1 }));
  const corps = `<p class="hint" style="margin-top:0">Ces points sont des <strong>ralentissements isolés</strong> en pleine conduite, typiques d'une gare de péage. Pour chacun que vous reconnaissez, choisissez la gare ; les autres, laissez « ignorer ».</p>
    ${gpsSVG(t.pts, zonesActives(), t.visites, { marques })}
    <div class="table-wrap"><table class="plain"><tbody>${t.ralentis.map((c, i) => { const g = proche(c); return `<tr><td><strong>${i + 1}</strong></td><td>${hFr(c.t)}<span class="sub">${c.vmin} km/h · ${Math.max(1, Math.round(c.dureeS / 60))} min · ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</span></td>
      <td><select name="g${i}" style="min-width:150px">${optsGares("— ignorer —").map(([v, l]) => `<option value="${esc(v)}" ${g && g.nom === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></td></tr>`; }).join("")}</tbody></table></div>
    <p class="hint">Exemple Casablanca → Tanger Med : Casablanca, Rabat, Kénitra, Kénitra Nord, Port Tanger Med. Si une même gare est choisie plusieurs fois, la position moyenne est retenue. Rayon de détection par défaut : 300 m (modifiable ensuite).</p>`;
  const f = await modale({ titre: `Relever les gares — ${t.nom}`, corps, valider: "Enregistrer les gares" });
  if (!f) return;
  const groupes = {};
  t.ralentis.forEach((c, i) => { const n = f[`g${i}`]; if (n) (groupes[n] ||= []).push(c); });
  let n = 0;
  for (const [nom, cs] of Object.entries(groupes)) {
    const lat = cs.reduce((s, c) => s + c.lat, 0) / cs.length, lon = cs.reduce((s, c) => s + c.lon, 0) / cs.length;
    const g = S.gares.find((x) => x.nom === nom);
    if (g) Object.assign(g, { lat, lon }); else S.gares.push({ nom, lat, lon, rayon: 300 });
    n++;
  }
  sauver(); toast(n ? `${n} gare(s) enregistrée(s)` : "Aucune gare choisie", n ? "ok" : "warn"); rafraichir();
}

/* ---------- lecture d'un relevé de péages ---------- */
async function choisirColonnesReleve(lu) {
  const opts = [["-1", "— Aucune —"], ...lu.entetes.map((h, i) => [String(i), h || `Colonne ${i + 1}`])];
  const d = lu.colonnes || {};
  const f = await formulaire("Quelles colonnes contient votre relevé ?", [
    { name: "temps", label: "Date et heure du passage", type: "select", options: opts, value: String(d.temps ?? -1) },
    { name: "date", label: "Date (si elle est dans une colonne à part)", type: "select", options: opts, value: String(d.date ?? -1) },
    { name: "gareB", label: "Gare (sortie / où le péage est payé)", type: "select", options: opts, value: String(d.gareB ?? -1) },
    { name: "gareA", label: "Gare d'entrée (facultatif)", type: "select", options: opts, value: String(d.gareA ?? -1) },
    { name: "montant", label: "Montant (MAD)", type: "select", options: opts, value: String(d.montant ?? -1) },
    { name: "ref", label: "N° de Pass ou plaque (facultatif)", type: "select", options: opts, value: String(d.ref ?? -1) },
  ], { valider: "Utiliser ces colonnes", aide: "Colonnes non reconnues : indiquez-les une fois." });
  return f ? Object.fromEntries(Object.entries(f).map(([k, v]) => [k, +v])) : null;
}

/* ---------- import OpenStreetMap ---------- */
async function importerOSM(texte) {
  const r = osmGaresParse(texte);
  if (!r.ok) { osmMessage = r.erreur; return rafraichir(); }
  osmMessage = "";
  const liste = r.gares.slice(0, 250);
  const corps = `<p class="hint" style="margin-top:0">${r.gares.length} élément(s) trouvé(s)${r.gares.length > 250 ? " (250 premiers affichés)" : ""}. Les correspondances proposées viennent du nom OpenStreetMap ; vérifiez-les et laissez « ignorer » ce que vous ne reconnaissez pas. Plusieurs points pour une même gare (une par voie) : la position moyenne est retenue.</p>
    <div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="plain"><tbody>${liste.map((x, i) => `<tr><td>${esc(x.nom || "(sans nom)")}<span class="sub">${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}</span></td><td><select name="g${i}" style="min-width:150px">${optsGares("— ignorer —").map(([v, l]) => `<option value="${esc(v)}" ${x.adm === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
  const f = await modale({ titre: "Gares trouvées dans OpenStreetMap", corps, valider: "Enregistrer les gares choisies" });
  if (!f) return rafraichir();
  const groupes = {};
  liste.forEach((x, i) => { const n = f[`g${i}`]; if (n) (groupes[n] ||= []).push(x); });
  for (const [nom, xs] of Object.entries(groupes)) {
    const lat = xs.reduce((s, x) => s + x.lat, 0) / xs.length, lon = xs.reduce((s, x) => s + x.lon, 0) / xs.length;
    const g = S.gares.find((z) => z.nom === nom); if (g) Object.assign(g, { lat, lon }); else S.gares.push({ nom, lat, lon, rayon: 300 });
  }
  sauver(); const n = Object.keys(groupes).length; toast(n ? `${n} gare(s) enregistrée(s)` : "Aucune gare choisie", n ? "ok" : "warn"); rafraichir();
}

/* ---------- cartes ajoutées à la page Péages Maroc ---------- */
const champsGare = (g = {}) => [
  { name: "nom", label: "Gare ADM", type: "select", options: optsGares("— Choisir —"), value: g.nom, required: true },
  { name: "lat", label: "Latitude", type: "number", step: "any", value: g.lat, required: true },
  { name: "lon", label: "Longitude", type: "number", step: "any", value: g.lon, required: true },
  { name: "rayon", label: "Rayon de détection (m)", type: "number", min: 50, value: g.rayon ?? 300, required: true },
];
function cartesGares() {
  const gares = [...S.gares].sort((a, b) => a.nom.localeCompare(b.nom));
  const nb = new Set(gares.map((g) => g.nom)).size;
  return `<div class="section-title">Gares de péage localisées · ${nb} sur ${ADM_NOMS.length}</div>
    <div class="card">
      ${gares.length ? `<div class="table-wrap"><table><thead><tr><th>Gare</th><th>Position</th><th class="r">Rayon</th><th></th></tr></thead><tbody>${gares.map((g) => `<tr><td><strong>${esc(libGare(g.nom))}</strong></td><td class="num">${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}</td><td class="r num">${fmt(g.rayon)} m</td><td><div class="actions">${btn("gare-modifier", "Modifier", { id: g.nom, icone: "edit", cls: "btn ghost sm" })}${iconBtn("gare-suppr", "trash", "Supprimer", g.nom, true)}</div></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="hint" style="margin-top:0">Aucune gare localisée. Importez une trace (page <strong>Traces GPS</strong>) d'un trajet sur autoroute, puis « Relever les gares sur cette trace ».</p>`}
      <div class="row" style="margin-top:12px">${btn("gare-ajouter", "Ajouter une gare à la main", { icone: "plus", cls: "btn ghost sm" })}</div>
      <p class="hint">ADM ne publie pas les coordonnées de ses gares. Elles sont relevées sur <strong>vos</strong> traces (le camion ralentit à chaque péage), une seule fois. Ensuite, chaque trace donne le péage réellement passé, section par section.</p>
    </div>
    <div class="card">
      <div class="card-head"><h2>Importer depuis OpenStreetMap</h2></div>
      <p class="hint" style="margin-top:0">Plus rapide que de relever les gares une à une : OpenStreetMap recense beaucoup de gares de péage. Allez sur <strong>overpass-turbo.eu</strong>, collez la requête ci-dessous, cliquez « Exécuter », puis <strong>Exporter → GeoJSON → télécharger</strong>, et importez le fichier ici. Vous validez chaque correspondance avec la gare ADM avant qu'elle soit enregistrée.</p>
      <pre class="code" style="white-space:pre-wrap;font-size:.8rem;margin:8px 0;padding:10px;background:var(--surface-2);border-radius:10px;user-select:all">${esc(OSM_REQUETE)}</pre>
      <label class="f full">Fichier GeoJSON ou JSON<input type="file" id="osm-fichier" accept=".geojson,.json,application/json,application/geo+json"></label>
      ${osmMessage ? `<p class="hint" style="color:var(--danger)">${esc(osmMessage)}</p>` : ""}
    </div>
    <div class="section-title">Relevés de péage (Jawaz Pro)</div>
    <div class="card">
      <div class="form-grid">
        <label class="f full">Relevé exporté depuis votre espace Jawaz Pro (CSV)<input type="file" id="releve-fichier" accept=".csv,.txt,text/csv,text/plain"></label>
        <label class="f">Fuseau horaire des heures du fichier<select id="releve-fuseau">${FUSEAUX.map(([k, l]) => `<option value="${k}" ${String(releveEnCours?.offH ?? 1) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      ${releveMessage ? `<p class="hint" style="color:var(--danger)">${esc(releveMessage)}</p>` : ""}
      ${releveEnCours?.lu?.ok ? `<div class="trav"><div><strong>${esc(releveEnCours.nom)}</strong><span class="sub">${releveEnCours.lu.lignes.length} passage(s) · ${fmt(releveEnCours.lu.lignes.reduce((s, l) => s + l.mad, 0))} MAD${releveEnCours.lu.rejetes ? ` · ${releveEnCours.lu.rejetes} ligne(s) ignorée(s)` : ""}</span></div><div class="r">${btn("releve-enregistrer", "Enregistrer ce relevé", { icone: "check", cls: "btn" })}</div></div>` : ""}
      ${S.releves.length ? `<div class="table-wrap"><table class="plain"><tbody>${S.releves.map((r) => `<tr><td><strong>${esc(r.nom)}</strong><span class="sub">${r.lignes.length} passage(s) · ${hFr(Math.min(...r.lignes.map((l) => l.t)))} → ${hFr(Math.max(...r.lignes.map((l) => l.t)))}</span></td><td class="r num">${fmt(r.lignes.reduce((s, l) => s + l.mad, 0))} MAD</td><td class="r">${iconBtn("releve-suppr", "trash", "Supprimer", r.id, true)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="hint">Nous ne connaissons pas le format exact de l'export ADM : les colonnes (date, heure, gare, montant, Pass) sont reconnues automatiquement, sinon vous les désignez. Une fois enregistré, le relevé se compare à chaque trace (page Traces GPS) : péages non facturés, écarts de montant, passages facturés sans passage GPS.</p>
    </div>`;
}

VUES.peages = {
  ...peagesBase,
  rendu() { return peagesBase.rendu() + cartesGares(); },
  async agir(act, id) {
    if (act === "gare-ajouter") {
      const f = await formulaire("Nouvelle gare", champsGare(), { valider: "Ajouter" });
      if (f) { const o = { nom: f.nom, lat: num(f.lat), lon: num(f.lon), rayon: Math.max(50, num(f.rayon, 300)) }; const g = S.gares.find((x) => x.nom === o.nom); g ? Object.assign(g, o) : S.gares.push(o); sauver(); rafraichir(); }
      return;
    }
    if (act === "gare-modifier") {
      const g = S.gares.find((x) => x.nom === id); const f = g && (await formulaire(`Modifier ${libGare(g.nom)}`, champsGare(g)));
      if (f) { Object.assign(g, { lat: num(f.lat), lon: num(f.lon), rayon: Math.max(50, num(f.rayon, 300)) }); sauver(); rafraichir(); }
      return;
    }
    if (act === "gare-suppr") { if (await confirmer(`Retirer la gare ${libGare(id)} ?`, "Les péages mesurés ne la compteront plus.", "Retirer")) { S.gares = S.gares.filter((x) => x.nom !== id); sauver(); rafraichir(); } return; }
    if (act === "releve-enregistrer" && releveEnCours?.lu?.ok) {
      S.releves.unshift({ id: uid(), nom: releveEnCours.nom.replace(/\.[^.]+$/, ""), importe: new Date().toISOString(), lignes: releveEnCours.lu.lignes });
      toast(`Relevé enregistré : ${releveEnCours.lu.lignes.length} passage(s)`); releveEnCours = null; releveMessage = ""; sauver(); rafraichir(); return;
    }
    if (act === "releve-suppr") { if (await confirmer("Supprimer ce relevé ?", "Les comparaisons qui l'utilisent seront retirées.")) { S.releves = S.releves.filter((r) => r.id !== id); S.traces.forEach((t) => { if (t.releveId === id) t.releveId = ""; }); sauver(); rafraichir(); } return; }
    return peagesBase.agir(act, id);
  },
};

document.addEventListener("change", async (e) => {
  if (ongletActif !== "peages") return;
  if (e.target.id === "osm-fichier" && e.target.files?.[0]) {
    const f = e.target.files[0];
    if (f.size > 30 * 1024 * 1024) { osmMessage = "Fichier trop volumineux (30 Mo maximum)."; return rafraichir(); }
    return importerOSM(await f.text());
  }
  if (e.target.id === "releve-fuseau" && releveEnCours) {
    const off = Number(e.target.value); releveEnCours = { ...releveEnCours, offH: off, lu: releveParse(releveEnCours.texte, { offH: off, colonnes: releveEnCours.colonnes }) }; return rafraichir();
  }
  if (e.target.id === "releve-fichier" && e.target.files?.[0]) {
    const fichier = e.target.files[0], off = Number($("#releve-fuseau")?.value ?? 1);
    releveMessage = "";
    if (fichier.size > 20 * 1024 * 1024) { releveMessage = "Fichier trop volumineux (20 Mo maximum)."; return rafraichir(); }
    const texte = await fichier.text();
    let lu = releveParse(texte, { offH: off }), colonnes = lu.colonnes;
    if (!lu.ok && lu.entetes?.length > 1) { const col = await choisirColonnesReleve(lu); if (col) { colonnes = col; lu = releveParse(texte, { offH: off, colonnes: col }); } }
    if (!lu.ok) { releveMessage = lu.erreur || "Fichier illisible."; releveEnCours = null; } else releveEnCours = { nom: fichier.name, texte, offH: off, lu, colonnes };
    rafraichir();
  }
});
