// Tests de la logique métier et des modules purs : npm test
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const racine = path.join(__dirname, "..");
// Le contexte reçoit les constructeurs de Node : les octets circulent sans conflit entre « royaumes » JavaScript.
const ctx = vm.createContext({
  console, crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, ArrayBuffer, DataView, Blob, Response,
  setTimeout, clearTimeout, indexedDB: undefined,
});
for (const f of ["data.js", "noyau.js", "ia.js", "stockage.js", "sauvegarde.js"]) vm.runInContext(fs.readFileSync(path.join(racine, f), "utf8"), ctx, { filename: f });
vm.runInContext("function libIntervention(t) { return t; }", ctx); // défini par app.js (interface)
// N.xxx lit n'importe quelle déclaration de premier niveau ; N.S = … remplace l'état.
const N = new Proxy({}, {
  get: (_, k) => vm.runInContext(k, ctx),
  set: (_, k, v) => { ctx.__valeur = v; vm.runInContext(`${k} = __valeur`, ctx); return true; },
});

const tests = [];
const test = (nom, fn) => tests.push([nom, fn]);
const jour = (n) => N.dateISO(Date.now() + n * 86400000);

test("num accepte la virgule et les espaces", () => {
  assert.strictEqual(N.num("11,5"), 11.5);
  assert.strictEqual(N.num("1 200"), 1200);
  assert.strictEqual(N.num("", 7), 7);
});

test("consommation plein à plein, pleins partiels cumulés", () => {
  N.S.pleins = [
    { id: "a", camionId: "c", km: 1000, litres: 500, plein: true },
    { id: "b", camionId: "c", km: 1500, litres: 100, plein: false },
    { id: "c", camionId: "c", km: 2000, litres: 230, plein: true },
  ];
  const r = N.consommations("c");
  assert.strictEqual(Object.keys(r).length, 1);
  assert.strictEqual(r.c, 33); // (100 + 230) L / 1000 km
});

test("aucune consommation avant le premier plein complet", () => {
  N.S.pleins = [
    { id: "a", camionId: "c", km: 1000, litres: 80, plein: false },
    { id: "b", camionId: "c", km: 1500, litres: 300, plein: true },
  ];
  assert.deepStrictEqual({ ...N.consommations("c") }, {});
  assert.strictEqual(N.consoMoyenne("c"), null);
});

test("échéances vidange et pneus", () => {
  N.S.params.alerteKm = 2000;
  const e = N.etatCamion({ km: 100000, kmVidange: 61000, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 90000 });
  const vid = e.find((x) => x.type === "Vidange"), pn = e.find((x) => x.type === "Pneus");
  assert.strictEqual(vid.niveau, "warn"); assert.strictEqual(vid.reste, 1000);
  assert.strictEqual(pn.niveau, "danger"); assert.strictEqual(pn.reste, -10000);
});

test("papiers expirés et bientôt expirés", () => {
  const e = N.etatCamion({ km: 0, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000, assurance: jour(-1), visite: jour(10) });
  assert.strictEqual(e.find((x) => x.type === "Assurance").niveau, "danger");
  assert.strictEqual(e.find((x) => x.type === "Visite technique").niveau, "warn");
});

test("chauffeur : amplitude dépassée, repos, permis", () => {
  const maintenant = Date.now();
  assert.strictEqual(N.etatChauffeur({ debutService: new Date(maintenant - 14 * 3600000).toISOString() }).code, "depasse");
  assert.strictEqual(N.etatChauffeur({ debutService: new Date(maintenant - 2 * 3600000).toISOString() }).dispo, true);
  assert.strictEqual(N.etatChauffeur({ reposJusqua: new Date(maintenant + 3600000).toISOString() }).code, "repos");
  assert.strictEqual(N.etatChauffeur({ reposJusqua: new Date(maintenant - 3600000).toISOString() }).dispo, true);
  assert.strictEqual(N.etatChauffeur({ permis: jour(-1) }).code, "permis");
});

test("trajet court : une pause, pas de repos de nuit", () => {
  const r = N.calculTrajet({ distance: 350, peage: 200, conso: 30, prix: 10 });
  assert.strictEqual(r.litres, 105);
  assert.strictEqual(r.coutTotal, 1250);
  assert.strictEqual(r.heuresConduite, 5);
  assert.strictEqual(r.pauses, 1);
  assert.strictEqual(r.jours, 1);
  assert.strictEqual(r.reposNuit, 0);
});

