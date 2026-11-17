// Captures de référence : chaque page, sur téléphone et sur bureau, en thème clair et sombre, comparées aux références à chaque livraison.
// Outil de développement (l'application n'en dépend pas) : il faut Playwright (« npm i -D playwright » ou celui déjà installé) et l'application servie (« npm start »).
//   node tests/captures.js              compare aux références (crée celles qui manquent) ; les écarts sont dessinés dans tests/captures/ecarts/
//   node tests/captures.js --accepter   les captures du jour deviennent les références (après avoir regardé les écarts)
//   node tests/captures.js --contre https://eagleyecorp.github.io/logistique/
//                                       compare à la version publiée (la livraison précédente), capturée à la volée : rien à garder entre deux machines
//   options : --url http://localhost:8080/   --pages tableau,voyages
// Données fixes (tests/donnees-captures.js), heure figée, fuseau de Casablanca, animations coupées, aucun appel extérieur (carte, taux du jour) : deux passages identiques donnent les mêmes images.
// Les polices du texte viennent du système : comparer sur la même machine que les références (--contre capture les deux côtés au même endroit).
// Les références (une centaine d'images) restent sur la machine : tests/captures/ n'est pas versionné.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const donnees = require("./donnees-captures.js");

const arg = (nom, defaut) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : defaut; };
const URL_APP = arg("--url", "http://localhost:8080/"), ACCEPTER = process.argv.includes("--accepter"), CONTRE = arg("--contre", "");
const DOSSIER = path.join(__dirname, "captures"), ECARTS = path.join(DOSSIER, "ecarts");
const MAINTENANT = Date.parse("2026-11-17T09:00:00+01:00"); // un mardi matin
const APPAREILS = { telephone: { width: 390, height: 844 }, bureau: { width: 1280, height: 900 } };
const THEMES = ["clair", "sombre"];
const HAUTEUR_MAX = 2600; // pixels : le haut de chaque page suffit à voir une régression
const SEUIL_CANAL = 12, PART_TOLEREE = 0.0005; // un pixel diffère si un canal bouge de plus de 12 (un bleu plus foncé se voit) ; écart si plus de 0,05 % des pixels diffèrent

async function comparer(page, avant, apres) {
  return page.evaluate(async ([a, b, seuil]) => {
    const charger = (b64) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = "data:image/png;base64," + b64; });
    const [ia, ib] = await Promise.all([charger(a), charger(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { taille: `${ia.width}×${ia.height} → ${ib.width}×${ib.height}` };
    const toile = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return { c, x, d: x.getImageData(0, 0, c.width, c.height) }; };
    const A = toile(ia), B = toile(ib), sortie = B.x.createImageData(B.c.width, B.c.height);
    let diff = 0;
    for (let p = 0; p < A.d.data.length; p += 4) {
      const ecart = Math.max(Math.abs(A.d.data[p] - B.d.data[p]), Math.abs(A.d.data[p + 1] - B.d.data[p + 1]), Math.abs(A.d.data[p + 2] - B.d.data[p + 2]));
      if (ecart > seuil) { diff++; sortie.data.set([230, 0, 40, 255], p); }
      else { const g = (B.d.data[p] + B.d.data[p + 1] + B.d.data[p + 2]) / 3; sortie.data.set([g, g, g, 60], p); }
    }
    let image = "";
    if (diff) { B.x.putImageData(sortie, 0, 0); image = B.c.toDataURL("image/png").split(",")[1]; }
    return { diff, part: diff / (A.d.data.length / 4), image };
  }, [avant.toString("base64"), apres.toString("base64"), SEUIL_CANAL]);
}

