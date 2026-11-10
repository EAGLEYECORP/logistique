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
for (const f of ["data.js", "noyau.js", "adm.js", "gps.js", "conformite.js", "ia.js", "stockage.js", "sauvegarde.js"]) vm.runInContext(fs.readFileSync(path.join(racine, f), "utf8"), ctx, { filename: f });
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
  assert.match(r.items[3].titre, /3 autres points à traiter/); // 2 urgentes restantes + 1 à surveiller
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

test("nombres en lettres : règles du français", () => {
  const cas = { 0: "zéro", 1: "un", 16: "seize", 21: "vingt et un", 22: "vingt-deux", 71: "soixante et onze", 77: "soixante-dix-sept", 80: "quatre-vingts", 81: "quatre-vingt-un", 91: "quatre-vingt-onze", 99: "quatre-vingt-dix-neuf",
    100: "cent", 101: "cent un", 200: "deux cents", 201: "deux cent un", 280: "deux cent quatre-vingts", 1000: "mille", 1001: "mille un", 2000: "deux mille", 21000: "vingt et un mille", 80000: "quatre-vingt mille", 200000: "deux cent mille",
    3648: "trois mille six cent quarante-huit", 1000000: "un million", 2000000: "deux millions", 1234567: "un million deux cent trente-quatre mille cinq cent soixante-sept", 80000000: "quatre-vingts millions", 1000000000: "un milliard" };
  for (const [n, mots] of Object.entries(cas)) assert.strictEqual(N.nombreEnLettres(+n), mots, `${n}`);
  assert.strictEqual(N.montantEnLettres(3648, "EUR"), "trois mille six cent quarante-huit euros");
  assert.strictEqual(N.montantEnLettres(1, "MAD"), "un dirham");
  assert.strictEqual(N.montantEnLettres(1250.5, "MAD"), "mille deux cent cinquante dirhams et cinquante centimes");
  assert.strictEqual(N.montantEnLettres(0.01, "MAD"), "zéro dirham et un centime");
});