test("trajet long : découpé en jours avec repos de nuit", () => {
  const r = N.calculTrajet({ distance: 1400, conso: 30, prix: 10 }); // 20 h de conduite
  assert.strictEqual(r.jours, 3);
  assert.strictEqual(r.reposNuit, 2);
  assert.strictEqual(r.pauses, 1 + 1 + 0); // 9 h, 9 h, 2 h
  assert.strictEqual(r.dureeTotale, 20 + 2 * 0.75 + 2 * 11);
});

test("exactement 9 h de conduite = 1 jour", () => {
  const r = N.calculTrajet({ distance: 630, conso: 30, prix: 10 });
  assert.strictEqual(r.jours, 1);
  assert.strictEqual(r.pauses, 1);
});

test("dépenses hebdomadaires", () => {
  N.S.pleins = [{ id: "p", camionId: "c", date: N.today(), km: 1, litres: 100, prix: 11, plein: true }];
  N.S.interventions = [{ id: "i", camionId: "c", date: N.today(), km: 1, cout: 500 }];
  const s = N.depensesHebdo(8);
  assert.strictEqual(s.length, 8);
  assert.strictEqual(s[7].gasoil, 1100);
  assert.strictEqual(s[7].entretien, 500);
});

test("alertes : anomalie de consommation et double responsable", () => {
  N.S.camions = [{ id: "c", immat: "X", km: 4000, kmVidange: 4000, intervalleVidange: 40000, kmPneus: 4000, intervallePneus: 100000 }];
  N.S.pleins = [
    { id: "a", camionId: "c", km: 1000, litres: 300, plein: true },
    { id: "b", camionId: "c", km: 2000, litres: 300, plein: true },
    { id: "d", camionId: "c", km: 3000, litres: 300, plein: true },
    { id: "e", camionId: "c", km: 4000, litres: 450, plein: true },
  ];
  N.S.chauffeurs = [{ id: "1", nom: "A", camionId: "c" }, { id: "2", nom: "B", camionId: "c" }];
  N.S.meta.derniereSauvegarde = new Date().toISOString();
  const t = N.alertes().map((a) => a.texte).join("\n");
  assert.match(t, /conso 45/);
  assert.match(t, /plusieurs responsables/);
});

test("alerte de sauvegarde si jamais exporté", () => {
  N.S.camions = [{ id: "c", immat: "X", km: 0, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000 }];
  assert.ok(N.alertes().some((a) => a.onglet === "parametres"));
});

const reponseIA = (extra = {}) => ({
  model: "claude-opus-5-5", stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 2000 },
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ comprehension: "Plaquettes de frein", suggestions: [{ code_sh6: "8708.30", code_national: "", designation: "Freins et servo-freins", confiance: "elevee", justification: "RGI 1", points_a_verifier: [] }], questions: [], controles: [] }) }],
  ...extra,
});

test("IA : réponse valide interprétée, coût calculé", () => {
  const r = N.iaInterpreter(reponseIA(), "claude-opus-5-5");
  assert.strictEqual(r.suggestions[0].code_sh6, "8708.30");
  assert.strictEqual(r.secours, false);
  assert.ok(Math.abs(r.cout - (1000 * 4 + 2000 * 20) / 1e6) < 1e-12);
});

test("IA : réponse servie par le modèle de secours signalée", () => {
  const r = N.iaInterpreter(reponseIA({ model: "claude-opus-4-8" }), "claude-opus-5-5");
  assert.strictEqual(r.secours, true);
  assert.strictEqual(r.modele, "claude-opus-4-8");
});

test("IA : refus, réponse coupée et JSON invalide donnent une erreur lisible", () => {
  assert.throws(() => N.iaInterpreter(reponseIA({ stop_reason: "refusal", content: [] }), "x"), /refusé/);
  assert.throws(() => N.iaInterpreter(reponseIA({ stop_reason: "max_tokens" }), "x"), /coupée/);
  assert.throws(() => N.iaInterpreter(reponseIA({ content: [{ type: "text", text: "{pas du json" }] }), "x"), /illisible/);
});

