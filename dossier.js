"use strict";
/* ============================================================
   Dossier de voyage : tout ce qui concerne un voyage, relié et daté, en un clic —
   papiers valides sur la durée du voyage, étapes (GPS ou saisies), traversées, preuve de livraison, trace, températures,
   temps de conduite, listes de contrôle, pièces jointes. Pour un litige, une réclamation CMR ou un contrôle.
   Impression / PDF, ou archive ZIP (dossier.html + voyage.json + photos + trace).
   ============================================================ */

const LIB_CONFORMITE = { valide: ["Valide sur tout le voyage", "#15803d"], expire_pendant: ["Expire pendant le voyage", "#b45309"], expire_au_depart: ["Expiré au départ", "#b91c1c"], non_renseigne: ["Non renseigné", "#64748b"] };
const blobVersDataUrl = (b) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(r.error); r.readAsDataURL(b); });
const nomFichierSur = (s) => String(s || "photo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);

/** Corps HTML du dossier. images : [{ src, nom, date }] (miniatures en données, ou chemins relatifs dans le ZIP). */
function corpsDossierVoyage(v, { images = [], couts = false } = {}) {
  const ch = parId(S.chauffeurs, v.chauffeurId) || {}, cam = parId(S.camions, v.camionId) || {}, cl = parId(S.clients, v.clientId) || {}, aut = parId(S.autorisations, v.autorisationId);
  const fin = finVoyage(v), traces = S.traces.filter((t) => t.voyageId === v.id), c = coutCompletVoyage(v);
  const conf = conformiteVoyage(v), jalons = [...(v.jalons || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const source = (s) => (s === "gps" ? "GPS" : s === "preuve" ? "Preuve de livraison" : "Saisie");
  const temps = traces.flatMap((t) => t.temps || []).sort((a, b) => a[0] - b[0]);
  const froid = temps.length ? (Number.isFinite(v.tempMin) && Number.isFinite(v.tempMax) ? froidAnalyser(temps, v.tempMin, v.tempMax) : froidAnalyser(temps, -100, 100)) : null;
  const tachy = (ch.tachy?.infractions || []).filter((i) => i.date >= v.dateDepart && i.date <= fin);
  const listes = Object.entries(CHECKLISTS_VOYAGE).map(([k, items]) => ({ nom: LIB_CHECKLISTS_VOYAGE[k], faits: items.filter((_, i) => v.coches?.[k]?.[i]).length, total: items.length, manquants: items.filter((_, i) => !v.coches?.[k]?.[i]) }));
  const h = (t) => dateHeureFr(gpsIso(t));
  return `${enteteDoc("Dossier de voyage", [`Voyage <strong style="color:#0f172a">${l(v.ref)}</strong>`, `Édité le ${dateHeureFr(new Date().toISOString())}`, v.cmrNumero ? `CMR n° ${l(v.cmrNumero)}` : ""].filter(Boolean))}
    <h2>Synthèse</h2>
    <div class="grille">${champDoc("Itinéraire", `${v.origine} ⇄ ${v.destination}`)}${champDoc("Client", cl.nom)}${champDoc("Marchandise", v.marchandise)}${champDoc("Statut", (STATUTS_VOYAGE.find(([k]) => k === v.statut) || [])[1])}
      ${champDoc("Départ", dateFr(v.dateDepart))}${champDoc(v.jalons?.some((j) => j.type === "retour") ? "Retour (réel)" : "Retour (prévu)", dateFr(fin))}${champDoc("Chauffeur", ch.nom)}${champDoc("Camion / remorque", [cam.immat, v.remorque].filter(Boolean).join(" / "))}
      ${champDoc("Autorisation bilatérale", aut ? `${aut.type === "MA" ? "« MA »" : "« E »"} ${aut.numero || ""}` : "non rattachée")}${champDoc("Livraison promise", v.livraisonPrevue ? dateHeureFr(v.livraisonPrevue) : "")}</div>
    <h2>Papiers sur la durée du voyage (${dateFr(v.dateDepart)} → ${dateFr(fin)})</h2>
    <table class="compact"><thead><tr><th>Concerne</th><th>Pièce</th><th>Échéance</th><th>Sur le voyage</th></tr></thead><tbody>
      ${conf.map((x) => `<tr><td>${l(x.objet)}</td><td>${l(x.piece)}</td><td>${x.echeance ? dateFr(x.echeance) : "—"}</td><td style="color:${LIB_CONFORMITE[x.statut][1]};font-weight:600">${LIB_CONFORMITE[x.statut][0]}</td></tr>`).join("")}</tbody></table>
    <h2>Étapes</h2>
    ${jalons.length ? `<table class="compact"><thead><tr><th>Étape</th><th>Date et heure</th><th>Origine de l'information</th></tr></thead><tbody>${jalons.map((j) => `<tr><td>${l(nomJalon(j.type))}</td><td>${dateHeureFr(j.date)}</td><td>${source(j.source)}</td></tr>`).join("")}</tbody></table>` : `<p>Aucune étape enregistrée.</p>`}
    <h2>Traversées</h2>
    ${(v.traversees || []).length ? `<table class="compact"><thead><tr><th>Sens</th><th>Ligne</th><th>Armateur</th><th>Date</th><th>Réservation</th><th>Statut</th></tr></thead><tbody>${v.traversees.map((t) => `<tr><td>${t.sens === "aller" ? "Aller" : "Retour"}</td><td>${l(libLigne(t.ligne))}</td><td>${l(t.armateur || "—")}</td><td>${t.date ? dateFr(t.date) + (t.heure ? " " + l(t.heure) : "") : "—"}</td><td>${l(t.ref || "—")}</td><td>${l((STATUTS_TRAV.find(([k]) => k === t.statut) || [])[1] || "")}</td></tr>`).join("")}</tbody></table>` : `<p>Aucune traversée enregistrée.</p>`}
    ${typeof PORTS_PASSAGE === "object" ? (() => { const lignes = Object.entries(PORTS_PASSAGE).flatMap(([port, p]) => etapesApplicables(v, port).map((e) => ({ p, e, s: etatEtapePort(v, e) })).filter((x) => x.s.fait)); return lignes.length ? `<h2>Passage des ports</h2><table class="compact"><tbody>${lignes.map(({ p, e, s }) => `<tr><td>${esc(p.lib)}</td><td>${esc(e.lib)}</td><td>${dateHeureFr(s.date)}</td><td>${s.ref ? esc((e.ref || "Réf.") + " : " + s.ref) : ""}${s.inspection ? " · inspection" : ""}</td></tr>`).join("")}</tbody></table>` : ""; })() : ""}
    <h2>Preuve de livraison</h2>
    ${v.pod ? `<div class="grille">${champDoc("Reçu par", v.pod.signataire)}${champDoc("Date et heure", dateHeureFr(v.pod.date))}${champDoc("Position relevée", v.pod.lat ? `${v.pod.lat.toFixed(5)}, ${v.pod.lon.toFixed(5)} (± ${v.pod.precision} m)` : "non disponible")}${champDoc("Réserves", v.pod.reserves || "aucune")}</div>${v.pod.signature ? `<div class="cadre" style="margin-top:8px"><img src="${v.pod.signature}" alt="Signature" style="max-height:90px"></div>` : ""}` : `<p>Aucune preuve de livraison enregistrée.</p>`}
    <h2>Trace GPS</h2>
    ${traces.length ? traces.map((t) => `<div class="cadre" style="margin-bottom:8px"><div class="grille">${champDoc("Fichier", t.nom)}${champDoc("Période", `${h(t.debut)} → ${h(t.fin)}`)}${champDoc("Distance", `${fmt(t.km, 0)} km`)}${champDoc("Conduite estimée", `${dureeTxt(t.conduiteH)} (au plus ${dureeTxt(t.conduiteMaxSansPauseH)} sans pause de 45 min)`)}${champDoc("Arrêts de plus de 20 min", String(t.arrets.length))}${champDoc("Trous de signal", String(t.trous.length))}</div>
      ${t.traversees.length ? `<p style="margin:8px 0 0">${t.traversees.map((x) => `${x.sens === "aller" ? "Aller" : "Retour"} ${l(x.de)} → ${l(x.vers)} : embarquement ${h(x.embarque)}, débarquement ${h(x.debarque)}`).join("<br>")}</p>` : ""}
      <div style="color:#2563eb;margin-top:8px">${gpsSVG(t.pts, zonesActives(), t.visites).replace(/var\(--primary\)/g, "#2563eb").replace(/var\(--ok, #16a34a\)/g, "#16a34a").replace(/var\(--danger, #dc2626\)/g, "#dc2626")}</div></div>`).join("") : `<p>Aucune trace GPS rattachée à ce voyage.</p>`}
    ${froid ? `<h2>Chaîne du froid</h2><div class="grille">${champDoc("Mesures", `${froid.nb} relevé(s), de ${froid.min.toFixed(1).replace(".", ",")} à ${froid.max.toFixed(1).replace(".", ",")} °C (moyenne ${froid.moyenne.toFixed(1).replace(".", ",")} °C)`)}${champDoc("Consigne", Number.isFinite(v.tempMin) ? `${v.tempMin} à ${v.tempMax} °C` : "non renseignée")}</div>
      ${Number.isFinite(v.tempMin) ? (froid.excursions.length ? `<table class="compact"><thead><tr><th>Début</th><th>Durée</th><th>Écart</th></tr></thead><tbody>${froid.excursions.map((e) => `<tr><td>${h(e.debut)}</td><td>${e.dureeMin} min</td><td>${e.sens === "haut" ? "au-dessus" : "en dessous"} — extrême ${String(e.extreme).replace(".", ",")} °C</td></tr>`).join("")}</tbody></table>` : `<p style="color:#15803d;font-weight:600">Température conforme à la consigne sur tout le relevé.</p>`) : ""}` : ""}
    <h2>Temps de conduite et de repos</h2>
    ${ch.tachy ? (tachy.length ? `<table class="compact"><tbody>${tachy.map((i) => `<tr><td>${dateFr(i.date)}</td><td>${l(i.texte)}</td></tr>`).join("")}</tbody></table>` : `<p>Aucun dépassement relevé pendant le voyage dans l'analyse du tachygraphe (import du ${dateFr(ch.tachy.importe.slice(0, 10))}).</p>`) : `<p>Aucune analyse du tachygraphe importée pour ce chauffeur.</p>`}
    <h2>Listes de contrôle</h2>
    <table class="compact"><tbody>${listes.map((x) => `<tr><td>${l(x.nom)}</td><td>${x.faits} / ${x.total}</td><td style="color:#64748b">${x.manquants.length ? "Non cochés : " + x.manquants.slice(0, 4).map(l).join(" · ") + (x.manquants.length > 4 ? " …" : "") : "complète"}</td></tr>`).join("")}</tbody></table>
    ${couts ? `<h2>Coûts et marge (interne)</h2><table class="compact"><tbody>${[["Péages Maroc", c.parts.peagesMaroc], ["Péages France", c.parts.peagesFrance], ["Péages Europe", c.parts.peagesEurope], ["Traversées", c.parts.traversees], [`Carburant${c.carburantEstime ? " (estimé d'après les pleins)" : ""}`, c.parts.carburant], ["Frais de route", c.parts.fraisRoute], ["Douane", c.parts.douane], ["Énergie du groupe froid", c.parts.froid], ["Amendes", c.parts.amendes], ["Dépannage en route", c.parts.maintien], ["Autres", c.parts.autres]].filter(([, m]) => m).map(([k, m]) => `<tr><td>${k}</td><td class="r">${fmt(m)} MAD</td></tr>`).join("")}
      <tr><td><strong>Coût total</strong></td><td class="r"><strong>${fmt(c.total)} MAD</strong></td></tr><tr><td>Prix de vente</td><td class="r">${fmt(c.prix)} MAD</td></tr><tr><td><strong>Marge</strong></td><td class="r"><strong>${fmt(c.marge)} MAD</strong></td></tr></tbody></table>` : ""}
    <h2>Pièces jointes (${images.length})</h2>
    ${images.length ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${images.map((i) => `<div style="break-inside:avoid;font-size:10px;color:#64748b"><img src="${i.src}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1"><br>${l(i.nom)}<br>${dateHeureFr(i.date)}</div>`).join("")}</div>` : `<p>Aucune photo rattachée au voyage.</p>`}
    <p style="font-size:11px;color:#64748b;margin-top:14px">Dossier établi à partir des données enregistrées dans l'application. Les étapes marquées « GPS » proviennent des positions des balises ; la conduite est estimée d'après la vitesse et ne remplace pas le tachygraphe. Ce document ne remplace ni le CMR signé ni les documents douaniers.</p>${piedDoc()}`;
}

async function imprimerDossierVoyage(v, options = {}) {
  let photos = []; try { photos = await photosDe(`voyage:${v.id}`); } catch { /* stockage des photos indisponible */ }
  const images = []; for (const p of photos) images.push({ src: await blobVersDataUrl(p.mini || p.blob), nom: p.nom, date: p.date });
  ouvrirImpression(`Dossier ${v.ref}`, corpsDossierVoyage(v, { ...options, images }));
}
/** Archive ZIP : dossier.html autonome, voyage.json, photos en taille réelle, traces et températures en CSV. */
async function archiveDossierVoyage(v, options = {}) {
  let photos = []; try { photos = await photosDe(`voyage:${v.id}`); } catch { /* ignoré */ }
  const enc = new TextEncoder(), fichiers = [], images = [];
  for (const [i, p] of photos.entries()) { const nom = `photos/${String(i + 1).padStart(2, "0")}-${nomFichierSur(p.nom).replace(/\.[^.]+$/, "")}.jpg`; fichiers.push({ nom, donnees: new Uint8Array(await p.blob.arrayBuffer()) }); images.push({ src: nom, nom: p.nom, date: p.date }); }
  const html = htmlImpression(`Dossier ${v.ref}`, corpsDossierVoyage(v, { ...options, images })).replace(/<script>[\s\S]*?<\/script>/g, "");
  fichiers.unshift({ nom: "dossier.html", donnees: enc.encode(html) });
  const traces = S.traces.filter((t) => t.voyageId === v.id);
  fichiers.push({ nom: "voyage.json", donnees: enc.encode(JSON.stringify({ exporte: new Date().toISOString(), voyage: v, conformite: conformiteVoyage(v), chauffeur: parId(S.chauffeurs, v.chauffeurId)?.nom || "", camion: parId(S.camions, v.camionId)?.immat || "", traces: traces.map(({ pts, temps, ...reste }) => reste) }, null, 2)) });
  traces.forEach((t, i) => { fichiers.push({ nom: `trace-${i + 1}.csv`, donnees: enc.encode("horodatage_utc;latitude;longitude\r\n" + t.pts.map((p) => `${gpsIso(p[0])};${p[1]};${p[2]}`).join("\r\n")) }); if (t.temps?.length) fichiers.push({ nom: `temperatures-${i + 1}.csv`, donnees: enc.encode("horodatage_utc;temperature_c\r\n" + t.temps.map((p) => `${gpsIso(p[0])};${String(p[1]).replace(".", ",")}`).join("\r\n")) }); });
  return { octets: zipCreer(fichiers), nom: `dossier-${nomFichierSur(v.ref)}-${today()}.zip`, nbFichiers: fichiers.length };
}
async function ouvrirDossierVoyage(voyageId) {
  const v = parId(S.voyages, voyageId); if (!v) return;
  const f = await formulaire(`Dossier de voyage — ${v.ref}`, [
    { name: "format", label: "Format", type: "select", options: [["imprimer", "Imprimer ou enregistrer en PDF"], ["zip", "Archive ZIP (dossier, données, photos en taille réelle, trace)"]], value: "imprimer", full: true },
    { name: "couts", label: "Inclure les coûts et la marge (à ne pas transmettre à un tiers)", type: "checkbox", full: true },
  ], { valider: "Générer", aide: "Le dossier réunit les papiers valides sur la durée du voyage, les étapes (GPS ou saisies), les traversées, la preuve de livraison, la trace, les températures, les temps de conduite, les listes de contrôle et les photos." });
  if (!f) return;
  if (f.format === "imprimer") return imprimerDossierVoyage(v, { couts: !!f.couts });
  try { const a = await archiveDossierVoyage(v, { couts: !!f.couts }); telecharger(a.nom, a.octets, "application/zip"); toast(`Archive créée : ${a.nbFichiers} fichier(s)`); } catch (e) { toast(`Archive impossible : ${e.message}`, "danger"); }
}
const agirVoyagesDossier = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, bouton) {
  if (act === "dossier") return ouvrirDossierVoyage(String(id).split("|")[0]);
  return agirVoyagesDossier.call(this, act, id, bouton);
};
