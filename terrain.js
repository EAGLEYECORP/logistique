"use strict";
/* ============================================================
   Sur le terrain (mode chauffeur et voyages) :
   · balise de secours : le téléphone du chauffeur envoie sa position au relais ;
   · preuve de livraison : signature du destinataire, réserves, position et heure, imprimable.
   ATTENTION : la preuve de livraison n'est PAS un e-CMR : la valeur juridique d'un CMR électronique au Maroc et en Espagne n'est pas confirmée.
   Conservez le CMR papier signé.
   ============================================================ */

/* ---------- balise du téléphone ---------- */
const CLE_BALISE = "logistique-balise-tel", CLE_FILE = "logistique-balise-file";
const baliseCfg = () => { try { return { url: "", jeton: "", id: "", ...JSON.parse(localStorage.getItem(CLE_BALISE) || "{}") }; } catch { return { url: "", jeton: "", id: "" }; } };
const baliseSauver = (c) => { try { localStorage.setItem(CLE_BALISE, JSON.stringify(c)); } catch { /* ignoré */ } };
const baliseEtat = { watch: null, derniere: null, file: (() => { try { return JSON.parse(localStorage.getItem(CLE_FILE) || "[]"); } catch { return []; } })(), envoyees: 0, erreur: "", verrou: null, minuteur: null };
const baliseFileSauver = () => { try { localStorage.setItem(CLE_FILE, JSON.stringify(baliseEtat.file.slice(-1000))); } catch { /* ignoré */ } };