test("verrou du mode chauffeur : PIN, code de secours, refus, empreintes salées", async () => {
  const { verrou, secours } = await N.verrouCreer("4821");
  assert.match(secours, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.ok(verrou.hashPin && verrou.hashPin !== "4821" && !JSON.stringify(verrou).includes("4821"));
  assert.strictEqual(await N.verrouVerifier(verrou, "4821"), true);
  assert.strictEqual(await N.verrouVerifier(verrou, " 4821 "), true);
  assert.strictEqual(await N.verrouVerifier(verrou, "4822"), false);
  assert.strictEqual(await N.verrouVerifier(verrou, ""), false);
  assert.strictEqual(await N.verrouVerifier(verrou, secours), true);
  assert.strictEqual(await N.verrouVerifier(verrou, secours.toLowerCase().replace("-", " ")), true); // casse et séparateur indifférents
  assert.strictEqual(await N.verrouVerifier(null, "4821"), false);
  const autre = await N.verrouCreer("4821");
  assert.notStrictEqual(autre.verrou.hashPin, verrou.hashPin); // sel différent → empreinte différente
  assert.strictEqual((await N.verrouCreer("")).verrou.hashPin, null);
});

test("Schengen 90/180 : jours inclus, fenêtre glissante, séjour en cours", () => {
  const sej = [{ entree: "2026-01-01", sortie: "2026-01-10" }, { entree: "2026-03-01", sortie: "" }];
  assert.strictEqual(N.schengenUtilise(sej, "2026-03-05"), 15); // 10 + 5 jours (entrée et sortie comptées)
  assert.strictEqual(N.schengenUtilise([{ entree: "2026-01-01", sortie: "2026-01-10" }], "2026-08-01"), 0); // sorti de la fenêtre de 180 jours
  const e = N.schengenEtat([{ entree: "2026-01-01", sortie: "" }], "2026-03-31");
  assert.strictEqual(e.utilise, 90); assert.strictEqual(e.restant, 0); assert.strictEqual(e.depasse, false);
  assert.strictEqual(N.schengenEtat([{ entree: "2026-01-01", sortie: "" }], "2026-04-01").depasse, true);
});

test("Schengen : séjour prévu et dernière date autorisée", () => {
  const p = N.schengenPrevu([], "2026-05-01", "2026-05-20");
  assert.strictEqual(p.ok, true); assert.strictEqual(p.pic, 20); assert.strictEqual(p.limite, "2026-07-29");
  const q = N.schengenPrevu([{ entree: "2026-04-01", sortie: "2026-05-15" }], "2026-05-20", "2026-07-15");
  assert.strictEqual(q.ok, false);
});

test("péages ADM officiels : trajets de référence en classe 3 et classe 2", () => {
  assert.strictEqual(N.admTrajet("casa-tmed", 3).total, 253);
  assert.strictEqual(N.admTrajet("casa-agadir", 3).total, 348);
  assert.strictEqual(N.admTrajet("agadir-tmed", 3).total, 601);
  assert.strictEqual(N.admTrajet("casa-tmed", 2).total, 210);
  assert.strictEqual(N.admTrajet("casa-tmed", 3).manquantes, 0);
  assert.strictEqual(N.admSection("tanger est", "port tanger med", 3), 36); // symétrique, casse indifférente
  assert.strictEqual(N.ADM_GRILLE.length, 584);
});

test("classe ADM déduite du camion", () => {
  assert.strictEqual(N.classeADM({ essieux: 5 }), 3);
  assert.strictEqual(N.classeADM({ essieux: 2 }), 2);
  assert.strictEqual(N.classeADM({ essieux: 2, hauteurBasse: true }), 1);
  assert.strictEqual(N.classeADM({}), null);
});

test("traversée : mètres linéaires, surcharges, passage chauffeur", () => {
  const sete = { fret: 2031, ml: 16.5, baf: 53, ets: 30.5, lss: 11, fueleu: 3, chauffeur: 150 };
  assert.strictEqual(N.coutTraversee(sete), 3789.75);
  assert.strictEqual(N.coutTraversee({ ml: 16.5, fret: 1000, baf: 4.36 }), 1071.94);
  assert.strictEqual(N.coutTraversee({}), 0);
});

test("coût et marge d'un voyage, retour à vide", () => {
  N.S.params.tauxEUR = 10;
  N.S.camions = [{ id: "c", immat: "A", essieux: 5 }];
  const v = { id: "v", camionId: "c", prix: 2000, devise: "EUR", peageTrajet: "casa-tmed", peageAR: true,
    traversees: [{ sens: "aller", ligne: "tmed-alg", ml: 16.5, fret: 1000, baf: 4 }, { sens: "retour", ligne: "alg-tmed", ml: 16.5, fret: 1000, baf: 4 }],
    carburantMad: 5000, kmAller: 1500, kmRetourCharge: 0, kmRetourVide: 1500 };
  const c = N.coutVoyage(v);
  assert.strictEqual(c.parts.peagesMaroc, 506);            // 253 × 2, classe 3
  assert.strictEqual(c.parts.traversees, 2132 * 10);       // 2 × (1000 + 16,5 × 4)
  assert.strictEqual(c.total, 506 + 21320 + 5000);
  assert.strictEqual(c.prix, 20000);
  const r = N.retourVide([v]);
  assert.strictEqual(r.pct, 50); assert.strictEqual(Math.round(r.coutVide), Math.round(c.total / 2));
});

test("contrôles de voyage : visa expiré avant le retour, autorisation absente, poids, traversée", () => {
  N.S.chauffeurs = [{ id: "h", nom: "Karim", visa: jour(5), passeport: jour(400), sejours: [] }];
  N.S.camions = [{ id: "c", immat: "A", essieux: 5 }];
  const ctl = N.controlesVoyage({ chauffeurId: "h", camionId: "c", dateDepart: jour(2), dateRetourPrevue: jour(12), ptacT: 41, traversees: [{ sens: "aller", ligne: "tmed-alg", statut: "a_reserver" }] });
  const t = ctl.map((x) => x.texte).join("|");
  assert.ok(/visa expire/.test(t)); assert.ok(/Aucune autorisation/.test(t)); assert.ok(/40 t/.test(t));
  assert.ok(/Traversée aller .* à réserver/.test(t)); assert.ok(/Traversée retour non renseignée/.test(t));
  assert.ok(ctl.find((x) => /visa/.test(x.texte)).niveau === "danger");
});

test("alertes : autorisation expirée, compte-rendu manquant, Schengen épuisé", () => {
  N.S.autorisations = [
    { id: "a1", type: "E", numero: "E-1", fin: jour(-2) },
    { id: "a2", type: "MA", numero: "MA-2", fin: jour(200), dateUtilisation: jour(-16), compteRendu: false },
  ];
  N.S.chauffeurs = [{ id: "h", nom: "Karim", sejours: [{ entree: jour(-95), sortie: "" }] }];
  const t = N.alertes().map((a) => a.texte).join("|");
  assert.ok(/E-1.*expirée/.test(t)); assert.ok(/MA-2.*compte-rendu/.test(t)); assert.ok(/Karim.*Schengen/.test(t));
});

test("migration v3 → v5 : voyages, autorisations, traces ajoutés, données conservées", () => {
  const r = N.migrer({ meta: { version: 3 }, camions: [{ id: "c", immat: "X" }], chauffeurs: [{ id: "h", nom: "A" }] });
  assert.strictEqual(r.etat.meta.version, N.VERSION_SCHEMA); assert.deepStrictEqual([...r.etat.traces], []); assert.deepStrictEqual([...r.etat.voyages], []); assert.deepStrictEqual([...r.etat.autorisations], []);
  assert.strictEqual(r.etat.camions[0].immat, "X"); assert.deepStrictEqual([...r.etat.chauffeurs[0].sejours], []);
});

test("interdictions de circuler : dimanche concerne tous les pays, samedi la France et l'Autriche", () => {
  const dim = N.interdictionsLe("2026-11-15", N.INTERDICTIONS).map((i) => i.pays);
  const sam = N.interdictionsLe("2026-11-14", N.INTERDICTIONS).map((i) => i.pays);
  assert.strictEqual(dim.length, 6); assert.deepStrictEqual([...sam], ["France", "Autriche"]);
  assert.strictEqual(N.interdictionsLe("2026-11-12", N.INTERDICTIONS).length, 0);
});

/* ---------- GPS ---------- */
const trace = (pts) => pts.map(([t, la, lo, v]) => [N.gpsTemps(t), la, lo, v ?? null]);
const zonesT = () => [...N.ZONES_DEFAUT, { id: "z-dep", nom: "Dépôt Agadir", type: "depot", lat: 30.42, lon: -9.6, rayon: 1500 }];

test("GPS : heures ISO, françaises, UNIX, avec décalage", () => {
  assert.strictEqual(N.gpsTemps("2026-11-10T10:00:00Z"), Date.UTC(2026, 10, 10, 10) / 1000);
  assert.strictEqual(N.gpsTemps("10/11/2026 10:00:00"), Date.UTC(2026, 10, 10, 10) / 1000);
  assert.strictEqual(N.gpsTemps("10/11/2026 11:00:00", 1), Date.UTC(2026, 10, 10, 10) / 1000); // données en UTC+1
  assert.strictEqual(N.gpsTemps("2026-11-10 10:00:00+01:00"), Date.UTC(2026, 10, 10, 9) / 1000);
  assert.strictEqual(N.gpsTemps("1789000000"), 1789000000); assert.strictEqual(N.gpsTemps("1789000000000"), 1789000000);
  assert.ok(Number.isNaN(N.gpsTemps("n'importe quoi")));
});

test("GPS : CSV français (point-virgule, virgule décimale, colonnes françaises)", () => {
  const csv = "Horodatage;Latitude;Longitude;Vitesse (km/h);Contact\n10/11/2026 08:00:00;35,889;-5,500;0;ON\n10/11/2026 08:05:00;35,9;-5,49;42,5;ON\nligne;cassée;;;\n";
  const r = N.gpsParseCSV(csv);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.points.length, 2); assert.strictEqual(r.rejetes, 1);
  assert.strictEqual(r.points[0][1], 35.889); assert.strictEqual(r.points[1][3], 42.5);
});