test("IA : schéma strict (tous les champs requis, pas de champ libre)", () => {
  const verifier = (o) => {
    if (o.type === "object") {
      assert.strictEqual(o.additionalProperties, false);
      assert.deepStrictEqual([...o.required].sort(), Object.keys(o.properties).sort());
      Object.values(o.properties).forEach(verifier);
    }
    if (o.type === "array") verifier(o.items);
  };
  verifier(N.IA_SCHEMA);
});

test("commande : marge avec trajet lié, frais et conversion EUR", () => {
  N.S.params.tauxEUR = 10;
  N.S.trajets = [{ id: "t", calcul: { coutTotal: 5000 } }];
  const c = { prix: 2000, devise: "EUR", trajetId: "t", ferry: 6000, fraisChauffeur: 2000, autres: 500 };
  assert.strictEqual(N.versMAD(100, "EUR"), 1000);
  assert.strictEqual(N.coutCommande(c), 13500);
  const m = N.margeCommande(c);
  assert.strictEqual(m.prix, 20000);
  assert.strictEqual(m.marge, 6500);
  assert.strictEqual(m.taux, 32.5);
});

test("facture : totaux HT / TVA / TTC", () => {
  const t = N.totauxFacture({ tva: 14, lignes: [{ montant: 1000 }, { montant: "500" }] });
  assert.deepStrictEqual({ ...t }, { ht: 1500, tva: 210, ttc: 1710 });
});

test("numérotation séquentielle par année", () => {
  const l = [{ n: "FAC-2026-0007" }, { n: "FAC-2026-0002" }, { n: "FAC-2025-0040" }, { n: "autre" }];
  assert.strictEqual(N.prochainNumero("FAC", l, "n", "2026"), "FAC-2026-0008");
  assert.strictEqual(N.prochainNumero("FAC", l, "n", "2027"), "FAC-2027-0001");
});