async function baliseEnvoyer() {
  const c = baliseCfg(), E = baliseEtat;
  if (!E.file.length || !c.url || !c.jeton) return;
  const lot = E.file.slice(0, 200);
  try {
    const r = await fetch(`${baseUrl(c.url)}/api/positions`, { method: "POST", headers: { Authorization: `Bearer ${c.jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(lot) });
    if (r.status === 401) throw new Error("Jeton refusé par le serveur.");
    if (!r.ok) throw new Error(`Réponse ${r.status} du serveur.`);
    E.file.splice(0, lot.length); E.envoyees += lot.length; E.erreur = ""; baliseFileSauver();
  } catch (e) { E.erreur = e.message === "Failed to fetch" ? "Pas de réseau : positions gardées, envoi dès le retour du réseau." : e.message; }
  rafraichirBalise();
}
function baliseDemarrer() {
  const c = baliseCfg(), E = baliseEtat;
  if (!navigator.geolocation) return toast("Ce téléphone ne donne pas sa position.", "danger");
  if (!/^https?:\/\//.test(c.url) || !c.jeton) return toast("Renseignez l'adresse du relais et le jeton d'écriture.", "warn");
  const id = c.id || `TEL-${modeChauffeurLire()?.chauffeurId || "chauffeur"}`;
  E.watch = navigator.geolocation.watchPosition((pos) => {
    const p = { t: Math.floor(pos.timestamp / 1000), lat: pos.coords.latitude, lon: pos.coords.longitude, v: pos.coords.speed != null && Number.isFinite(pos.coords.speed) ? Math.round(pos.coords.speed * 3.6 * 10) / 10 : null, cap: Number.isFinite(pos.coords.heading) ? Math.round(pos.coords.heading) : null, precision: pos.coords.accuracy };
    if (!baliseTelRetenir(E.derniere, p)) return;
    E.derniere = p; E.file.push({ id, t: p.t, lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6, v: p.v, cap: p.cap }); baliseFileSauver(); baliseEnvoyer();
  }, (e) => { E.erreur = e.code === 1 ? "Position refusée : autorisez la localisation pour ce site." : "Position indisponible."; rafraichirBalise(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  E.minuteur = setInterval(baliseEnvoyer, 30000);
  try { navigator.wakeLock?.request("screen").then((l) => { E.verrou = l; }).catch(() => {}); } catch { /* ignoré */ }
  rafraichirBalise();
}
function baliseArreter() {
  const E = baliseEtat; if (E.watch !== null) navigator.geolocation.clearWatch(E.watch);
  E.watch = null; clearInterval(E.minuteur); try { E.verrou?.release(); } catch { /* ignoré */ } E.verrou = null; rafraichirBalise();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && baliseEtat.watch !== null && !baliseEtat.verrou) try { navigator.wakeLock?.request("screen").then((l) => { baliseEtat.verrou = l; }).catch(() => {}); } catch { /* ignoré */ } });
const rafraichirBalise = () => { const z = document.querySelector("#carte-balise"); if (z) z.outerHTML = carteBalise(); };
function carteBalise() {
  const c = baliseCfg(), E = baliseEtat, actif = E.watch !== null;
  return `<div class="card" id="carte-balise"><div class="card-head"><h2>Ma position (balise de secours)</h2>${actif ? badge("Active", "ok") : badge("Arrêtée", "neutral")}</div>
    <p class="hint" style="margin-top:0">Si la balise du camion tombe en panne, ce téléphone envoie sa position au bureau. <strong>Gardez l'écran allumé</strong> et l'application ouverte : le navigateur arrête la localisation quand l'écran s'éteint.</p>
    ${actif || E.file.length || E.envoyees ? `<p class="hint">${E.envoyees} position(s) envoyée(s)${E.file.length ? ` · ${E.file.length} en attente` : ""}${E.derniere ? ` · précision ≈ ${Math.round(E.derniere.precision || 0)} m` : ""}</p>` : ""}
    ${E.erreur ? `<p class="hint" style="color:var(--danger)">${esc(E.erreur)}</p>` : ""}
    <div class="row">${actif ? btn("balise-stop", "Arrêter le partage", { cls: "btn ghost" }) : btn("balise-start", "Partager ma position", { icone: "pin", cls: "btn lg" })}</div>
    <details style="margin-top:12px"><summary style="cursor:pointer">Réglages (à faire par le gestionnaire)</summary>
      <form id="f-balise" style="margin-top:10px"><div class="form-grid">
        <label class="f full">Adresse du relais<input name="url" value="${esc(c.url)}" placeholder="https://suivi.mon-entreprise.ma" inputmode="url" autocomplete="off"></label>
        <label class="f full">Jeton d'écriture<input name="jeton" type="password" value="${esc(c.jeton)}" autocomplete="off"></label>
        <label class="f full">Identifiant envoyé (liez-le au camion dans sa fiche : « balise »)<input name="id" value="${esc(c.id)}" placeholder="TEL-${esc(modeChauffeurLire()?.chauffeurId || "chauffeur")}"></label></div>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn">Enregistrer</button></div></form></details></div>`;
}

/* ---------- preuve de livraison ---------- */
function positionUneFois() {
  return new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) }), () => ok(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }); });
}
async function ouvrirPreuve(voyageId) {
  const v = parId(S.voyages, voyageId); if (!v) return;
  const corps = `${champs([{ name: "signataire", label: "Nom du destinataire", required: true, value: v.pod?.signataire }, { name: "reserves", label: "Réserves (laisser vide si aucune)", type: "textarea", full: true, value: v.pod?.reserves }])}
    <div class="f full" style="margin-top:10px"><span>Signature du destinataire</span>
      <canvas id="sig" width="600" height="220" style="width:100%;max-width:420px;height:auto;aspect-ratio:600/220;border:1px solid var(--border);border-radius:12px;background:#fff;touch-action:none;display:block"></canvas>
      <input type="hidden" name="signature"><button type="button" class="btn ghost sm" id="sig-effacer" style="margin-top:6px">Effacer</button></div>
    <p class="hint">La position et l'heure sont relevées à l'enregistrement. Ce document n'est pas un e-CMR : gardez le CMR papier signé.</p>`;
  const promesse = modale({ titre: `Preuve de livraison — ${v.ref}`, corps, valider: "Enregistrer la preuve" });
  const cv = document.querySelector("#sig"), g = cv.getContext("2d"), champ = document.querySelector("dialog [name=signature]");
  g.lineWidth = 3.2; g.lineCap = "round"; g.strokeStyle = "#111"; let dessine = false, trace = false;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]; };
  cv.onpointerdown = (e) => { dessine = true; trace = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); };
  cv.onpointermove = (e) => { if (!dessine) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); };
  cv.onpointerup = () => { dessine = false; if (trace) champ.value = cv.toDataURL("image/png"); };
  document.querySelector("#sig-effacer").onclick = () => { g.clearRect(0, 0, cv.width, cv.height); champ.value = ""; trace = false; };
  const f = await promesse; if (!f) return;
  if (!f.signature && !(await confirmer("Pas de signature", "Enregistrer la preuve sans signature du destinataire ?", "Enregistrer"))) return;
  const pos = await positionUneFois();
  v.pod = { date: new Date().toISOString(), signataire: f.signataire, reserves: f.reserves, signature: f.signature || "", lat: pos?.lat, lon: pos?.lon, precision: pos?.precision, par: modeChauffeurActif() ? chauffeurCourant()?.nom : "" };
  if (!(v.jalons || []).some((j) => j.type === "livre")) (v.jalons ||= []).push({ type: "livre", date: v.pod.date, source: "preuve" });
  sauver(); toast(`Livraison enregistrée${f.reserves ? " avec réserves" : ""}`); if (typeof partagesSynchroniser === "function") partagesSynchroniser(true); rafraichir();
}
function imprimerPreuve(v) {
  const p = v.pod; if (!p) return;
  const cl = parId(S.clients, v.clientId) || {};
  ouvrirImpression(`Preuve de livraison ${v.ref}`, `${enteteDoc("Preuve de livraison", [`Voyage <strong style="color:#0f172a">${l(v.ref)}</strong>`, `Édité le ${dateFr(dateISO(Date.now()))}`])}
    <h2>Livraison</h2>
    <div class="grille">${champDoc("Itinéraire", `${v.origine} → ${v.destination}`)}${champDoc("Client", cl.nom)}${champDoc("Marchandise", v.marchandise)}${champDoc("Date et heure", dateHeureFr(p.date))}${champDoc("Position relevée", p.lat ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} (± ${p.precision} m)` : "non disponible")}${champDoc("Reçu par", p.signataire)}</div>
    <h2>Réserves</h2><div class="cadre">${p.reserves ? l(p.reserves).replace(/\n/g, "<br>") : "Aucune réserve formulée à la livraison."}</div>
    <h2>Signature du destinataire</h2><div class="cadre" style="min-height:90px">${p.signature ? `<img src="${p.signature}" alt="Signature" style="max-height:120px">` : "Non signée."}</div>
    <p style="font-size:11px;color:#64748b;margin-top:14px">Document de preuve établi par l'application. Il ne remplace pas le CMR : la valeur juridique d'un CMR électronique n'est pas confirmée au Maroc ni en Espagne. Conservez le CMR papier signé.</p>${piedDoc()}`);
}