test("GPS : CSV anglais (virgule), date et heure séparées, colonnes manquantes", () => {
  const r = N.gpsParseCSV("date,time,lat,lng,speed\n2026-11-10,08:00:00,35.88,-5.50,10\n2026-11-10,08:01:00,35.89,-5.50,20");
  assert.strictEqual(r.ok, true); assert.strictEqual(r.points.length, 2); assert.strictEqual(r.points[0][0], Date.UTC(2026, 10, 10, 8) / 1000);
  const x = N.gpsParseCSV("a;b;c\n1;2;3");
  assert.strictEqual(x.ok, false); assert.deepStrictEqual([...x.entetes], ["a", "b", "c"]);
  const m = N.gpsParseCSV("a;b;c\n10/11/2026 08:00:00;35,8;-5,5", { colonnes: { temps: 0, lat: 1, lon: 2, vitesse: -1, date: -1 } });
  assert.strictEqual(m.ok, true); assert.strictEqual(m.points.length, 1);
});

test("GPS : GPX (heure, vitesse en m/s convertie)", () => {
  const gpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="35.889" lon="-5.5"><time>2026-11-10T08:00:00Z</time><extensions><speed>10</speed></extensions></trkpt><trkpt lat="35.9" lon="-5.49"><time>2026-11-10T08:01:00.000Z</time></trkpt><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>';
  const r = N.gpsLire(gpx, "trace.gpx");
  assert.strictEqual(r.format, "gpx"); assert.strictEqual(r.points.length, 2); assert.strictEqual(r.rejetes, 1); assert.strictEqual(Math.round(r.points[0][3]), 36);
});

test("GPS : distance haversine et nettoyage des sauts", () => {
  const d = N.gpsDistance([0, 35.889, -5.5], [0, 36.13, -5.44]);
  assert.ok(d > 26000 && d < 29000, "Tanger Med → Algeciras ≈ 27 km à vol d'oiseau : " + d);
  const pts = trace([["2026-11-10T08:00:00Z", 35.889, -5.5], ["2026-11-10T08:01:00Z", 50, 10], ["2026-11-10T08:02:00Z", 35.89, -5.5], ["2026-11-10T08:02:00Z", 35.89, -5.5]]);
  const r = N.gpsNettoyer(pts);
  assert.strictEqual(r.points.length, 2); assert.strictEqual(r.ecartes, 2);
});

test("GPS : traversée du détroit détectée, jalons aller et retour déduits", () => {
  const pts = trace([
    ["2026-11-10T05:00:00Z", 30.42, -9.6, 0], ["2026-11-10T05:30:00Z", 30.6, -9.55, 80],
    ["2026-11-10T14:00:00Z", 35.889, -5.5, 0], ["2026-11-10T16:00:00Z", 35.89, -5.5, 2],   // port de Tanger Med
    ["2026-11-10T18:00:00Z", 36.13, -5.44, 0], ["2026-11-10T18:10:00Z", 36.13, -5.44, 0],   // Algeciras (trou en mer)
    ["2026-11-14T08:00:00Z", 36.13, -5.44, 0], ["2026-11-14T09:00:00Z", 36.13, -5.44, 1],   // retour à Algeciras
    ["2026-11-14T11:00:00Z", 35.889, -5.5, 0],                                               // Tanger Med
    ["2026-11-14T20:00:00Z", 30.42, -9.6, 0],                                                // dépôt
  ]);
  const an = N.gpsAnalyser(pts, zonesT());
  assert.strictEqual(an.traversees.length, 2);
  assert.strictEqual(an.traversees[0].sens, "aller"); assert.strictEqual(an.traversees[0].embarque, N.gpsTemps("2026-11-10T16:00:00Z")); assert.strictEqual(an.traversees[0].debarque, N.gpsTemps("2026-11-10T18:00:00Z"));
  assert.strictEqual(an.traversees[1].sens, "retour");
  const types = an.jalons.map((j) => j.type).join(",");
  assert.strictEqual(types, "depart,port_tmed,embarque_aller,debarque_alg,embarque_retour,debarque_tmed,retour");
  assert.ok(an.trous.length >= 2);
  const sj = N.gpsSejourSchengen(an);
  assert.deepStrictEqual({ ...sj }, { entree: "2026-11-10", sortie: "2026-11-14" });
});

test("GPS : conduite estimée, pause de 45 min, arrêts", () => {
  // 3 h de route, arrêt de 50 min, 3 h de route : aucune période de plus de 4 h 30 sans pause
  const p = []; let t = Date.UTC(2026, 10, 10, 6) / 1000, lat = 33;
  const marche = (min) => { for (let i = 0; i < min; i += 5) { t += 300; lat += 0.04; p.push([t, lat, -7, 80]); } };
  const arret = (min) => { for (let i = 0; i < min; i += 5) { t += 300; p.push([t, lat, -7, 0]); } };
  p.push([t, lat, -7, 0]); marche(180); arret(50); marche(180);
  let an = N.gpsAnalyser(p, []);
  assert.ok(Math.abs(an.conduiteH - 6) < 0.1, "conduite " + an.conduiteH); assert.ok(an.conduiteMaxSansPauseH < 3.2);
  assert.strictEqual(an.arrets.length, 1); assert.ok(an.arrets[0].dureeMin >= 45);
  // sans pause : 5 h de route
  const q = []; t = Date.UTC(2026, 10, 10, 6) / 1000; lat = 33; q.push([t, lat, -7, 0]);
  for (let i = 0; i < 60; i++) { t += 300; lat += 0.04; q.push([t, lat, -7, 80]); }
  an = N.gpsAnalyser(q, []);
  assert.ok(an.conduiteMaxSansPauseH > 4.9);
});

test("GPS : réduction de trace et dessin SVG", () => {
  const pts = Array.from({ length: 5000 }, (_, i) => [1789000000 + i * 10, 33 + i * 1e-4, -7 + i * 1e-4, 50]);
  const r = N.gpsReduire(pts, 800);
  assert.strictEqual(r.length, 800); assert.strictEqual(r[0][0], pts[0][0]); assert.strictEqual(r[799][0], pts[4999][0]);
  assert.ok(/^<svg[\s\S]*<path/.test(N.gpsSVG(r, N.ZONES_DEFAUT, [])));
  assert.strictEqual(N.gpsSVG([[0, 1, 1]], []), "");
});