/** Captures d'une variante (appareil × thème) de l'application servie à `url` : Map nom → image PNG. */
async function capturerVariante(navigateur, url, appareil, viewport, theme, etat, erreurs) {
  const ctx = await navigateur.newContext({ viewport, colorScheme: theme === "sombre" ? "dark" : "light", reducedMotion: "reduce", locale: "fr-FR", timezoneId: "Africa/Casablanca", serviceWorkers: "block" });
  const page = await ctx.newPage(), images = new Map();
  page.on("pageerror", (e) => erreurs.add(`${url} ${appareil}/${theme} : ${e.message}`));
  await page.clock.setFixedTime(MAINTENANT);
  const origine = new URL(url).origin; // rien d'autre ne sort : ni tuiles de carte, ni taux du jour, ni itinéraires (les chiffres bougeraient)
  await page.route((u) => u.origin !== origine, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => typeof S !== "undefined" && S.meta && typeof afficher === "function", null, { timeout: 30000 });
  const pages = await page.evaluate(([e, t]) => {
    document.getElementById("assistant")?.close();
    Object.assign(S, e, { params: { ...S.params, ...(e.params || {}) } }); sauver(); // réglages : ceux de démonstration par-dessus les valeurs par défaut, comme au chargement
    document.documentElement.dataset.theme = t === "sombre" ? "dark" : "light";
    return Object.keys(VUES);
  }, [etat, theme]);
  const voulues = arg("--pages", "") ? arg("--pages").split(",").filter((x) => pages.includes(x)) : pages;
  const capturer = async (nom) => {
    const hauteur = await page.evaluate(() => document.documentElement.scrollHeight);
    images.set(`${nom}-${appareil}-${theme}`, await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", clip: { x: 0, y: 0, width: viewport.width, height: Math.min(hauteur, HAUTEUR_MAX) } }));
  };
  for (const pg of voulues.filter((x) => x !== "chauffeur")) {
    await page.evaluate((x) => {
      document.querySelectorAll("dialog[open]").forEach((d) => d.close());
      document.getElementById("toasts")?.replaceChildren();
      if (x === "voyages") voyagesOuverts.add("v1");
      afficher(x); scrollTo(0, 0);
    }, pg);
    await page.waitForTimeout(250);
    await capturer(pg);
  }
  if (voulues.includes("chauffeur")) { // le mode chauffeur (téléphone du chauffeur Youssef) : il s'ouvre au démarrage
    await page.evaluate(() => localStorage.setItem("logistique-mode", JSON.stringify({ chauffeurId: "h1" })));
    await page.reload();
    await page.waitForFunction(() => typeof S !== "undefined" && S.meta && ongletActif === "chauffeur", null, { timeout: 30000 });
    await page.evaluate((t) => { document.getElementById("assistant")?.close(); document.getElementById("toasts")?.replaceChildren(); document.documentElement.dataset.theme = t === "sombre" ? "dark" : "light"; rafraichir(); scrollTo(0, 0); }, theme);
    await page.waitForTimeout(250);
    await capturer("chauffeur");
  }
  await ctx.close();
  return images;
}

(async () => {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const navigateur = await chromium.launch(), etat = donnees(MAINTENANT), erreurs = new Set();
  const bilan = { identiques: 0, nouvelles: [], ecarts: [], seules: [] };
  const toile = await (await navigateur.newContext()).newPage(); // page vierge pour comparer les images
  const noterEcart = (nom, image, r) => {
    fs.mkdirSync(ECARTS, { recursive: true }); fs.writeFileSync(path.join(ECARTS, `${nom}.png`), image);
    if (r.image) fs.writeFileSync(path.join(ECARTS, `${nom}.ecart.png`), Buffer.from(r.image, "base64"));
    bilan.ecarts.push(`${nom} : ${r.taille ? `taille ${r.taille}` : `${(r.part * 100).toFixed(2)} % des pixels`}`);
  };
  if (fs.existsSync(ECARTS)) for (const f of fs.readdirSync(ECARTS)) fs.unlinkSync(path.join(ECARTS, f)); // écarts du passage précédent
  for (const [appareil, viewport] of Object.entries(APPAREILS)) for (const theme of THEMES) {
    const images = await capturerVariante(navigateur, URL_APP, appareil, viewport, theme, etat, erreurs);
    const references = CONTRE ? await capturerVariante(navigateur, CONTRE, appareil, viewport, theme, etat, erreurs) : null;
    for (const [nom, image] of images) {
      const fichier = path.join(DOSSIER, `${nom}.png`);
      if (!CONTRE && (ACCEPTER || !fs.existsSync(fichier))) { fs.writeFileSync(fichier, image); if (!ACCEPTER) bilan.nouvelles.push(nom); continue; }
      const ref = CONTRE ? references.get(nom) : fs.readFileSync(fichier);
      if (!ref) { bilan.seules.push(nom); continue; }
      const r = await comparer(toile, ref, image);
      if (r.taille || r.part > PART_TOLEREE) noterEcart(nom, image, r); else bilan.identiques++;
    }
  }
  await navigateur.close();
  if (ACCEPTER) console.log(`Références remplacées (${fs.readdirSync(DOSSIER).filter((f) => f.endsWith(".png")).length} images).`);
  else {
    console.log(`${bilan.identiques} capture(s) identique(s) ${CONTRE ? `à ${CONTRE}` : "aux références"}.`);
    if (bilan.nouvelles.length) console.log(`${bilan.nouvelles.length} nouvelle(s) référence(s) : ${bilan.nouvelles.join(", ")}`);
    if (bilan.seules.length) console.log(`Pages absentes de la référence : ${bilan.seules.join(", ")}`);
    if (bilan.ecarts.length) { console.log(`\n${bilan.ecarts.length} écart(s) — à regarder dans tests/captures/ecarts/ (capture du jour, et pixels changés en rouge)${CONTRE ? "" : ", puis --accepter si voulu"} :\n  ${bilan.ecarts.join("\n  ")}`); process.exitCode = 1; }
  }
  if (erreurs.size) { console.log(`\nErreurs dans la page :\n  ${[...erreurs].join("\n  ")}`); process.exitCode = 1; }
})();