/* ---------- lettre de voiture CMR (impression préremplie) ---------- */
const CHAMPS_CMR = (v, cl) => [
  { name: "numero", label: "N° de lettre de voiture (CMR)", value: v.cmr?.numero ?? v.cmrNumero },
  { name: "expediteur", label: "1 · Expéditeur (nom, adresse, pays)", type: "textarea", full: true, value: v.cmr?.expediteur },
  { name: "destinataire", label: "2 · Destinataire (nom, adresse, pays)", type: "textarea", full: true, value: v.cmr?.destinataire ?? [cl.nom, cl.adresse, cl.pays].filter(Boolean).join("\n") },
  { name: "livraison", label: "3 · Lieu prévu pour la livraison", value: v.cmr?.livraison ?? v.destination },
  { name: "priseEnCharge", label: "4 · Lieu et date de prise en charge", value: v.cmr?.priseEnCharge ?? `${v.origine}, ${dateFr(v.dateDepart)}` },
  { name: "documents", label: "5 · Documents annexés (EUR.1, DUM, certificats…)", value: v.cmr?.documents },
  { name: "marchandise", label: "6-9 · Marques, nombre de colis, emballage, nature de la marchandise", type: "textarea", full: true, value: v.cmr?.marchandise ?? v.marchandise },
  { name: "poids", label: "11 · Poids brut (kg)", type: "number", min: 0, value: v.cmr?.poids },
  { name: "volume", label: "12 · Cubage (m³)", type: "number", min: 0, value: v.cmr?.volume },
  { name: "instructions", label: "13 · Instructions de l'expéditeur (douane, température…)", type: "textarea", full: true, value: v.cmr?.instructions ?? (Number.isFinite(v.tempMin) ? `Température dirigée : ${v.tempMin} à ${v.tempMax} °C` : "") },
  { name: "conventions", label: "19 · Conventions particulières", value: v.cmr?.conventions },
  { name: "payer", label: "20 · À payer par (expéditeur / destinataire)", value: v.cmr?.payer },
];
async function ouvrirCMR(voyageId) {
  const v = parId(S.voyages, voyageId); if (!v) return;
  const f = await formulaire(`Lettre de voiture CMR — ${v.ref}`, CHAMPS_CMR(v, parId(S.clients, v.clientId) || {}), { valider: "Enregistrer et imprimer", aide: "Les champs sont conservés avec le voyage. Le transporteur (case 16) et les signatures sont imprimés d'après vos réglages ; faites signer les exemplaires papier." });
  if (!f) return;
  v.cmr = { ...f, poids: num(f.poids), volume: num(f.volume) }; if (f.numero) v.cmrNumero = f.numero; sauver(); imprimerCMR(v); rafraichir();
}
function imprimerCMR(v) {
  const c = v.cmr || {}, e = S.entreprise || {}, cam = parId(S.camions, v.camionId) || {};
  const case_ = (n, fr, en, contenu, haut = 56) => `<div class="cadre" style="min-height:${haut}px;padding:6px 8px"><div style="font-size:9px;color:#475569"><b>${n}</b> ${fr} <i>/ ${en}</i></div><div style="font-size:12px;margin-top:2px">${contenu || "&nbsp;"}</div></div>`;
  const br = (x) => l(x || "").replace(/\n/g, "<br>");
  ouvrirImpression(`CMR ${c.numero || v.ref}`, `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div style="font-size:20px;font-weight:700;letter-spacing:.04em">LETTRE DE VOITURE INTERNATIONALE</div><div style="font-size:11px;color:#475569">INTERNATIONAL CONSIGNMENT NOTE — CMR</div></div><div style="text-align:right;font-size:12px">N° <strong>${l(c.numero || "")}</strong><br>Voyage ${l(v.ref)}</div></div>
    <div class="grille" style="margin-top:10px">${case_(1, "Expéditeur (nom, adresse, pays)", "Sender", br(c.expediteur), 70)}${case_(16, "Transporteur (nom, adresse, pays)", "Carrier", `${l(e.nom || "")}<br>${br([e.adresse, e.ville].filter(Boolean).join("\n"))}${e.tel ? "<br>Tél. " + l(e.tel) : ""}`, 70)}
    ${case_(2, "Destinataire (nom, adresse, pays)", "Consignee", br(c.destinataire), 70)}${case_(17, "Transporteurs successifs", "Successive carriers", "", 70)}
    ${case_(3, "Lieu prévu pour la livraison", "Place of delivery", l(c.livraison || ""))}${case_(18, "Réserves et observations du transporteur", "Carrier's reservations", "", 56)}
    ${case_(4, "Lieu et date de prise en charge", "Place and date of taking over", l(c.priseEnCharge || ""))}${case_(19, "Conventions particulières", "Special agreements", l(c.conventions || ""))}
    ${case_(5, "Documents annexés", "Documents attached", l(c.documents || ""))}${case_(20, "À payer par", "To be paid by", l(c.payer || ""))}</div>
    <div class="cadre" style="margin-top:8px;padding:6px 8px;min-height:110px"><div style="font-size:9px;color:#475569"><b>6-12</b> Marques et numéros · Nombre de colis · Mode d'emballage · Nature de la marchandise · Poids brut (kg) · Cubage (m³) <i>/ Marks · Number · Packing · Description · Gross weight · Volume</i></div>
      <div style="display:flex;gap:14px;margin-top:4px;font-size:12px"><div style="flex:1">${br(c.marchandise)}</div><div style="width:110px">${c.poids ? fmt(c.poids) + " kg" : ""}<br>${c.volume ? fmt(c.volume, 1) + " m³" : ""}</div></div></div>
    <div class="grille" style="margin-top:8px">${case_(13, "Instructions de l'expéditeur", "Sender's instructions", br(c.instructions), 60)}${case_(21, "Établi à / le", "Established in / on", `${l(v.origine)}, ${dateFr(v.dateDepart)}`, 60)}</div>
    <div class="grille" style="margin-top:8px">${case_("", "Véhicule", "Vehicle", `${l(cam.immat || "")}${v.remorque ? " / " + l(v.remorque) : ""}`, 40)}${case_("", "Chauffeur", "Driver", l(parId(S.chauffeurs, v.chauffeurId)?.nom || ""), 40)}</div>
    <div class="signatures"><div class="sig"><b>22</b> Signature et cachet de l'expéditeur<br>Sender's signature</div><div class="sig"><b>23</b> Signature et cachet du transporteur<br>Carrier's signature</div><div class="sig"><b>24</b> Réception de la marchandise (lieu, date, signature)<br>Goods received</div></div>
    <p style="font-size:10px;color:#64748b;margin-top:10px">Document préparé par l'application selon les rubriques de la convention CMR (Genève, 1956). Imprimez-le en plusieurs exemplaires et faites-le signer : ce n'est pas une lettre de voiture électronique.</p>`);
}