/* ---------- Phase 2 : gares et péage mesuré ---------- */
const GARES_T = [
  { nom: "CASABLANCA", lat: 33.65, lon: -7.55, rayon: 300 }, { nom: "RABAT", lat: 34.05, lon: -6.80, rayon: 300 },
  { nom: "KENITRA", lat: 34.28, lon: -6.60, rayon: 300 }, { nom: "KENITRA NORD", lat: 34.35, lon: -6.58, rayon: 300 }, { nom: "PORT TANGER MED", lat: 35.88, lon: -5.50, rayon: 300 },
];
/** Trace rectiligne passant devant les gares, avec un ralentissement à chacune. */
function traceAutoroute(passes) {
  const pts = []; let t = Date.UTC(2026, 10, 10, 6) / 1000;
  const route = GARES_T;
  pts.push([t, route[0].lat - 0.02, route[0].lon, 80]);
  for (let i = 0; i < route.length; i++) {
    const g = route[i];
    if (passes.includes(g.nom)) { t += 60; pts.push([t, g.lat - 0.003, g.lon, 80]); t += 30; pts.push([t, g.lat, g.lon + 0.0008, 12]); t += 30; pts.push([t, g.lat + 0.003, g.lon, 80]); }
    const n = route[i + 1]; if (n) { const dt = Math.round(N.gpsDistance([0, g.lat, g.lon], [0, n.lat, n.lon]) / (85 / 3.6) / 8); for (let k = 1; k <= 8; k++) { t += dt; pts.push([t, g.lat + ((n.lat - g.lat) * k) / 9, g.lon + ((n.lon - g.lon) * k) / 9, 85]); } }
  }
  return pts;
}

test("péage mesuré : passages devant les gares puis somme des sections ADM", () => {
  const pts = traceAutoroute(["CASABLANCA", "RABAT", "KENITRA", "KENITRA NORD", "PORT TANGER MED"]);
  const p = N.gpsPassagesGares(pts, GARES_T);
  assert.deepStrictEqual([...p.map((x) => x.gare)], ["CASABLANCA", "RABAT", "KENITRA", "KENITRA NORD", "PORT TANGER MED"]);
  const tr = N.gpsTrajetsPeage(p, 3);
  assert.deepStrictEqual([...tr.map((x) => x.type)], ["section", "section", "liaison", "section"]); // Kénitra ↔ Kénitra Nord : aucun tarif dans la grille
  assert.strictEqual(tr.reduce((s, x) => s + x.mad, 0), 253); // 43 + 28 + 0 + 182, comme la grille officielle
  assert.strictEqual(N.gpsTrajetsPeage(p, 2).reduce((s, x) => s + x.mad, 0), 210);
});

test("gares : les ralentissements isolés en pleine conduite sont proposés, pas les arrêts ni les zones", () => {
  const pts = traceAutoroute(["RABAT", "KENITRA"]);
  const r = N.gpsRalentissements(pts, []);
  assert.strictEqual(r.length, 2); assert.ok(r.every((x) => x.vmin <= 15));
  assert.strictEqual(N.gpsRalentissements(pts, [{ id: "z", nom: "Z", type: "autre", lat: 34.05, lon: -6.8, rayon: 500 }]).length, 1); // un ralentissement dans une zone connue est ignoré
  const arret = [[0, 33, -7, 80], [60, 33.01, -7, 80], [120, 33.02, -7, 0], [1800, 33.02, -7, 0], [1860, 33.03, -7, 80], [1920, 33.04, -7, 80]];
  assert.strictEqual(N.gpsRalentissements(arret, []).length, 0); // arrêt de 30 min : pas un péage
});

test("gares : le trou de signal n'invente pas de passage", () => {
  const pts = traceAutoroute(["RABAT"]).filter((p) => !(p[1] > 33.9 && p[1] < 34.2)); // les points autour de Rabat manquent
  assert.strictEqual(N.gpsPassagesGares(pts, GARES_T).filter((x) => x.gare === "RABAT").length, 0);
});

test("simplification d'une trace : peu de points, passages conservés", () => {
  const pts = traceAutoroute(["CASABLANCA", "RABAT", "KENITRA", "KENITRA NORD", "PORT TANGER MED"]);
  const s = N.gpsSimplifier(pts, 30, 2500);
  assert.ok(s.length < pts.length && s.length >= 5);
  assert.strictEqual(N.gpsPassagesGares(s, GARES_T).length, 5);
  assert.strictEqual(N.gpsSimplifier(Array.from({ length: 6000 }, (_, i) => [i * 10, 33 + Math.sin(i / 50) * 0.5, -7 + i * 1e-4, 50]), 1, 300).length, 300);
});

test("noms de gares : correspondance avec la grille ADM", () => {
  assert.strictEqual(N.admGareProche("Gare de Kénitra Nord"), "KENITRA NORD");
  assert.strictEqual(N.admGareProche("PORT TANGER MED"), "PORT TANGER MED");
  assert.strictEqual(N.admGareProche("Casablanca"), "CASABLANCA");
  assert.strictEqual(N.admGareProche("xyz inconnu"), null);
  assert.strictEqual(N.admGares().length, 92);
});

test("relevé de péages : colonnes reconnues et lecture", () => {
  const csv = "Date;Heure;Pass;Gare d'entrée;Gare de sortie;Montant (MAD)\n10/11/2026;08:45:10;PASS-77;CASABLANCA;RABAT;43,00\n10/11/2026;10:05:00;PASS-77;RABAT;KENITRA;28,00\nerreur;;;;;\n";
  const r = N.releveParse(csv);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.lignes.length, 2); assert.strictEqual(r.rejetes, 1);
  assert.strictEqual(r.lignes[0].gareB, "RABAT"); assert.strictEqual(r.lignes[0].gareA, "CASABLANCA"); assert.strictEqual(r.lignes[0].mad, 43); assert.strictEqual(r.lignes[0].ref, "PASS-77");
  assert.strictEqual(N.releveParse("a;b\n1;2").ok, false);
});