test("facture en retard, encours et alertes", () => {
  N.S.params.tauxEUR = 10;
  N.S.clients = [{ id: "k", nom: "Client" }];
  N.S.factures = [
    { id: "a", numero: "FAC-1", clientId: "k", devise: "EUR", tva: 0, statut: "emise", echeance: jour(-3), lignes: [{ montant: 100 }] },
    { id: "b", numero: "FAC-2", clientId: "k", devise: "MAD", tva: 0, statut: "emise", echeance: jour(10), lignes: [{ montant: 500 }] },
    { id: "c", numero: "FAC-3", clientId: "k", devise: "MAD", tva: 0, statut: "payee", echeance: jour(-30), lignes: [{ montant: 9999 }] },
  ];
  assert.strictEqual(N.etatFacture(N.S.factures[0]).code, "retard");
  assert.strictEqual(N.etatFacture(N.S.factures[2]).code, "payee");
  assert.deepStrictEqual({ ...N.encoursClients() }, { total: 1500, retard: 1000 });
  N.S.commandes = [
    { id: "o", ref: "CMD-1", statut: "livre", factureId: null },
    { id: "p", ref: "CMD-2", statut: "confirme", dateChargement: N.today(), chauffeurId: "", camionId: "" },
  ];
  N.S.meta.derniereSauvegarde = new Date().toISOString();
  const t = N.alertes().map((a) => a.texte).join("\n");
  assert.match(t, /FAC-1.*en retard de 3 j/);
  assert.match(t, /CMD-1 livrée — à facturer/);
  assert.match(t, /CMD-2 — chargement aujourd'hui/);
  assert.doesNotMatch(t, /FAC-2|FAC-3/);
});

test("documents internationaux : visa et carte conducteur", () => {
  N.S.params.alerteJours = 30;
  N.S.chauffeurs = [{ id: "h", nom: "Ali", visa: jour(5), carteConducteur: jour(-1), permis: jour(-2) }];
  N.S.camions = [{ id: "c", immat: "X", km: 0, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000, carteVerte: jour(-1) }];
  N.S.meta.derniereSauvegarde = new Date().toISOString();
  const t = N.alertes().map((a) => a.texte).join("\n");
  assert.match(t, /Visa Schengen : échéance dans 5 j/);
  assert.match(t, /Carte conducteur : échéance dépassée de 1 j/);
  assert.match(t, /Carte verte expirée/);
  assert.strictEqual((t.match(/ermis/g) || []).length, 1); // permis expiré signalé une seule fois
});

test("activité : CA et marge des livraisons récentes", () => {
  N.S.params.tauxEUR = 10;
  N.S.trajets = [];
  N.S.commandes = [
    { statut: "livre", dateLivraison: jour(-5), prix: 100, devise: "EUR", ferry: 400 },
    { statut: "livre", dateLivraison: jour(-60), prix: 999, devise: "EUR" },
    { statut: "transit", dateLivraison: jour(-1), prix: 999, devise: "EUR" },
  ];
  const a = N.activiteDepuis(jour(-30));
  assert.strictEqual(a.nb, 1); assert.strictEqual(a.ca, 1000); assert.strictEqual(a.marge, 600);
});



/* ============================================================
   Sécurité des données : migration, ZIP, chiffrement, sauvegarde, CSV
   ============================================================ */
test("migration : données de la v1 (sans version ni identifiants)", () => {
  const brut = { camions: [{ immat: "A" }, null, { immat: "B", id: "x" }], chauffeurs: [{ nom: "Ali" }], params: { prixGasoil: 12 } };
  const r = N.migrer(brut);
  assert.strictEqual(r.depuis, 1); assert.strictEqual(r.migre, true);
  assert.strictEqual(r.etat.meta.version, N.VERSION_SCHEMA);
  assert.strictEqual(r.etat.camions.length, 2); // l'entrée nulle est écartée
  assert.ok(r.etat.camions.every((c) => c.id) && r.etat.chauffeurs[0].id);
  assert.strictEqual(r.etat.params.prixGasoil, 12);
  assert.strictEqual(r.etat.params.rappelSauvegarde, 7); // nouveau paramètre complété
  assert.strictEqual(r.etat.meta.onboarde, true); // un utilisateur existant ne revoit pas l'assistant
  assert.deepStrictEqual([r.etat.clients, r.etat.commandes, r.etat.factures].map((x) => x.length), [0, 0, 0]);
});

test("migration : idempotente, vide, absurde, trop récente", () => {
  const une = N.migrer({ camions: [{ immat: "A" }] }).etat;
  const deux = N.migrer(JSON.parse(JSON.stringify(une)));
  assert.strictEqual(deux.migre, false); assert.strictEqual(deux.etat.camions[0].id, une.camions[0].id);
  assert.strictEqual(N.migrer({}).etat.meta.onboarde, undefined); // nouvel utilisateur : l'assistant s'affichera
  for (const x of [null, undefined, "texte", 12, [1, 2]]) assert.strictEqual(N.migrer(x).etat.meta.version, N.VERSION_SCHEMA);
  const futur = N.migrer({ meta: { version: 99 }, camions: [{ id: "c", immat: "A" }] });
  assert.strictEqual(futur.tropRecent, true); assert.strictEqual(futur.etat.meta.version, 99); // jamais rétrogradé
});

test("résumé des données", () => {
  assert.strictEqual(N.libResume(N.resumeDonnees({ camions: [1, 2, 3], commandes: [1] })), "3 camions · 1 commande");
  assert.strictEqual(N.libResume(N.resumeDonnees({})), "aucune donnée");
});

test("CRC32 de référence", () => assert.strictEqual(N.crc32(new TextEncoder().encode("123456789")), 0xcbf43926));

test("ZIP : aller-retour, noms accentués, contenu binaire", async () => {
  const bin = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  const z = N.zipCreer([{ nom: "donnees.json", donnees: new TextEncoder().encode('{"é":"à"}') }, { nom: "photos/été.jpg", donnees: bin }, { nom: "vide.txt", donnees: new Uint8Array(0) }]);
  assert.strictEqual(z[0], 0x50); assert.strictEqual(z[1], 0x4b);
  const l = await N.zipLire(z);
  assert.deepStrictEqual([...l.map((x) => x.nom)], ["donnees.json", "photos/été.jpg", "vide.txt"]);
  assert.strictEqual(new TextDecoder().decode(l[0].donnees), '{"é":"à"}');
  assert.ok(l[1].donnees.every((v, i) => v === bin[i]) && l[1].donnees.length === 70000);
  assert.strictEqual(l[2].donnees.length, 0);
  await assert.rejects(() => N.zipLire(new Uint8Array(100)), /ZIP invalide/);
});

test("chiffrement : aller-retour, mauvais mot de passe, altération", async () => {
  const clair = new TextEncoder().encode("données confidentielles");
  const c = await N.chiffrer(clair, "secret-123");
  assert.ok(N.estChiffre(c) && !N.estChiffre(clair));
  assert.strictEqual(new TextDecoder().decode(await N.dechiffrer(c, "secret-123")), "données confidentielles");
  await assert.rejects(() => N.dechiffrer(c, "autre"), /Mot de passe incorrect/);
  const abime = c.slice(); abime[abime.length - 1] ^= 1;
  await assert.rejects(() => N.dechiffrer(abime, "secret-123"), /Mot de passe incorrect|endommagé/);
  assert.notDeepStrictEqual([...(await N.chiffrer(clair, "secret-123"))], [...c]); // sel et IV aléatoires
});

test("sauvegarde : JSON, enveloppe, et import d'un ancien export brut", async () => {
  N.S = N.migrer({ camions: [{ id: "c1", immat: "123-A-4" }], entreprise: { nom: "Atlas" } }).etat;
  const r = await N.sauvegardeConstruire({ photos: false });
  assert.ok(r.nom.endsWith(".json") && !r.chiffre);
  const txt = JSON.parse(new TextDecoder().decode(r.octets));
  assert.strictEqual(txt.format, "logistique-fret"); assert.strictEqual(txt.etat.camions[0].immat, "123-A-4");
  const lu = await N.sauvegardeLire(r.octets);
  assert.strictEqual(lu.etat.entreprise.nom, "Atlas"); assert.strictEqual(lu.avecPhotos, false);
  const ancien = await N.sauvegardeLire(new TextEncoder().encode(JSON.stringify({ camions: [{ immat: "X" }], chauffeurs: [] })));
  assert.strictEqual(ancien.depuis, 1); assert.strictEqual(ancien.etat.camions[0].immat, "X"); assert.ok(ancien.etat.camions[0].id);
});

test("sauvegarde chiffrée : mot de passe exigé", async () => {
  N.S = N.migrer({ camions: [{ id: "c1", immat: "Z" }] }).etat;
  const r = await N.sauvegardeConstruire({ photos: false, mdp: "motdepasse" });
  assert.ok(r.chiffre && r.nom.endsWith(".lfs") && N.estChiffre(r.octets));
  await assert.rejects(() => N.sauvegardeLire(r.octets), (e) => e.chiffre === true);
  await assert.rejects(() => N.sauvegardeLire(r.octets, "faux"), /Mot de passe incorrect/);
  assert.strictEqual((await N.sauvegardeLire(r.octets, "motdepasse")).etat.camions[0].immat, "Z");
});

test("sauvegarde : fichiers invalides refusés avec un message clair", async () => {
  const t = (x) => new TextEncoder().encode(x);
  await assert.rejects(() => N.sauvegardeLire(t("pas du json")), /illisible/);
  await assert.rejects(() => N.sauvegardeLire(t('{"a":1}')), /invalide/);
  await assert.rejects(() => N.sauvegardeLire(N.zipCreer([{ nom: "autre.txt", donnees: t("x") }])), /donnees\.json/);
});

test("clé de l'assistant IA jamais dans la sauvegarde", async () => {
  N.S = N.etatVide();
  const r = await N.sauvegardeConstruire({ photos: false });
  assert.doesNotMatch(new TextDecoder().decode(r.octets), /sk-ant|"cle"/);
});

test("CSV Excel : BOM, séparateur ;, virgule décimale, guillemets", () => {
  const c = N.lignesVersCSV([{ nom: 'Dupont "Jr"', montant: 12.5, n: 3, vide: null }]);
  assert.strictEqual(c.charCodeAt(0), 0xfeff);
  assert.strictEqual(c.slice(1), '"nom";"montant";"n";"vide"\r\n"Dupont ""Jr""";"12,5";"3";""'.replace('"12,5"', '"12,5"'));
  assert.strictEqual(N.lignesVersCSV([]), "");
});

test("tables CSV et ZIP : commandes avec marge, factures, noms lisibles", async () => {
  N.S = N.etatVide();
  N.S.params.tauxEUR = 10;
  N.S.clients = [{ id: "k", nom: "Souss Export", delai: 30 }];
  N.S.commandes = [{ id: "o", ref: "CMD-1", clientId: "k", statut: "livre", prix: 100, devise: "EUR", ferry: 400, origine: "Agadir", destination: "Paris", jalons: [] }];
  N.S.factures = [{ id: "f", numero: "FAC-1", clientId: "k", devise: "EUR", tva: 20, statut: "emise", echeance: jour(10), lignes: [{ montant: 100 }] }];
  const t = N.tablesCSV();
  assert.strictEqual(t.commandes[0].client, "Souss Export"); assert.strictEqual(t.commandes[0].marge_mad, 600); assert.strictEqual(t.commandes[0].statut, "Livrée");
  assert.strictEqual(t.factures[0].total_ttc, 120); assert.strictEqual(t.factures[0].statut, "à encaisser");
  const z = N.csvZipConstruire();
  assert.strictEqual(z.nbTables, 3);
  assert.deepStrictEqual([...(await N.zipLire(z.octets)).map((f) => f.nom)].sort(), ["clients.csv", "commandes.csv", "factures.csv"]);
});

/* ============================================================
   Rappels (notifications), service du chauffeur, étapes de commande
   ============================================================ */
test("alertes : catégorie et clé stables pour chaque alerte", () => {
  N.S = N.etatVide();
  N.S.camions = [{ id: "c1", immat: "X", km: 100, kmVidange: 100, intervalleVidange: 40000, kmPneus: 100, intervallePneus: 100000, assurance: jour(-2) }];
  N.S.chauffeurs = [{ id: "h1", nom: "Ali", visa: jour(5) }];
  N.S.factures = [{ id: "f1", numero: "FAC-1", clientId: "", devise: "MAD", tva: 0, statut: "emise", echeance: jour(-4), lignes: [{ montant: 1 }] }];
  const a = N.alertes();
  const par = (cle) => a.find((x) => x.cle === cle);
  assert.strictEqual(par("docs:cam:c1:Assurance").cat, "docs");
  assert.strictEqual(par("docs:ch:h1:visa").niveau, "warn");
  assert.strictEqual(par("fac:f1").cat, "factures");
  assert.strictEqual(par("sauvegarde").cat, "sauvegarde");
  assert.ok(a.every((x) => x.cle && x.cat));
  const apres = N.alertes().map((x) => x.cle).sort().join();
  assert.strictEqual(apres, a.map((x) => x.cle).sort().join()); // clés identiques d'un appel à l'autre
});

test("chauffeur bientôt en repos obligatoire", () => {
  N.S = N.etatVide();
  N.S.chauffeurs = [{ id: "h1", nom: "Ali", debutService: new Date(Date.now() - 12.5 * 3600000).toISOString() }];
  const a = N.alertes().find((x) => x.cat === "repos");
  assert.ok(a && a.niveau === "warn" && /repos obligatoire dans/.test(a.texte));
});

test("notifications : désactivées, catégories, déduplication", () => {
  const liste = [
    { niveau: "danger", cat: "factures", cle: "fac:1", texte: "Facture 1", onglet: "factures" },
    { niveau: "warn", cat: "docs", cle: "docs:1", texte: "Assurance", onglet: "camions" },
    { niveau: "warn", cat: "autre", cle: "conso:1", texte: "Conso", onglet: "carburant" },
  ];
  const J = "2026-11-10";
  assert.strictEqual(N.notificationsAEnvoyer(liste, { actif: false }, {}, J).items.length, 0);
  const r = N.notificationsAEnvoyer(liste, { actif: true }, {}, J);
  assert.strictEqual(r.items.length, 2); // 1 urgente + 1 résumé ; la catégorie « autre » n'est jamais notifiée
  assert.deepStrictEqual([...r.cles].sort(), ["docs:1", "fac:1"]);
  assert.strictEqual(r.items[0].tag, "fac:1"); assert.strictEqual(r.items[1].tag, "resume");
  assert.strictEqual(N.notificationsAEnvoyer(liste, { actif: true, cats: { factures: false } }, {}, J).items.length, 1);
  // déjà notifié aujourd'hui : rien ; urgent rappelé le lendemain, « à surveiller » seulement au bout de 3 jours
  const deja = { "fac:1": J, "docs:1": J };
  assert.strictEqual(N.notificationsAEnvoyer(liste, { actif: true }, deja, J).items.length, 0);
  assert.deepStrictEqual(N.notificationsAEnvoyer(liste, { actif: true }, deja, "2026-11-11").items.map((i) => i.tag), ["fac:1"]);
  assert.deepStrictEqual(N.notificationsAEnvoyer(liste, { actif: true }, deja, "2026-11-13").items.map((i) => i.tag), ["fac:1", "resume"]);
});

test("notifications : au plus 3 urgentes + un résumé", () => {
  const liste = Array.from({ length: 6 }, (_, i) => ({ niveau: i < 5 ? "danger" : "warn", cat: "commandes", cle: `c${i}`, texte: `Texte ${i}`, onglet: "commandes" }));
  const r = N.notificationsAEnvoyer(liste, { actif: true }, {}, "2026-11-10");
  assert.strictEqual(r.items.length, 4);
  assert.strictEqual(r.items.filter((i) => i.tag !== "resume").length, 3);
  assert.match(r.items[3].titre, /3 points/); // 2 urgentes restantes + 1 à surveiller
  assert.strictEqual(r.cles.length, 6);
});

test("service du chauffeur : prise de service puis repos", () => {
  N.S = N.etatVide(); N.S.params.reposMinHeures = 11;
  const ch = { id: "h", nom: "Ali" };
  const t0 = Date.parse("2026-11-10T06:00:00Z");
  N.prendreService(ch, t0);
  assert.strictEqual(ch.debutService, "2026-11-10T06:00:00.000Z"); assert.strictEqual(ch.reposJusqua, null);
  N.finDeService(ch, t0 + 9 * 3600000);
  assert.strictEqual(ch.debutService, null); assert.strictEqual(ch.reposJusqua, "2026-11-11T02:00:00.000Z");
  assert.strictEqual(N.etatChauffeur(ch, t0 + 10 * 3600000).code, "repos");
  assert.strictEqual(N.etatChauffeur(ch, t0 + 21 * 3600000).dispo, true);
});

test("commande : étapes, jalons horodatés, trajet lié et kilométrage", () => {
  N.S = N.etatVide();
  N.S.camions = [{ id: "c", immat: "X", km: 1000 }];
  N.S.trajets = [{ id: "t", camionId: "c", distance: 500, statut: "planifie" }];
  const c = { id: "o", statut: "confirme", trajetId: "t", jalons: [] };
  N.appliquerEtape(c, "charge", new Date("2026-11-10T08:00:00Z"));
  assert.strictEqual(N.S.trajets[0].statut, "encours");
  N.appliquerEtape(c, "transit"); N.appliquerEtape(c, "douane");
  N.appliquerEtape(c, "livre", new Date("2026-11-12T16:00:00Z"));
  assert.strictEqual(c.statut, "livre"); assert.strictEqual(c.dateLivraison, "2026-11-12");
  assert.strictEqual(N.S.trajets[0].statut, "termine"); assert.strictEqual(N.S.camions[0].km, 1500);
  assert.deepStrictEqual(c.jalons.map((j) => j.statut), ["charge", "transit", "douane", "livre"]);
  N.appliquerEtape(c, "livre"); // une livraison répétée ne double pas le kilométrage
  assert.strictEqual(N.S.camions[0].km, 1500);
});

test("missions d'un chauffeur : tri par avancement, trajets isolés", () => {
  N.S = N.etatVide();
  N.S.commandes = [
    { id: "a", chauffeurId: "h", statut: "confirme", dateChargement: "2026-11-12" },
    { id: "b", chauffeurId: "h", statut: "transit", dateChargement: "2026-11-09" },
    { id: "c", chauffeurId: "h", statut: "livre" },
    { id: "d", chauffeurId: "autre", statut: "charge" },
    { id: "e", chauffeurId: "h", statut: "confirme", dateChargement: "2026-11-11", trajetId: "t1" },
  ];
  assert.deepStrictEqual(N.missionsChauffeur("h").map((c) => c.id), ["b", "e", "a"]);
  N.S.trajets = [{ id: "t1", chauffeurId: "h", statut: "planifie" }, { id: "t2", chauffeurId: "h", statut: "planifie" }, { id: "t3", chauffeurId: "h", statut: "termine" }];
  assert.deepStrictEqual(N.trajetsIsoles("h").map((t) => t.id), ["t2"]);
});

(async () => {
  let ok = 0;
  for (const [nom, fn] of tests) {
    N.S = N.etatVide();
    try { await fn(); ok++; console.log("✓", nom); } catch (e) { console.error("✗", nom, "\n ", e.message); process.exitCode = 1; }
  }
  console.log(`\n${ok}/${tests.length} test(s) réussi(s)`);
})();