/* ---------- relevé de télépéage européen ---------- */
function importerReleveEu(voyageId) {
  const v = parId(S.voyages, voyageId); if (!v) return;
  const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,.txt,text/csv,text/plain";
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    const lu = releveEuParse(await f.text());
    if (!lu.ok) return toast(lu.erreur || "Relevé illisible.", "danger");
    const r = peagesEuDepuisReleve(lu.lignes, v.dateDepart, v.dateRetourPrevue);
    if (!r.nb) return toast(`Aucune ligne en euros entre le ${dateFr(v.dateDepart)} et le ${dateFr(v.dateRetourPrevue)} (+ 2 jours).`, "warn");
    const ok = await confirmer("Appliquer ce relevé ?", `${r.nb} passage(s) du ${dateFr(v.dateDepart)} au ${dateFr(v.dateRetourPrevue)} : ${fmt(r.eur, 2)} €${Object.keys(r.pays).length ? " (" + Object.entries(r.pays).map(([p, m]) => `${p} ${fmt(m, 2)} €`).join(", ") + ")" : ""}${r.autresDevises ? ` — ${r.autresDevises} ligne(s) dans une autre devise ignorée(s)` : ""}. Ce montant remplacera l'estimation des péages d'Europe. Vérifiez que le relevé ne contient que ce camion.`, "Appliquer");
    if (!ok) return;
    v.peagesEurReel = r.eur; v.peagesEurPays = r.pays; sauver(); toast(`Péages d'Europe : ${fmt(r.eur, 2)} € (relevé)`); rafraichir();
  };
  input.click();
}