test("rapprochement Jawaz : conforme, écart, non facturé, facturé sans passage", () => {
  const pts = traceAutoroute(["CASABLANCA", "RABAT", "KENITRA", "KENITRA NORD", "PORT TANGER MED"]);
  const tr = N.gpsTrajetsPeage(N.gpsPassagesGares(pts, GARES_T), 3);
  const L = (gare, delta, mad) => ({ t: tr.find((x) => x.vers === gare).tVers + delta, gareA: "", gareB: gare, mad, ref: "P" });
  const lignes = [L("RABAT", 120, 43), L("KENITRA", -300, 30) /* écart de 2 MAD */, /* PORT TANGER MED : non facturé */ { t: pts[0][0] + 600, gareA: "", gareB: "AIN DALIA", mad: 14, ref: "P" } /* sans passage GPS */];
  const r = N.gpsRapprocher(tr, lignes, { debut: pts[0][0], fin: pts[pts.length - 1][0] });
  const s = N.gpsResumeRapprochement(r);
  assert.deepStrictEqual({ ...s }, { ok: 1, ecart: 1, nonFacture: 1, sansPassage: 1, manque: 182, surplus: 14 });
  assert.strictEqual(r.find((x) => x.statut === "ecart").difference, 2);
  assert.strictEqual(r.filter((x) => x.statut === "liaison").length, 1);
});

test("péage mesuré prioritaire sur le trajet type dans le coût du voyage", () => {
  N.S.camions = [{ id: "c", essieux: 5 }];
  assert.strictEqual(N.peagesMarocVoyage({ camionId: "c", peageTrajet: "casa-tmed" }), 253);
  assert.strictEqual(N.peagesMarocVoyage({ camionId: "c", peageTrajet: "casa-tmed", peagesReelMad: 261 }), 261);
});

test("import OpenStreetMap : GeoJSON d'overpass-turbo et JSON d'Overpass", () => {
  const geo = JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", id: "node/1", properties: { "@id": "node/1", barrier: "toll_booth", name: "Gare de péage de Kénitra Nord" }, geometry: { type: "Point", coordinates: [-6.58, 34.35] } },
    { type: "Feature", id: "way/2", properties: { barrier: "toll_booth", "name:fr": "Rabat" }, geometry: { type: "LineString", coordinates: [[-6.80, 34.05], [-6.802, 34.051]] } },
    { type: "Feature", id: "node/3", properties: { barrier: "toll_booth" }, geometry: { type: "Point", coordinates: [-5.0, 35.0] } } ] });
  const r = N.osmGaresParse(geo);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.gares.length, 3);
  assert.strictEqual(r.gares[0].adm, "KENITRA NORD"); assert.strictEqual(r.gares[1].adm, "RABAT"); assert.strictEqual(r.gares[2].adm, null);
  assert.ok(Math.abs(r.gares[1].lat - 34.0505) < 1e-6);
  const o = N.osmGaresParse(JSON.stringify({ elements: [{ type: "node", id: 9, lat: 33.65, lon: -7.55, tags: { name: "Casablanca" } }, { type: "way", id: 8, center: { lat: 34.0, lon: -6.8 }, tags: {} }] }));
  assert.strictEqual(o.gares.length, 2); assert.strictEqual(o.gares[0].adm, "CASABLANCA");
  assert.strictEqual(N.osmGaresParse("pas du json").ok, false); assert.strictEqual(N.osmGaresParse("{}").ok, false);
});

/* ---------- Phase 3 : suivi en direct ---------- */
const NOW = Date.UTC(2026, 10, 10, 12, 0) / 1000;
const marche = (n, v = 80, fin = NOW) => Array.from({ length: n }, (_, i) => [fin - (n - 1 - i) * 300, 33 + (i + 1) * 0.04, -7, v]);

test("Traccar : positions normalisées (nœuds → km/h, identifiant de la balise)", () => {
  const r = N.directDepuisTraccar([{ id: 7, uniqueId: "IMEI-123", name: "Volvo 12345-A-6" }], [
    { deviceId: 7, fixTime: "2026-11-10T11:59:30.000+00:00", latitude: 33.6, longitude: -7.6, speed: 43.2, course: 90 }, { deviceId: 9, fixTime: "2026-11-10T11:59:30.000+00:00", latitude: 1, longitude: 2, speed: 0 }, { deviceId: 7, fixTime: "pas une date", latitude: 1, longitude: 2 }]);
  assert.strictEqual(r.length, 2); assert.strictEqual(r[0].id, "IMEI-123"); assert.strictEqual(r[0].v, 80); assert.strictEqual(r[0].t, NOW - 30); assert.strictEqual(r[1].id, "traccar:9");
});

test("direct : en route, à l'arrêt, arrêt prolongé, au port, signal perdu", () => {
  const Z = [...N.ZONES_DEFAUT];
  assert.strictEqual(N.directEtat(marche(10), NOW, Z).code, "en_route");
  const arret = (min) => [...marche(10, 80, NOW - min * 60), ...Array.from({ length: Math.floor(min / 5) + 1 }, (_, i) => [NOW - min * 60 + i * 300, 33.4, -7, 0])];
  assert.strictEqual(N.directEtat(arret(20), NOW, Z).code, "arret");
  const long = N.directEtat(arret(60), NOW, Z); assert.strictEqual(long.code, "arret_long"); assert.ok(long.arretMin >= 55);
  assert.strictEqual(N.directEtat([[NOW - 60, 35.889, -5.5, 0]], NOW, Z).code, "au_port");
  assert.strictEqual(N.directEtat(marche(10, 80, NOW - 3 * 3600), NOW, Z).code, "hors_ligne");
  assert.strictEqual(N.directEtat([], NOW, Z).code, "inconnu");
});

test("direct : silence après un port = traversée, jamais une alerte de signal perdu", () => {
  const Z = [...N.ZONES_DEFAUT];
  const apresPort = [[NOW - 5400, 35.889, -5.5, 0]]; // dernière position dans le port de Tanger Med, silence depuis 1 h 30
  const e = N.directEtat(apresPort, NOW, Z); assert.strictEqual(e.code, "traversee");
  assert.strictEqual(N.directAlertes("Camion A", e, apresPort).length, 0);
  assert.strictEqual(N.directEtat([[NOW - 12 * 3600, 35.889, -5.5, 0]], NOW, Z).code, "hors_ligne"); // 12 h de silence : plus une traversée
});