/* ---------- branchement ---------- */
const rendreChauffeurBase = VUES.chauffeur.rendu, agirChauffeurBase = VUES.chauffeur.agir;
VUES.chauffeur.rendu = function () {
  const html = rendreChauffeurBase.call(this), ch = chauffeurCourant();
  const voyages = ch ? S.voyages.filter((v) => v.chauffeurId === ch.id && v.statut === "en_cours") : [];
  const blocs = (voyages.length ? `<div class="section-title">Mon voyage</div>${voyages.map((v) => `<div class="card chf-mission"><div class="chf-route"><span>${esc(v.origine)}</span><span class="fl">⇄</span><span>${esc(v.destination)}</span></div><div class="chf-actions">${btn("preuve", v.pod ? "Preuve enregistrée ✓" : "Preuve de livraison", { id: v.id, icone: "check", cls: "btn lg" })}</div></div>`).join("")}` : "") + (ch ? `<div class="section-title">Position</div>${carteBalise()}` : "");
  const marque = '<div class="row" style="justify-content:center;margin-top:24px">';
  return html.includes(marque) ? html.replace(marque, blocs + marque) : html + blocs;
};
VUES.chauffeur.agir = async function (act, id) {
  if (act === "balise-start") return baliseDemarrer();
  if (act === "balise-stop") return baliseArreter();
  if (act === "preuve") return ouvrirPreuve(id);
  return agirChauffeurBase.call(this, act, id);
};
const soumettreChauffeurBase = VUES.chauffeur.soumettre;
VUES.chauffeur.soumettre = function (fid, v, form) {
  if (fid === "f-balise") { baliseSauver({ url: baseUrl(v.url), jeton: v.jeton, id: v.id }); toast("Réglages enregistrés"); rafraichirBalise(); return true; }
  return soumettreChauffeurBase?.call(this, fid, v, form);
};
const agirVoyagesTerrain = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, bouton) {
  if (act === "preuve") return ouvrirPreuve(String(id).split("|")[0]);
  if (act === "cmr") return ouvrirCMR(String(id).split("|")[0]);
  if (act === "releve-eu") return importerReleveEu(String(id).split("|")[0]);
  if (act === "preuve-imprimer") return imprimerPreuve(parId(S.voyages, String(id).split("|")[0]));
  return agirVoyagesTerrain.call(this, act, id, bouton);
};