test("direct : conduite continue, pause de 45 min, alertes", () => {
  const c = N.conduiteCourante(marche(54)); // 54 intervalles de 5 min = 4 h 30 environ
  assert.ok(c.serieH > 4.4 && c.serieH < 4.6, "série " + c.serieH);
  const pause = [...marche(30, 80, NOW - 3600), ...Array.from({ length: 11 }, (_, i) => [NOW - 3300 + i * 300, 35, -7, 0]), ...marche(4, 80, NOW)];
  assert.ok(N.conduiteCourante(pause, NOW).serieH < 1, "la pause de 50 min remet la série à zéro");
  const h = marche(56), e = N.directEtat(h, NOW, []);
  const a = N.directAlertes("Camion A", e, h);
  assert.ok(a.some((x) => x.niveau === "danger" && /conduite/.test(x.texte)));
  assert.ok(N.directAlertes("B", N.directEtat([[NOW - 60, 33, -7, 110]], NOW, []), [[NOW - 60, 33, -7, 110]]).some((x) => /110 km\/h/.test(x.texte)));
});

test("carte : cadrage Mercator et tuiles", () => {
  const v = N.directVue([[30.4, -9.6], [36.1, -5.4]], { largeur: 640, hauteur: 380 });
  assert.ok(v.z >= 5 && v.z <= 7, "zoom " + v.z); assert.ok(v.tuiles.length >= 2 && v.tuiles.length <= 30);
  const [x, y] = v.vers(30.4, -9.6); assert.ok(x >= 0 && x <= 640 && y >= 0 && y <= 380);
  const [x2, y2] = v.vers(36.1, -5.4); assert.ok(x2 > x && y2 < y); // Algeciras est au nord-est d'Agadir
  assert.strictEqual(N.directVue([]), null);
  assert.deepStrictEqual([...N.mercPx(0, 0, 0)], [128, 128]);
});

/* ---------- Phase 4 : ETA ---------- */
test("villes connues : accents, casse, mentions entre parenthèses, pays", () => {
  assert.deepStrictEqual([...N.villeConnue("Perpignan")], [42.6887, 2.8948]);
  assert.deepStrictEqual([...N.villeConnue("  SÈTE ")], [43.4075, 3.6967]);
  assert.deepStrictEqual([...N.villeConnue("Marché de Rungis (France)")], [48.7462, 2.3526]);
  assert.deepStrictEqual([...N.villeConnue("Tanger Med")], [35.889, -5.5]);
  assert.strictEqual(N.villeConnue("Ville inconnue"), null); assert.strictEqual(N.villeConnue(""), null);
});

test("ETA : même côté du détroit, sans repos", () => {
  const hist = marche(10, 75); // dernier point à NOW
  const dest = [hist[9][1] + 0.9, -7]; // ≈ 100 km à vol d'oiseau
  const e = N.etaVoyage(hist, NOW, dest, { zones: N.ZONES_DEFAUT, facteurRoute: 1.3, vitesse: 75 });
  assert.ok(e.kmRestants >= 125 && e.kmRestants <= 135, "km " + e.kmRestants);
  assert.strictEqual(e.traversee, false); assert.strictEqual(e.reposJournaliers, 0);
  assert.ok(e.dureeH > 1.5 && e.dureeH < 2.2, "durée " + e.dureeH);
  assert.ok(e.min < e.arrivee && e.arrivee < e.max); assert.ok(e.arrivee > NOW);
});

test("ETA : Maroc → Europe passe par le détroit, avec repos journalier", () => {
  const hist = [[NOW - 600, 34.02, -6.84, 70], [NOW, 34.05, -6.8, 70]];
  const e = N.etaVoyage(hist, NOW, N.villeConnue("Perpignan"), { zones: N.ZONES_DEFAUT, vitesse: 75 });
  assert.strictEqual(e.traversee, true); assert.ok(e.attentesH >= 5.4 && e.attentesH <= 5.6, "attentes " + e.attentesH);
  assert.ok(e.reposJournaliers >= 1, "au moins un repos de 11 h sur ce trajet"); assert.ok(e.dureeH > 35 && e.dureeH < 60, "durée " + e.dureeH);
  assert.ok(e.pauses >= 2);
  // la même route sans les règles de repos serait bien plus courte
  assert.ok(e.dureeH > e.conduiteH + e.attentesH + 11 - 0.01);
});

test("ETA : traversée en cours et camion déjà au port", () => {
  const dest = N.villeConnue("Madrid");
  const mer = N.etaVoyage([[NOW - 2400, 35.889, -5.5, 0]], NOW, dest, { zones: N.ZONES_DEFAUT, vitesse: 75 });
  assert.strictEqual(mer.etat, "traversee"); assert.ok(mer.attentesH > 1.0 && mer.attentesH < 2.0, "attentes " + mer.attentesH); // il reste ≈ 1 h de mer + 1 h de débarquement
  const port = N.etaVoyage([[NOW - 60, 35.889, -5.5, 0]], NOW, dest, { zones: N.ZONES_DEFAUT, vitesse: 75 });
  assert.strictEqual(port.etat, "au_port"); assert.ok(port.attentesH < 5.5);
  const retour = N.etaVoyage([[NOW - 60, 37.0, -4.0, 80]], NOW, N.villeConnue("Casablanca"), { zones: N.ZONES_DEFAUT, vitesse: 75 });
  assert.strictEqual(retour.traversee, true);
});

test("ETA : la conduite déjà effectuée avance la pause obligatoire ; vitesse récente et bornes", () => {
  const frais = N.etaVoyage([[NOW - 60, 40, -3, 0], [NOW, 40, -3, 0]], NOW, [43, 2], { zones: [], vitesse: 75 });
  const fatigue = N.etaVoyage(marche(50, 80).map((p) => [p[0], 30 + (p[1] - 33) * 2, -7 + (p[1] - 33) * 2, 80]).slice(-50), NOW, [60, 10], { zones: [], vitesse: 75 });
  assert.ok(fatigue.pauses + fatigue.reposJournaliers >= 1);
  const vite = Array.from({ length: 8 }, (_, i) => [NOW - (7 - i) * 300, 40 + i * 0.1126, -3, null]); // ≈ 150 km/h mesurés
  assert.strictEqual(N.etaVoyage(vite, NOW, [50, 5], { zones: [] }).vitesse, 85); // plafonnée
  assert.strictEqual(N.etaVoyage([[NOW, 40, -3, 0]], NOW, [43, 2], { zones: [] }).vitesse, 75); // sans roulage récent : valeur par défaut
  assert.strictEqual(N.etaVoyage([], NOW, [43, 2], {}), null); assert.strictEqual(N.etaVoyage(marche(3), NOW, null, {}), null);
  const h = Array.from({ length: 10 }, (_, i) => [NOW - (9 - i) * 300, 33 + i * 0.0502, -7, 80]); // ≈ 67 km/h mesurés
  assert.ok(Math.abs(N.vitesseMoyenne(h, NOW) - 67) < 3);
  assert.ok(N.conduiteJour(marche(20), NOW) > 1.5);
});

test("ETA : retard par rapport au créneau prévu", () => {
  const eta = { arrivee: NOW + 3600 };
  assert.strictEqual(N.etaRetardMin(eta, new Date((NOW + 1800) * 1000).toISOString()), 30);
  assert.strictEqual(N.etaRetardMin(eta, new Date((NOW + 7200) * 1000).toISOString()), -60);
  assert.strictEqual(N.etaRetardMin(eta, ""), null); assert.strictEqual(N.etaRetardMin(null, "2026-01-01T00:00:00Z"), null);
});

/* ---------- Phases 5 à 8 : conformité et communication ---------- */
test("péages d'Europe : km par pays × tarif, pays sans tarif signalés et jamais devinés", () => {
  N.S.params.peagesEu = { DE: 0.35, ES: 0.2 };
  assert.deepStrictEqual({ ...N.lireKmPays("ES 950, FR: 880 de=300") }, { ES: 950, FR: 880, DE: 300 });
  const r = N.peagesEuropeVoyage({ kmPays: "ES 1000, FR 900, DE 100" });
  assert.strictEqual(r.eur, 235); assert.deepStrictEqual([...r.manquants], ["FR"]); assert.strictEqual(r.detail.length, 2);
  N.S.params.tauxEUR = 10; N.S.camions = [];
  assert.strictEqual(N.coutVoyage({ kmPays: "ES 1000", peagesEur: 999 }).parts.peagesEurope, 2000); // le calcul par pays remplace la saisie
  assert.strictEqual(N.coutVoyage({ peagesEur: 50 }).parts.peagesEurope, 500);
  assert.strictEqual(N.coutVoyage({ kmPays: "FR 900", peagesEur: 50 }).parts.peagesEurope, 500); // tarif absent : on garde la saisie
});

test("WhatsApp et SMS : numéros marocains et internationaux", () => {
  assert.strictEqual(N.telInternational("06 12 34 56 78"), "212612345678"); assert.strictEqual(N.telInternational("+34 600 11 22 33"), "34600112233");
  assert.strictEqual(N.telInternational("0034600112233"), "34600112233"); assert.strictEqual(N.telInternational("612345678"), "212612345678");
  assert.strictEqual(N.telInternational("abc"), ""); assert.strictEqual(N.telInternational(""), "");
  assert.strictEqual(N.lienWhatsApp("06 12 34 56 78", "Bonjour & merci"), "https://wa.me/212612345678?text=Bonjour%20%26%20merci");
  assert.strictEqual(N.lienSMS("0612345678", "Pause"), "sms:+212612345678?&body=Pause"); assert.strictEqual(N.lienWhatsApp("", "x"), "");
});

const jourT = (j, h = 0, m = 0) => Date.UTC(2026, 10, j, h, m) / 1000; // novembre 2026
test("tachygraphe : lecture CSV (colonnes françaises, durées, activités)", () => {
  const csv = "Conducteur;Début;Fin;Activité\nKarim;10/11/2026 06:00;10/11/2026 10:30;Conduite\nKarim;10/11/2026 10:30;10/11/2026 11:15;Repos\nKarim;10/11/2026 11:15;10/11/2026 14:00;C\nKarim;??;;Conduite\n";
  const r = N.tachyParseCSV(csv); assert.strictEqual(r.ok, true); assert.strictEqual(r.activites.length, 3); assert.strictEqual(r.rejetes, 1); assert.strictEqual(r.activites[1].type, "repos");
  const d = N.tachyParseCSV("driver,start,duration,activity\nA,2026-11-10 06:00:00,04:30,driving\nA,2026-11-10 10:30:00,45,rest");
  assert.strictEqual(d.activites[0].fin - d.activites[0].debut, 16200); assert.strictEqual(d.activites[1].fin - d.activites[1].debut, 2700);
  assert.strictEqual(N.tachyParseCSV("a;b\n1;2").ok, false);
  assert.deepStrictEqual([N.tachyActivite("Driving"), N.tachyActivite("Disponibilité"), N.tachyActivite("pause"), N.tachyActivite("W"), N.tachyActivite("???")], ["conduite", "disponibilite", "repos", "travail", null]);
});

test("tachygraphe : conduite continue, journée et semaine", () => {
  const ok = N.tachyAnalyser([{ debut: jourT(10, 6), fin: jourT(10, 10, 30), type: "conduite" }, { debut: jourT(10, 10, 30), fin: jourT(10, 11, 15), type: "repos" }, { debut: jourT(10, 11, 15), fin: jourT(10, 15, 30), type: "conduite" }]);
  assert.strictEqual(ok.infractions.length, 0); assert.ok(Math.abs(ok.conduiteTotalH - 8.75) < 0.01);
  const trop = N.tachyAnalyser([{ debut: jourT(10, 6), fin: jourT(10, 12), type: "conduite" }]); // 6 h sans pause
  assert.ok(trop.infractions.some((i) => i.type === "conduite_continue"));
  const fractionnee = N.tachyAnalyser([{ debut: jourT(10, 6), fin: jourT(10, 10), type: "conduite" }, { debut: jourT(10, 10), fin: jourT(10, 10, 15), type: "repos" }, { debut: jourT(10, 10, 15), fin: jourT(10, 10, 45), type: "repos" }, { debut: jourT(10, 10, 45), fin: jourT(10, 14), type: "conduite" }]);
  assert.strictEqual(fractionnee.infractions.filter((i) => i.type === "conduite_continue").length, 0); // pause fractionnée 15 + 30 min
  const jour11h = N.tachyAnalyser([{ debut: jourT(10, 4), fin: jourT(10, 8), type: "conduite" }, { debut: jourT(10, 8), fin: jourT(10, 8, 45), type: "repos" }, { debut: jourT(10, 8, 45), fin: jourT(10, 12, 45), type: "conduite" }, { debut: jourT(10, 12, 45), fin: jourT(10, 13, 30), type: "repos" }, { debut: jourT(10, 13, 30), fin: jourT(10, 15, 40), type: "conduite" }]);
  assert.ok(jour11h.infractions.some((i) => i.type === "conduite_jour" || i.gravite), "10 h 10 de conduite dans la journée");
});

test("tachygraphe : semaine de plus de 56 h, repos hebdomadaire manquant", () => {
  const acts = [];
  for (let j = 2; j <= 22; j++) { // 3 semaines : conduite 4 h + pause + 4 h chaque jour, repos de 12 h
    acts.push({ debut: jourT(j, 5), fin: jourT(j, 9), type: "conduite" }, { debut: jourT(j, 9), fin: jourT(j, 9, 45), type: "repos" }, { debut: jourT(j, 9, 45), fin: jourT(j, 14, 15), type: "conduite" }, { debut: jourT(j, 14, 15), fin: jourT(j + 1, 4), type: "repos" });
  }
  const a = N.tachyAnalyser(acts);
  assert.ok(a.semaines.some((s) => s.conduiteH > 56)); assert.ok(a.infractions.some((i) => i.type === "conduite_semaine"));
  assert.ok(a.infractions.some((i) => i.type === "repos_hebdo")); assert.ok(a.infractions.some((i) => i.type === "conduite_2semaines"));
});

test("alerte : dépassements récents du tachygraphe", () => {
  N.S.chauffeurs = [{ id: "h", nom: "Karim", tachy: { infractions: [{ type: "conduite_semaine", gravite: "grave", date: jour(-3), texte: "x" }, { type: "x", gravite: "mineur", date: jour(-40), texte: "y" }] } }];
  const a = N.alertes().find((x) => /tachygraphe/.test(x.texte)); assert.ok(a); assert.strictEqual(a.niveau, "danger"); assert.ok(/1 dépassement/.test(a.texte));
});

test("chaîne du froid : excursions au-delà de la tolérance, excursion en cours", () => {
  const pts = [[0, 4], [600, 5], [1200, 9], [1800, 9.5], [2400, 10], [3000, 6], [3600, 5]]; // 8 °C max : hors plage de 1200 à 3000 s
  const r = N.froidAnalyser(pts, 2, 8, { toleranceMin: 15 });
  assert.strictEqual(r.conforme, false); assert.strictEqual(r.excursions.length, 1); assert.strictEqual(r.excursions[0].sens, "haut"); assert.strictEqual(r.excursions[0].extreme, 10); assert.strictEqual(r.excursions[0].dureeMin, 30);
  assert.strictEqual(N.froidAnalyser([[0, 4], [600, 9], [1200, 5]], 2, 8).conforme, true); // 10 min : sous la tolérance (dégivrage, porte)
  assert.strictEqual(N.froidAnalyser([], 2, 8), null);
  const enCours = N.froidEnCours([[0, 5], [600, 9], [1200, 9.5], [1800, 10]], 2, 8, 1900);
  assert.strictEqual(enCours.sens, "haut"); assert.ok(enCours.depuisMin >= 15); assert.strictEqual(N.froidEnCours([[0, 5], [600, 9]], 2, 8, 700), null); assert.strictEqual(N.froidEnCours([[0, 5]], 2, 8, 100), null);
});

test("balise du téléphone : fréquence, déplacement, précision", () => {
  const a = { t: 1000, lat: 33, lon: -7 };
  assert.strictEqual(N.baliseTelRetenir(null, { t: 1, lat: 33, lon: -7 }), true);
  assert.strictEqual(N.baliseTelRetenir(a, { t: 1010, lat: 33.01, lon: -7 }), false); // trop tôt
  assert.strictEqual(N.baliseTelRetenir(a, { t: 1030, lat: 33.01, lon: -7 }), true);   // 20 s et 1 km
  assert.strictEqual(N.baliseTelRetenir(a, { t: 1030, lat: 33, lon: -7 }), false);      // immobile
  assert.strictEqual(N.baliseTelRetenir(a, { t: 1100, lat: 33, lon: -7 }), true);       // 60 s : signe de vie
  assert.strictEqual(N.baliseTelRetenir(a, { t: 2000, lat: 33.5, lon: -7, precision: 900 }), false);
});

test("GPS : température lue dans le CSV et réduite pour le stockage", () => {
  const r = N.gpsParseCSV("Horodatage;Latitude;Longitude;Vitesse;Température (°C)\n10/11/2026 08:00:00;35,8;-5,5;60;4,5\n10/11/2026 08:02:00;35,81;-5,5;60;4,6\n10/11/2026 08:06:00;35,82;-5,5;60;");
  assert.strictEqual(r.ok, true); assert.strictEqual(r.points[0][4], 4.5); assert.strictEqual(r.points[2][4], null);
  const t = N.gpsTemperatures(r.points); assert.deepStrictEqual([...t.map((x) => x[1])], [4.5]); // une mesure toutes les 5 min : la 2ᵉ est trop proche, la 3ᵉ n'a pas de valeur
  const tr = N.directDepuisTraccar([{ id: 1, uniqueId: "X" }], [{ deviceId: 1, fixTime: "2026-11-10T08:00:00Z", latitude: 35, longitude: -5, speed: 0, attributes: { temp1: 3.2 } }]);
  assert.strictEqual(tr[0].temp, 3.2);
});

(async () => {
  let ok = 0;
  for (const [nom, fn] of tests) {
    N.S = N.etatVide();
    try { await fn(); ok++; console.log("✓", nom); } catch (e) { console.error("✗", nom, "\n ", e.message); process.exitCode = 1; }
  }
  console.log(`\n${ok}/${tests.length} test(s) réussi(s)`);
})();
