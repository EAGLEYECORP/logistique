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
for (const f of ["data.js", "noyau.js", "aller_retour.js", "lecture_commande.js", "boite.js", "documents_commande.js", "quais.js", "quais_gps.js", "fret_retour.js", "devis.js", "plein.js", "relances.js", "pdf.js", "facture_pdf.js", "preuve_pdf.js", "adm.js", "gps.js", "conformite.js", "pilotage.js", "couts.js", "rentabilite.js", "capture.js", "tresorerie.js", "investissement.js", "anomalies.js", "optimisation.js", "journal.js", "prevision.js", "jalons_notifications.js", "comptes.js", "planning.js", "portuaire.js", "passages.js", "ports_gps.js", "fiche.js", "liens.js", "itineraire.js", "coupures.js", "creneaux.js", "prixjour.js", "ia.js", "stockage.js", "sauvegarde.js"]) vm.runInContext(fs.readFileSync(path.join(racine, f), "utf8"), ctx, { filename: f });
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

/* ---------- fichier .ddd (carte conducteur) construit d'après la spécification ---------- */
function construireDDD({ bufferTaille = 600, jours, nom = "BENALI", prenoms = "KARIM", signature = true, gen = 0 }) {
  const rec = (j, prevLen) => { const o = []; const len = 12 + 2 * j.changes.length; o.push(prevLen >> 8, prevLen & 255, len >> 8, len & 255, (j.date >>> 24) & 255, (j.date >>> 16) & 255, (j.date >>> 8) & 255, j.date & 255, 0, 1, (j.distance >> 8) & 255, j.distance & 255);
    for (const [slot, equipe, sans, act, min] of j.changes) { const v = (slot << 15) | (equipe << 14) | (sans << 13) | (act << 11) | min; o.push(v >> 8, v & 255); } return o; };
  let prev = 0; const recs = jours.map((j) => { const r = rec(j, prev); prev = r.length; return r; });
  const total = recs.reduce((s, r) => s + r.length, 0); assert.ok(total <= bufferTaille);
  const debut = bufferTaille - Math.floor(recs[0].length / 2); // le plus ancien commence vers la fin du tampon : la chaîne boucle
  const tampon = new Array(bufferTaille).fill(0); let p = debut, dernier = debut;
  for (const r of recs) { dernier = p; for (const b of r) { tampon[p] = b; p = (p + 1) % bufferTaille; } }
  const donnees = [debut >> 8, debut & 255, dernier >> 8, dernier & 255, ...tampon];
  const tlv = (fid, type, d) => [fid >> 8, fid & 255, type, d.length >> 8, d.length & 255, ...d];
  const texte = (s, n) => { const b = new Array(n).fill(32); b[0] = 1; [...s].forEach((c, i) => { b[1 + i] = c.charCodeAt(0); }); return b; };
  const ident = [...new Array(65).fill(0).map((_, i) => (i >= 1 && i < 17 ? "12345678901234".padEnd(16, " ").charCodeAt(i - 1) : 0)), ...texte(nom, 36), ...texte(prenoms, 36), 0, 0, 0, 0, 0, 0];
  return new Uint8Array([...tlv(0x0520, gen, ident), ...tlv(0x0520, gen + 1, [1, 2, 3]), ...tlv(0x0504, gen, donnees), ...(signature ? tlv(0x0504, gen + 1, [9, 9, 9]) : [])]);
}
const midnight = (j) => Date.UTC(2026, 10, j) / 1000;
test("tachygraphe .ddd : TLV, tampon circulaire avec bouclage, bits des changements d'activité, identité", () => {
  // jour 1 : repos 00:00, conduite 05:00, repos 09:00 (45 min), conduite 09:45, repos 14:00 ; jour 2 : repos puis travail 06:00 et conduite 07:00
  const ddd = construireDDD({ jours: [
    { date: midnight(10), distance: 600, changes: [[0, 0, 0, 0, 0], [0, 0, 0, 3, 300], [0, 0, 0, 0, 540], [0, 0, 0, 3, 585], [0, 0, 0, 0, 840]] },
    { date: midnight(11), distance: 100, changes: [[0, 0, 0, 0, 0], [0, 0, 0, 2, 360], [0, 0, 0, 3, 420], [0, 0, 0, 0, 600]] }] });
  const r = N.tachyParseDDD(ddd);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.generation, 1); assert.strictEqual(r.jours, 2);
  assert.strictEqual(r.conducteur.nom, "BENALI"); assert.strictEqual(r.conducteur.prenoms, "KARIM"); assert.ok(/^1234567890/.test(r.conducteur.carte));
  const c = r.activites.filter((a) => a.type === "conduite"); assert.strictEqual(c.length, 3);
  assert.strictEqual(c[0].debut, midnight(10) + 300 * 60); assert.strictEqual(c[0].fin, midnight(10) + 540 * 60);
  assert.strictEqual(c[1].fin - c[1].debut, (840 - 585) * 60);
  assert.strictEqual(r.activites.find((a) => a.type === "travail").debut, midnight(11) + 360 * 60);
  // le dernier changement du jour 2 se prolonge jusqu'à minuit
  assert.strictEqual(r.activites[r.activites.length - 1].fin, midnight(12));
  // la sortie alimente l'analyse comme un CSV
  assert.strictEqual(N.tachyAnalyser(r.activites).infractions.filter((i) => i.type === "conduite_continue").length, 0);
});

test("tachygraphe .ddd : carte retirée = repos, 2ᵉ génération, fichiers refusés", () => {
  const ddd = construireDDD({ gen: 2, jours: [{ date: midnight(10), distance: 1, changes: [[0, 0, 0, 3, 0], [0, 0, 1, 0, 600], [0, 0, 0, 3, 700]] }] });
  const r = N.tachyParseDDD(ddd); assert.strictEqual(r.generation, 2);
  assert.strictEqual(r.activites[0].type, "conduite"); assert.strictEqual(r.activites[1].type, "repos"); assert.strictEqual(r.activites[1].fin - r.activites[1].debut, 100 * 60);
  assert.strictEqual(N.tachyParseDDD(new Uint8Array([1, 2, 3])).ok, false);
  assert.strictEqual(N.tachyParseDDD(new TextEncoder().encode("Conducteur;Début;Fin;Activité\nA;1;2;C")).ok, false);
  const sansActivite = N.tachyParseDDD(new Uint8Array([0x05, 0x20, 0, 0, 3, 1, 2, 3])); assert.strictEqual(sansActivite.ok, false); assert.ok(/Aucune donnée d'activité/.test(sansActivite.erreur));
  const tronque = construireDDD({ jours: [{ date: midnight(10), distance: 1, changes: [[0, 0, 0, 3, 0]] }] }); assert.strictEqual(N.tachyParseDDD(tronque.subarray(0, tronque.length - 30)).ok, false);
});

test("relevé de télépéage européen : colonnes, période du voyage, devises", () => {
  const csv = "Date;Description;Pays;Montant;Devise;Plaque\n09/11/2026 18:00;A7 Orange;FR;41,20;EUR;12345-A-6\n10/11/2026 09:15;AP-7;ES;22,10;EUR;12345-A-6\n11/11/2026 14:00;Mautstelle;DE;80,00;EUR;12345-A-6\n11/11/2026 15:00;Gotthard;CH;30,00;CHF;12345-A-6\n20/12/2026 10:00;Hors période;FR;99,00;EUR;12345-A-6\nerreur;;;;;\n";
  const r = N.releveEuParse(csv); assert.strictEqual(r.ok, true); assert.strictEqual(r.lignes.length, 5); assert.strictEqual(r.rejetes, 1); assert.strictEqual(r.lignes[0].pays, "FR");
  const v = N.peagesEuDepuisReleve(r.lignes, "2026-11-10", "2026-11-11");
  assert.strictEqual(v.eur, 102.1); assert.strictEqual(v.nb, 2); assert.strictEqual(v.autresDevises, 1); assert.deepStrictEqual({ ...v.pays }, { ES: 22.1, DE: 80 }); // 9/11 avant le départ, 20/12 après le retour : exclus
  assert.strictEqual(N.releveEuParse("a;b\n1;2").ok, false);
  N.S.params.tauxEUR = 10; N.S.camions = [];
  assert.strictEqual(N.coutVoyage({ peagesEurReel: 102.1, kmPays: "DE 1000", peagesEur: 5 }).parts.peagesEurope, 1021); // le relevé réel passe avant l'estimation
});

test("synchronisation : fusion à trois voies par enregistrement", () => {
  const base = { camions: [{ id: "c1", immat: "A", km: 100 }, { id: "c2", immat: "B", km: 200 }, { id: "c3", immat: "C" }], clients: [{ id: "k1", nom: "X" }], params: { tauxEUR: 10.8, prixGasoil: 11 }, meta: { version: 6 } };
  const local = { camions: [{ id: "c1", immat: "A", km: 150 }, { id: "c2", immat: "B", km: 200 }, { id: "c4", immat: "D" }], clients: [{ id: "k1", nom: "X" }], params: { tauxEUR: 10.8, prixGasoil: 12 }, meta: { version: 6 } }; // c1 modifié, c3 supprimé, c4 ajouté
  const remote = { camions: [{ id: "c1", immat: "A", km: 100 }, { id: "c2", immat: "B", km: 260 }, { id: "c3", immat: "C" }, { id: "c5", immat: "E" }], clients: [{ id: "k1", nom: "X" }, { id: "k2", nom: "Y" }], params: { tauxEUR: 11, prixGasoil: 11 }, meta: { version: 6 } }; // c2 modifié, c5 et k2 ajoutés
  const r = N.fusionnerEtat(base, local, remote);
  const cam = Object.fromEntries(r.etat.camions.map((c) => [c.id, c]));
  assert.strictEqual(cam.c1.km, 150); assert.strictEqual(cam.c2.km, 260); assert.ok(cam.c4 && cam.c5); assert.ok(!cam.c3, "supprimé ici, inchangé là-bas : supprimé");
  assert.strictEqual(r.etat.clients.length, 2); assert.strictEqual(r.etat.params.tauxEUR, 11); assert.strictEqual(r.etat.params.prixGasoil, 12); // chaque réglage vient du côté qui l'a changé
  assert.strictEqual(r.conflits, 0); assert.strictEqual(r.recus, 3); assert.strictEqual(r.envoyes, 3); // reçus : c2, c5, k2 · envoyés : c1 (modifié), c3 (supprimé), c4 (ajouté)
});

test("synchronisation : conflits (cet appareil l'emporte), modification contre suppression, première synchronisation", () => {
  const base = { camions: [{ id: "c1", km: 1 }, { id: "c2", km: 2 }] };
  const c = N.fusionnerEtat(base, { camions: [{ id: "c1", km: 10 }, { id: "c2", km: 2 }] }, { camions: [{ id: "c1", km: 20 }, { id: "c2", km: 2 }] });
  assert.strictEqual(c.etat.camions[0].km, 10); assert.strictEqual(c.conflits, 1);
  const m = N.fusionnerEtat(base, { camions: [{ id: "c2", km: 2 }] /* c1 supprimé ici */ }, { camions: [{ id: "c1", km: 99 } /* modifié là-bas */, { id: "c2", km: 2 }] });
  assert.strictEqual(m.etat.camions.find((x) => x.id === "c1").km, 99); assert.strictEqual(m.conflits, 1); // la modification est gardée : rien ne se perd en silence
  const p = N.fusionnerEtat(null, { camions: [{ id: "a", km: 1 }] }, { camions: [{ id: "b", km: 2 }] }); assert.strictEqual(p.etat.camions.length, 2);
  const g = N.fusionnerEtat({ gares: [] }, { gares: [{ nom: "RABAT", lat: 1 }] }, { gares: [{ nom: "KENITRA", lat: 2 }] }); assert.deepStrictEqual([...g.etat.gares.map((x) => x.nom)].sort(), ["KENITRA", "RABAT"]); // enregistrements sans id : clé = nom
  const s = N.fusionnerEtat({ v: 1 }, { v: 1, nouveau: 5 }, { v: 2 }); assert.strictEqual(s.etat.v, 2); assert.strictEqual(s.etat.nouveau, 5);
  const id = N.fusionnerEtat(base, base, base); assert.strictEqual(JSON.stringify(id.etat), JSON.stringify(base)); assert.strictEqual(id.conflits, 0);
});

test("péages de France : liaisons officielles VINCI, classe selon les essieux, pas de double compte avec les km par pays", () => {
  assert.strictEqual(N.FR_LIAISONS.length, 30); assert.strictEqual(N.FR_LIAISONS_DATE, "2026-02-01");
  const perthus = N.FR_LIAISONS.find((l) => l[1] === "Montpellier / Espagne (Perthus)"); assert.deepStrictEqual([...perthus.slice(2)], [23.1, 35.3, 50.9, 62.5, 13]);
  N.S.params.tauxEUR = 10; N.S.params.peagesEu = { FR: 0.3, ES: 0.2 };
  N.S.camions = [{ id: "a", essieux: 5 }, { id: "p", essieux: 2 }];
  const v = { camionId: "a", peageFr1: "Montpellier / Espagne (Perthus)", peageFr2: "Lyon / Montpellier", kmPays: "FR 900, ES 1000" };
  const f = N.peagesFranceVoyage(v); assert.strictEqual(f.classe, 4); assert.strictEqual(f.eur, 155.1); // 62,50 + 92,60
  assert.strictEqual(N.peagesFranceVoyage({ ...v, camionId: "p" }).eur, 121.6); // classe 3 : 50,90 + 70,70
  assert.strictEqual(N.peagesFranceVoyage({ ...v, peageFrAR: true }).eur, 310.2);
  assert.deepStrictEqual({ ...N.peagesEuropeVoyage(v) }.eur, 200); // la France (900 km) n'est pas comptée deux fois : seule l'Espagne reste
  const c = N.coutVoyage(v); assert.strictEqual(c.parts.peagesFrance, 1551); assert.strictEqual(c.parts.peagesEurope, 2000);
  assert.strictEqual(N.peagesFranceVoyage({ camionId: "a" }).eur, 0);
  assert.strictEqual(N.coutVoyage({ camionId: "a", kmPays: "FR 900" }).parts.peagesEurope, 2700); // sans liaison choisie : estimation au km
});

test("diagnostic .ddd : structure lue sans donnée personnelle", () => {
  const ddd = construireDDD({ jours: [{ date: midnight(10), distance: 1, changes: [[0, 0, 0, 3, 0], [0, 0, 0, 0, 600]] }, { date: midnight(11), distance: 1, changes: [[0, 0, 0, 0, 0]] }] });
  const d = N.tachyDiagnosticDDD(ddd);
  assert.ok(/EF 0504 · génération 0|EF 0504 · génération 1/.test(d)); assert.ok(/2 jour\(s\) du 2026-11-10 au 2026-11-11/.test(d)); assert.ok(/3 changement/.test(d));
  assert.ok(!/BENALI|KARIM|12345678901234/.test(d), "ni nom ni numéro de carte");
  assert.ok(/Aucun EF Driver_Activity_Data/.test(N.tachyDiagnosticDDD(new Uint8Array([0x05, 0x20, 0, 0, 1, 9]))));
});

test("carte : cap entre deux positions et modèle d'adresse de tuiles", () => {
  const cap = (a, b) => Math.round(N.gpsCap([0, a[0], a[1]], [0, b[0], b[1]]));
  assert.strictEqual(cap([33, -7], [34, -7]), 0); assert.strictEqual(cap([33, -7], [33, -6]), 90); assert.strictEqual(cap([34, -7], [33, -7]), 180); assert.strictEqual(cap([33, -6], [33, -7]), 270);
  assert.ok(Math.abs(cap([35.889, -5.5], [36.13, -5.44]) - 14) <= 3); // Tanger Med → Algeciras : plein nord, un peu à l'est
  assert.strictEqual(N.tuilesUrlValide("https://tile.openstreetmap.org/{z}/{x}/{y}.png"), true);
  assert.strictEqual(N.tuilesUrlValide("https://api.exemple.com/styles/v1/{z}/{x}/{y}.png?key=ABC"), true);
  for (const x of ["", "http://tile.test/{z}/{x}/{y}.png", "https://tile.test/z/x/y.png", "https://tile.test/{z}/{x}.png", "javascript:alert(1)", null]) assert.strictEqual(N.tuilesUrlValide(x), false);
});

/* ---------- pilotage : rentabilité, prévisions, conformité du voyage ---------- */
function etatRentabilite() {
  N.S.params.tauxEUR = 10; N.S.params.fraisGenerauxMois = 6000; N.S.params.peagesEu = {};
  N.S.camions = [{ id: "c1", immat: "AAA", fixeMensuel: 15000, km: 0, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000 }, { id: "c2", immat: "BBB", km: 0, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000 }];
  N.S.clients = [{ id: "k1", nom: "Souss Export" }, { id: "k2", nom: "Textile Nord" }];
  N.S.voyages = [
    { id: "v1", ref: "V1", statut: "termine", camionId: "c1", clientId: "k1", origine: "agadir", destination: "Perpignan (France)", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-10", prix: 3000, devise: "EUR", carburantMad: 9000, peagesMad: 1000, kmAller: 2000, kmRetourVide: 2000, traversees: [] },
    { id: "v2", ref: "V2", statut: "termine", camionId: "c1", clientId: "k1", origine: "Agadir", destination: "perpignan", dateDepart: "2026-10-15", dateRetourPrevue: "2026-10-22", prix: 3200, devise: "EUR", kmAller: 2000, kmRetourCharge: 2000, traversees: [], commandeId: "o1" },
    { id: "v3", ref: "V3", statut: "annule", camionId: "c1", clientId: "k2", origine: "Tanger", destination: "Madrid", dateDepart: "2026-10-05", dateRetourPrevue: "2026-10-08", prix: 9999, devise: "EUR", traversees: [] },
    { id: "v4", ref: "V4", statut: "termine", camionId: "c2", clientId: "k2", origine: "Tanger", destination: "Madrid", dateDepart: "2026-09-01", dateRetourPrevue: "2026-09-05", prix: 1500, devise: "EUR", carburantMad: 4000, kmAller: 1100, kmRetourVide: 1100, traversees: [] }];
  N.S.pleins = [{ id: "p1", camionId: "c1", date: "2026-10-16", km: 1000, litres: 500, prix: 12, plein: true }, { id: "p2", camionId: "c1", date: "2026-10-20", km: 3000, litres: 400, prix: 10, plein: true }, { id: "p3", camionId: "c1", date: "2026-11-05", km: 3500, litres: 100, prix: 10, plein: true }];
  N.S.interventions = [{ id: "i1", camionId: "c1", date: "2026-10-12", cout: 2000 }, { id: "i2", camionId: "c1", date: "2026-08-01", cout: 7777 }];
  N.S.commandes = [{ id: "o1", statut: "livre", clientId: "k1", camionId: "c1", origine: "Agadir", destination: "Perpignan", dateChargement: "2026-10-15", prix: 3200, devise: "EUR" }, // liée au voyage v2 : ne compte pas deux fois
    { id: "o2", statut: "livre", clientId: "k2", camionId: "c2", origine: "Tanger", destination: "Casablanca", dateChargement: "2026-10-20", dateLivraison: "2026-10-20", prix: 6000, devise: "MAD", autres: 1000 }, { id: "o3", statut: "devis", clientId: "k2", camionId: "c2", origine: "A", destination: "B", dateChargement: "2026-10-21", prix: 5000, devise: "MAD" }];
  N.S.trajets = [];
}
test("rentabilité : carburant saisi ou estimé d'après les pleins, fin de voyage réelle", () => {
  etatRentabilite();
  assert.deepStrictEqual({ ...N.carburantVoyage(N.S.voyages[0]) }, { mad: 9000, estime: false });
  assert.deepStrictEqual({ ...N.carburantVoyage(N.S.voyages[1]) }, { mad: 10000, estime: true, source: "pleins" }); // pleins du 16 et du 20 octobre, pas celui de novembre
  const c = N.coutCompletVoyage(N.S.voyages[1]); assert.strictEqual(c.total, 10000); assert.strictEqual(c.marge, 22000); assert.strictEqual(c.carburantEstime, true); assert.strictEqual(c.jours, 8);
  assert.strictEqual(N.finVoyage({ dateRetourPrevue: "2026-10-10", jalons: [{ type: "retour", date: "2026-10-12T08:00:00Z" }] }), "2026-10-12");
  assert.strictEqual(N.corridorDe("agadir", "PERPIGNAN (France)"), "Agadir → Perpignan");
});

test("rentabilité : coût complet par camion (charges fixes, entretien), commande liée non comptée deux fois, annulés et devis exclus", () => {
  etatRentabilite();
  const r = N.rentabilite({ debut: "2026-10-01", fin: "2026-10-31" });
  assert.strictEqual(r.periode.jours, 31);
  const c1 = r.camions.find((x) => x.id === "c1"), c2 = r.camions.find((x) => x.id === "c2");
  assert.strictEqual(c1.nb, 2); assert.strictEqual(c1.ca, 62000); assert.strictEqual(c1.variable, 10000 + 10000); assert.strictEqual(c1.entretien, 2000); // l'entretien d'août est hors période
  const mois = 31 / 30.4375; assert.ok(Math.abs(c1.fixes - (15000 * mois + (6000 * mois) / 2)) < 0.01);
  assert.ok(Math.abs(c1.cout - (22000 + c1.fixes)) < 0.01); assert.ok(Math.abs(c1.marge - (62000 - c1.cout)) < 0.01);
  assert.strictEqual(c1.km, 8000); assert.strictEqual(c1.kmVide, 2000); assert.strictEqual(c1.pctVide, 25); assert.ok(Math.abs(c1.coutKm - c1.cout / 8000) < 1e-9);
  assert.strictEqual(c2.nb, 1); assert.strictEqual(c2.ca, 6000); assert.strictEqual(c2.variable, 1000); assert.strictEqual(c2.fixeRenseigne, false); // seule la commande o2 : v4 est en septembre, o3 est un devis
  assert.strictEqual(r.totaux.ca, 68000); assert.strictEqual(r.totaux.nb, 3);
  assert.ok(Math.abs(r.totaux.coutKmCharge - r.totaux.cout / 6000) < 1e-9);
  assert.strictEqual(r.avertissements.carburantEstime, 1); assert.strictEqual(r.avertissements.camionsSansFixe, 1); assert.strictEqual(r.avertissements.sansFraisGeneraux, false);
});

test("rentabilité : par client, par corridor, par mois, période complète", () => {
  etatRentabilite();
  const r = N.rentabilite({});
  const k1 = r.clients.find((x) => x.nom === "Souss Export"), k2 = r.clients.find((x) => x.nom === "Textile Nord");
  assert.strictEqual(k1.ca, 62000); assert.strictEqual(k1.nb, 2); assert.strictEqual(k2.ca, 15000 + 6000); assert.strictEqual(k2.nb, 2);
  const ap = r.corridors.find((x) => x.nom === "Agadir → Perpignan"); assert.strictEqual(ap.nb, 2); assert.strictEqual(ap.km, 8000); assert.strictEqual(ap.marge, 62000 - 20000); // « agadir » et « Agadir », « Perpignan (France) » : même corridor
  assert.ok(r.corridors.some((x) => x.nom === "Tanger → Madrid")); assert.ok(!r.corridors.some((x) => /9999/.test(String(x.ca))));
  assert.deepStrictEqual([...r.mois.map((m) => m.nom)], ["2026-09", "2026-10"]);
  assert.strictEqual(r.totaux.entretien, 2000 + 7777); // toute la période : l'entretien d'août est compté
  N.S.voyages = []; N.S.commandes = []; N.S.interventions = []; const v = N.rentabilite({}); assert.strictEqual(v.totaux.ca, 0); assert.strictEqual(v.totaux.coutKm, 0);
});

test("prévisions : entretien d'après les kilomètres par jour, attente aux ports, autorisations, Schengen", () => {
  N.S.camions = [{ id: "c", immat: "AAA", km: 39000, kmVidange: 0, intervalleVidange: 40000, kmPneus: 0, intervallePneus: 100000 }];
  N.S.pleins = [{ id: "a", camionId: "c", date: jour(-20), km: 35000, litres: 1, prix: 1 }, { id: "b", camionId: "c", date: jour(0), km: 39000, litres: 1, prix: 1 }];
  assert.strictEqual(N.kmParJour("c"), 200);
  const e = N.previsionsEntretien(); assert.strictEqual(e[0].type, "Vidange"); assert.strictEqual(e[0].jours, 5); assert.strictEqual(e[0].date, jour(5));
  N.S.traces = [{ visites: [{ zone: "Port de Tanger Med", type: "port_maroc", entree: 0, sortie: 7200 }, { zone: "Port de Tanger Med", type: "port_maroc", entree: 0, sortie: 10800 }, { zone: "Port de Tanger Med", type: "port_maroc", entree: 0, sortie: 21600 }, { zone: "Port de Tanger Med", type: "port_maroc", entree: 0, sortie: 60 }, { zone: "Dépôt", type: "depot", entree: 0, sortie: 99999 }] }];
  const sp = N.statsPorts(); assert.strictEqual(sp.length, 1); assert.strictEqual(sp[0].n, 3); assert.strictEqual(sp[0].medianeH, 3); assert.strictEqual(sp[0].maxH, 6); // le passage d'une minute et le dépôt sont ignorés
  N.S.voyages = [{ id: "v", ref: "V", statut: "prevu", dateDepart: jour(3), dateRetourPrevue: jour(9) }, { id: "w", ref: "W", statut: "prevu", dateDepart: jour(20), dateRetourPrevue: jour(25) }];
  N.S.autorisations = [{ id: "a", type: "E", mode: "voyage", fin: jour(60) }];
  N.S.chauffeurs = [{ id: "h", nom: "Karim", sejours: [{ entree: jour(-70), sortie: "" }] }];
  const p = N.previsions().map((x) => x.texte).join(" | ");
  assert.ok(/AAA — vidange probable vers le/.test(p)); assert.ok(/2 voyage\(s\) prévu\(s\) sous 30 jours sans autorisation, pour 1 autorisation/.test(p));
  assert.ok(/habituellement 3,0 h au port de Tanger Med/.test(p)); assert.ok(/Karim — s'il reste en Europe, la limite Schengen/.test(p));
  assert.strictEqual(N.previsions()[0].niveau, "warn");
});

test("dossier de voyage : papiers valides, expirant pendant le voyage, expirés au départ, non renseignés", () => {
  N.S.chauffeurs = [{ id: "h", nom: "Karim", permis: "2027-01-01", visa: "2026-11-15", passeport: "2026-10-01" }];
  N.S.camions = [{ id: "c", immat: "AAA", assurance: "2027-06-01" }];
  N.S.autorisations = [{ id: "a", type: "E", fin: "2026-12-31" }];
  const r = N.conformiteVoyage({ chauffeurId: "h", camionId: "c", autorisationId: "a", dateDepart: "2026-11-10", dateRetourPrevue: "2026-11-20" });
  const s = (piece) => r.find((x) => x.piece === piece).statut;
  assert.strictEqual(s("Permis"), "valide"); assert.strictEqual(s("Visa Schengen"), "expire_pendant"); assert.strictEqual(s("Passeport"), "expire_au_depart"); assert.strictEqual(s("Carte conducteur"), "non_renseigne");
  assert.strictEqual(s("Assurance"), "valide"); assert.strictEqual(s("Autorisation bilatérale"), "valide");
  assert.strictEqual(N.conformiteVoyage({ dateDepart: "2026-11-10", dateRetourPrevue: "2026-11-20" }).find((x) => x.piece === "Autorisation bilatérale").statut, "non_renseigne");
});

test("synchronisation des photos : plan à trois voies", () => {
  const p = N.planPhotos(["a", "b", "c", "d"], ["a", "e", "f"], ["c"], ["a", "d", "f"]);
  assert.deepStrictEqual([...p.envoyer], ["b", "d"]);        // b : nouvelle ici · d : connue mais disparue du serveur sans trace (serveur réinitialisé) → renvoyée
  assert.deepStrictEqual([...p.supprimerLocal], ["c"]);       // supprimée sur un autre appareil
  assert.deepStrictEqual([...p.recevoir], ["e"]);             // nouvelle ailleurs
  assert.deepStrictEqual([...p.supprimerServeur], ["f"]);     // déjà synchronisée ici puis supprimée ici
  const rien = N.planPhotos(["a"], ["a"], [], ["a"]); assert.strictEqual(rien.envoyer.length + rien.recevoir.length + rien.supprimerLocal.length + rien.supprimerServeur.length, 0);
  assert.deepStrictEqual([...N.planPhotos([], ["x"], [], []).recevoir], ["x"]); // premier appareil vide : tout est reçu, rien n'est supprimé
});

test("synchronisation des photos : emballage, chiffrement et restitution à l'identique", async () => {
  const image = new Uint8Array(3000).map((_, i) => (i * 7) % 256), mini = new Uint8Array(400).map((_, i) => (i * 3) % 256);
  const meta = { id: "ph1", cible: "voyage:v1", nom: "CMR signé.jpg", date: "2026-11-10T10:00:00.000Z", w: 1600, h: 1200, taille: 3000 };
  const paquet = N.photoEmballer(meta, image, mini);
  const chiffre = await N.chiffrer(paquet, "secret123");
  assert.ok(!new TextDecoder("latin1").decode(chiffre).includes("voyage:v1"), "ni la cible ni le nom ne sont lisibles sur le serveur");
  const r = N.photoDeballer(await N.dechiffrer(chiffre, "secret123"));
  assert.strictEqual(r.meta.cible, "voyage:v1"); assert.strictEqual(r.meta.nom, "CMR signé.jpg"); assert.strictEqual(r.image.length, 3000); assert.strictEqual(r.mini.length, 400);
  assert.ok(r.image.every((x, i) => x === image[i]) && r.mini.every((x, i) => x === mini[i]));
  await assert.rejects(() => N.dechiffrer(chiffre, "autre"));
  assert.throws(() => N.photoDeballer(paquet.subarray(0, paquet.length - 10)), /tronquée/); assert.throws(() => N.photoDeballer(new Uint8Array([0, 0])), /illisible/);
});

/* ---------- schéma 7 : lignes de coût, charges fixes, charges générales, échéances ---------- */
test("migration 6 → 7 : rien n'est perdu, les anciens champs restent et sont projetés en lignes", () => {
  const v6 = { meta: { version: 6 }, params: { tauxEUR: 10, fraisGenerauxMois: 3000 }, camions: [{ id: "c1", immat: "A", fixeMensuel: 9000 }],
    voyages: [{ id: "v1", ref: "V1", prix: 30000, devise: "MAD", peagesMad: 500, peagesEur: 100, carburantMad: 8000, fraisRouteMad: 1500, douaneMad: 700, autresMad: 200, kmAller: 1000 }] };
  const avant = JSON.stringify(v6.voyages[0]);
  const r = N.migrer(JSON.parse(JSON.stringify(v6)));
  assert.strictEqual(r.migre, true); assert.strictEqual(r.etat.meta.version, N.VERSION_SCHEMA); assert.ok(N.VERSION_SCHEMA >= 7);
  assert.deepStrictEqual([...r.etat.chargesGenerales], []); assert.deepStrictEqual([...r.etat.echeances], []);
  const v = r.etat.voyages[0];
  assert.deepStrictEqual([...v.lignesCout], []);
  const { lignesCout, ...reste } = v; assert.strictEqual(JSON.stringify(reste), avant, "aucun ancien champ modifié");
  N.S = r.etat;
  const l = N.lignesVoyage(v), par = (t) => l.filter((x) => x.type === t).reduce((s, x) => s + x.mad, 0);
  assert.ok(l.every((x) => x.projete));
  assert.strictEqual(par("peage_ma"), 500); assert.strictEqual(par("peage_eu"), 1000); assert.strictEqual(par("carburant"), 8000);
  assert.strictEqual(par("per_diem_chauffeur"), 1500); assert.strictEqual(par("douane_frais"), 700); assert.strictEqual(par("autre"), 200);
  const c = N.coutVoyage(v); assert.strictEqual(c.total, 11900); assert.strictEqual(c.marge, 18100);
  // aller-retour : une deuxième migration ne change rien
  const r2 = N.migrer(JSON.parse(JSON.stringify(r.etat))); assert.strictEqual(r2.migre, false); assert.strictEqual(JSON.stringify(r2.etat.voyages), JSON.stringify(r.etat.voyages));
  // l'ancien montant de charges fixes et de frais généraux reste lu
  assert.strictEqual(N.fixesMensuelsCamion(N.S.camions[0]).total, 9000); assert.strictEqual(N.chargesGeneralesMois()[0].montant, 3000);
});

test("lignes de coût : validation, devise, camion et chauffeur du voyage par défaut", () => {
  N.S.params.tauxEUR = 10;
  const v = { id: "v1", camionId: "c1", chauffeurId: "h1" };
  const l = N.ajouterLigneCout(v, { type: "parking_securise", montant: "25", devise: "EUR", date: "2026-11-02", ref: "P-88" });
  assert.strictEqual(l.camionId, "c1"); assert.strictEqual(l.chauffeurId, "h1"); assert.strictEqual(l.source, "saisie"); assert.strictEqual(l.ref, "P-88"); assert.ok(l.id);
  assert.strictEqual(N.ligneCoutMad(l), 250);
  assert.throws(() => N.ajouterLigneCout(v, { type: "inconnu", montant: 5 }), /Type de coût inconnu/);
  assert.throws(() => N.ajouterLigneCout(v, { type: "autre", montant: -5 }), /Montant invalide/);
  assert.throws(() => N.ajouterLigneCout(v, { type: "autre", montant: 5, devise: "USD" }), /Devise/);
  assert.throws(() => N.ajouterLigneCout(v, { type: "autre", montant: 5, source: "magie" }), /Source/);
  assert.strictEqual(v.lignesCout.length, 1, "une ligne refusée n'est pas enregistrée");
  assert.deepStrictEqual([...N.ligneCoutErreurs({ type: "autre", montant: 1, devise: "MAD", source: "saisie", date: "hier" })], ["Date invalide"]);
  assert.strictEqual(N.retirerLigneCout(v, l.id), true); assert.strictEqual(N.retirerLigneCout(v, "x"), false); assert.strictEqual(v.lignesCout.length, 0);
  assert.strictEqual(N.TYPES_COUT.length, 20); assert.strictEqual(new Set(N.TYPES_COUT.map((t) => t[0])).size, 20);
});

test("une ligne réelle remplace l'estimation de son type, sans double compte ; les autres types s'ajoutent", () => {
  N.S.params.tauxEUR = 10;
  const v = { id: "v1", prix: 50000, devise: "MAD", peagesMad: 500, carburantMad: 8000, fraisRouteMad: 1500, douaneMad: 700, kmAller: 2000 };
  assert.strictEqual(N.coutVoyage(v).total, 10700);
  N.ajouterLigneCout(v, { type: "carburant", montant: 600, devise: "EUR", source: "fuel_card_csv" });
  N.ajouterLigneCout(v, { type: "carburant", montant: 3000, source: "fuel_card_csv" });
  let c = N.coutVoyage(v); assert.strictEqual(c.parts.carburant, 9000, "les lignes remplacent les 8 000 saisis"); assert.strictEqual(c.total, 11700);
  assert.strictEqual(N.carburantVoyage(v).mad, 9000); assert.strictEqual(N.coutCompletVoyage(v).total, 11700);
  N.ajouterLigneCout(v, { type: "parking_securise", montant: 20, devise: "EUR" }); // autre type de la même rubrique : s'ajoute au per diem saisi
  c = N.coutVoyage(v); assert.strictEqual(c.parts.fraisRoute, 1700);
  N.ajouterLigneCout(v, { type: "per_diem_chauffeur", montant: 2000, source: "calcule" });
  c = N.coutVoyage(v); assert.strictEqual(c.parts.fraisRoute, 2200, "le per diem calculé remplace l'ancienne saisie");
  N.ajouterLigneCout(v, { type: "amendes", montant: 150, devise: "EUR" }); N.ajouterLigneCout(v, { type: "maintien", montant: 900 }); N.ajouterLigneCout(v, { type: "froid_energie", montant: 400 });
  c = N.coutVoyage(v); assert.strictEqual(c.parts.amendes, 1500); assert.strictEqual(c.parts.maintien, 900); assert.strictEqual(c.parts.froid, 400);
  assert.strictEqual(c.total, 500 + 9000 + 2200 + 700 + 1500 + 900 + 400); assert.strictEqual(c.marge, 50000 - c.total); assert.strictEqual(c.coutKm, c.total / 2000);
  // un coût de structure enregistré sur le voyage n'entre pas dans les coûts directs
  N.ajouterLigneCout(v, { type: "charges_fixes", montant: 9999, source: "calcule" }); assert.strictEqual(N.coutVoyage(v).total, c.total);
  assert.strictEqual(N.lignesVoyage(v).filter((l) => l.projete).map((l) => l.type).sort().join(), "douane_frais,peage_ma");
});

test("traversée : la facture d'un sens ne remplace que l'estimation de ce sens", () => {
  N.S.params.tauxEUR = 10;
  const v = { id: "v1", traversees: [{ sens: "aller", ligne: "tmed-alg", fret: 300, ml: 16.5, baf: 2 }, { sens: "retour", ligne: "alg-tmed", fret: 280 }] };
  const est = N.coutVoyage(v).parts.traversees, aller = N.coutTraversee(v.traversees[0]) * 10, retour = N.coutTraversee(v.traversees[1]) * 10;
  assert.ok(aller > 0 && retour > 0); assert.strictEqual(est, aller + retour);
  N.ajouterLigneCout(v, { type: "traversee", montant: 410, devise: "EUR", source: "facture_armateur", sens: "aller", ref: "FAC-1" });
  assert.strictEqual(N.coutVoyage(v).parts.traversees, 4100 + retour);
  N.ajouterLigneCout(v, { type: "traversee", montant: 390, devise: "EUR", source: "facture_armateur", sens: "retour" });
  assert.strictEqual(N.coutVoyage(v).parts.traversees, 8000);
  const w = { id: "v2", traversees: v.traversees }; N.ajouterLigneCout(w, { type: "traversee", montant: 700, devise: "EUR", source: "facture_armateur" }); // facture globale, sans sens
  assert.strictEqual(N.coutVoyage(w).parts.traversees, 7000);
});

test("amortissement : linéaire, dégressif, valeur résiduelle, avant l'achat et après la fin", () => {
  const c = { amortissement: { prix_acquisition: 1200000, date_acquisition: "2024-01-15", duree_ans: 5, valeur_residuelle: 200000, methode: "lineaire" } };
  let a = N.amortissementCamion(c, "2025-01-15"); assert.ok(Math.abs(a.mensuel - 1000000 / 60) < 1e-6); assert.ok(Math.abs(a.cumul - 200000) < 1e-6); assert.ok(Math.abs(a.vnc - 1000000) < 1e-6);
  a = N.amortissementCamion(c, "2023-06-01"); assert.strictEqual(a.mensuel, 0); assert.strictEqual(a.vnc, 1200000);
  a = N.amortissementCamion(c, "2029-02-01"); assert.strictEqual(a.mensuel, 0); assert.strictEqual(a.vnc, 200000); assert.strictEqual(a.termine, true);
  const d = { amortissement: { prix_acquisition: 1000000, date_acquisition: "2024-01-01", duree_ans: 5, methode: "degressif" } };
  // coefficient 2 sur 5 ans : 40 % de la valeur restante, puis linéaire sur le reste — 400 000, 240 000, 144 000, 108 000, 108 000
  const annuites = [0, 12, 24, 36, 48].map((m) => Math.round(N.amortissementCamion(d, N.ajouterMois("2024-01-01", m)).mensuel * 12));
  assert.deepStrictEqual(annuites, [400000, 240000, 144000, 108000, 108000]); assert.strictEqual(annuites.reduce((x, y) => x + y, 0), 1000000);
  assert.ok(Math.abs(N.amortissementCamion(d, "2025-07-01").vnc - (1000000 - 400000 - 120000)) < 1e-6);
  assert.strictEqual(N.amortissementCamion({}).renseigne, false); assert.strictEqual(N.amortissementCamion({ amortissement: { prix_acquisition: 5 } }).mensuel, 0);
});

test("charges fixes d'un camion : le détail remplace l'ancien montant global ; le budget d'entretien n'est pas compté", () => {
  const c = { fixeMensuel: 9000, coutsFixes: { leasing_mensuel: 12000, assurance_mensuel: 1500, taxe_routiere_annuelle: 6000, entretien_mensuel_budget: 2000 }, amortissement: { prix_acquisition: 600000, date_acquisition: "2025-01-01", duree_ans: 5 } };
  const f = N.fixesMensuelsCamion(c, "2026-01-01");
  assert.strictEqual(f.detail, true); assert.strictEqual(f.taxe, 500); assert.strictEqual(f.amortissement, 10000); assert.strictEqual(f.total, 24000); assert.strictEqual(f.entretienBudget, 2000);
  assert.strictEqual(N.fixesMensuelsCamion({ fixeMensuel: 9000 }).total, 9000); assert.strictEqual(N.fixesMensuelsCamion({ fixeMensuel: 9000, coutsFixes: {} }).detail, false); assert.strictEqual(N.fixesMensuelsCamion({}).total, 0);
});

test("répartition des charges : au kilomètre, au chiffre d'affaires, par camion, à parts égales — la somme est exacte", () => {
  const u = [{ id: "a", camionId: "c1", km: 1000, ca: 10000 }, { id: "b", camionId: "c1", km: 3000, ca: 10000 }, { id: "c", camionId: "c2", km: 4000, ca: 30000 }];
  const obj = (m) => Object.fromEntries(m), somme = (m) => [...m.values()].reduce((x, y) => x + y, 0);
  assert.deepStrictEqual(obj(N.repartir(8000, "km", u)), { a: 1000, b: 3000, c: 4000 });
  assert.deepStrictEqual(obj(N.repartir(5000, "revenue", u)), { a: 1000, b: 1000, c: 3000 });
  assert.deepStrictEqual(obj(N.repartir(8000, "camion_count", u)), { a: 2000, b: 2000, c: 4000 }); // moitié par camion, puis partagée entre les voyages du camion
  const eg = N.repartir(1000, "equal", u); assert.ok(Math.abs(eg.get("a") - 1000 / 3) < 1e-9); assert.strictEqual(somme(eg), 1000);
  assert.strictEqual(somme(N.repartir(100, "km", [{ id: "x", km: 1 }, { id: "y", km: 1 }, { id: "z", km: 1 }])), 100);
  assert.deepStrictEqual(obj(N.repartir(900, "km", [{ id: "x", km: 0 }, { id: "y", km: 0 }])), { x: 450, y: 450 }); // aucun kilomètre connu : parts égales
  assert.strictEqual(N.repartir(900, "km", []).size, 0);
});

test("charges générales : liste détaillée avec clé de répartition ; la rentabilité par camion les applique", () => {
  N.S.camions = [{ id: "c1", immat: "A", fixeMensuel: 3000 }, { id: "c2", immat: "B", coutsFixes: { leasing_mensuel: 6000 } }];
  N.S.params.fraisGenerauxMois = 500; // ignoré dès qu'une liste détaillée existe
  N.S.chargesGenerales = [{ id: "g1", libelle: "Loyer Tanger", montant_mensuel: 4000, categorie: "loyer", cle_allocation: "km" }, { id: "g2", montant_mensuel: 2000, categorie: "comptable", cle_allocation: "equal" }, { id: "g3", montant_mensuel: 0, categorie: "autres" }];
  const g = N.chargesGeneralesMois(); assert.strictEqual(g.length, 2); assert.strictEqual(g[1].libelle, "Comptable"); assert.strictEqual(g[0].cle, "km");
  N.S.voyages = [{ id: "v1", camionId: "c1", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-08", prix: 40000, devise: "MAD", kmAller: 3000 }, { id: "v2", camionId: "c2", dateDepart: "2026-10-05", dateRetourPrevue: "2026-10-12", prix: 20000, devise: "MAD", kmAller: 1000 }];
  const r = N.rentabilite({ debut: "2026-10-01", fin: "2026-10-31" }), mois = 31 / 30.4375, de = (id) => r.camions.find((x) => x.id === id);
  assert.ok(Math.abs(de("c1").fixes - (3000 + 4000 * 0.75 + 1000) * mois) < 1e-6);
  assert.ok(Math.abs(de("c2").fixes - (6000 + 4000 * 0.25 + 1000) * mois) < 1e-6);
  assert.ok(Math.abs(r.totaux.fixes - 15000 * mois) < 1e-6); assert.strictEqual(r.avertissements.camionsSansFixe, 0); assert.strictEqual(r.avertissements.sansFraisGeneraux, false);
});

test("échéances : ponctuelles et récurrentes (mensuel, trimestriel, annuel), fin de mois, date limite, devise", () => {
  const occ = (e, a, b) => [...N.occurrencesEcheance(e, a, b)];
  assert.deepStrictEqual(occ({ date: "2026-12-20" }, "2026-12-01", "2026-12-31"), ["2026-12-20"]); assert.deepStrictEqual(occ({ date: "2026-12-20" }, "2027-01-01", "2027-12-31"), []);
  assert.deepStrictEqual(occ({ date: "2026-01-31", recurs: { frequence: "mensuel" } }, "2026-02-01", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepStrictEqual(occ({ date: "2025-01-20", recurs: { frequence: "trimestriel" } }, "2026-11-01", "2027-05-01"), ["2027-01-20", "2027-04-20"]);
  assert.deepStrictEqual(occ({ date: "2024-02-29", recurs: { frequence: "annuel" } }, "2025-01-01", "2028-12-31"), ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  assert.deepStrictEqual(occ({ date: "2026-11-05", recurs: { frequence: "mensuel", jusqu_a: "2027-01-04" } }, "2026-11-01", "2027-06-30"), ["2026-11-05", "2026-12-05"]);
  assert.deepStrictEqual(occ({ date: "2027-03-01", recurs: { frequence: "mensuel" } }, "2026-11-01", "2027-04-15"), ["2027-03-01", "2027-04-01"]);
  N.S.params.tauxEUR = 10;
  N.S.echeances = [{ id: "e1", libelle: "Leasing MAN", type: "credit_leasing", montant: 1200, devise: "EUR", date: "2026-11-10", recurs: { frequence: "mensuel" } }, { id: "e2", type: "taxe_tva", montant: 30000, devise: "MAD", date: "2026-11-30" }];
  const e = N.echeancier("2026-11-01", "2026-12-31");
  assert.strictEqual(JSON.stringify(e.map((x) => [x.date, x.mad, x.libelle])), JSON.stringify([["2026-11-10", 12000, "Leasing MAN"], ["2026-11-30", 30000, "TVA"], ["2026-12-10", 12000, "Leasing MAN"]]));
});

/* ---------- D2 : marge du voyage en direct ---------- */
const etatMarge = () => {
  N.S.params.tauxEUR = 10;
  N.S.camions = [{ id: "c1", immat: "A", coutsFixes: { leasing_mensuel: 12175 } }, { id: "c2", immat: "B" }];
  N.S.chargesGenerales = [{ id: "g1", libelle: "Loyer", montant_mensuel: 6000, categorie: "loyer", cle_allocation: "km" }, { id: "g2", libelle: "Comptable", montant_mensuel: 1000, categorie: "comptable", cle_allocation: "revenue" }];
  N.S.voyages = [
    { id: "v1", camionId: "c1", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-10", prix: 5000, devise: "EUR", kmAller: 2500, kmRetourCharge: 1500, kmRetourVide: 1000, carburantMad: 15000, peagesMad: 500, lignesCout: [] },
    { id: "v2", camionId: "c2", dateDepart: "2026-10-12", dateRetourPrevue: "2026-10-20", prix: 30000, devise: "MAD", kmAller: 1000, lignesCout: [] },
    { id: "v3", camionId: "c2", dateDepart: "2026-11-02", dateRetourPrevue: "2026-11-09", prix: 30000, devise: "MAD", kmAller: 1000, lignesCout: [] },
    { id: "v4", camionId: "c2", dateDepart: "2026-10-15", statut: "annule", prix: 99999, devise: "MAD", kmAller: 9000, lignesCout: [] },
  ];
};
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} ${a} ≠ ${b}`);

test("marge d'un voyage : coûts directs, charges fixes au temps passé, charges générales selon leur clé", () => {
  etatMarge();
  const m = N.margeVoyage("v1");
  assert.strictEqual(m.revenu, 50000); assert.strictEqual(m.total_direct, 15500); assert.strictEqual(m.marge_directe, 34500); assert.strictEqual(m.jours, 10);
  proche(m.couts_fixes_alloues[0].montant, (12175 * 10) / 30.4375); assert.strictEqual(m.couts_fixes_alloues[0].cle, "jours"); // 4 000
  // octobre : v1 (5 000 km, 50 000) et v2 (1 000 km, 30 000) — le voyage annulé et celui de novembre ne comptent pas
  const g = Object.fromEntries(m.charges_generales_allouees.map((x) => [x.libelle, x.montant]));
  proche(g.Loyer, 6000 * 5 / 6); proche(g.Comptable, 1000 * 5 / 8);
  proche(m.total_structure, 4000 + 5000 + 625); proche(m.marge_nette, 34500 - 9625); proche(m.taux, ((34500 - 9625) / 50000) * 100);
  assert.strictEqual(m.km, 5000); assert.strictEqual(m.km_charge, 4000); assert.strictEqual(m.km_vide, 1000);
  proche(m.cout_total_par_km, 25125 / 5000); proche(m.cout_par_km_charge, 25125 / 4000); proche(m.cout_vide, 5025);
  // la somme des parts de charges générales des voyages du mois redonne la charge du mois
  const total = ["v1", "v2"].reduce((s, id) => s + N.margeVoyage(id).charges_generales_allouees.reduce((a, x) => a + x.montant, 0), 0); proche(total, 7000);
  proche(N.margeVoyage("v3").charges_generales_allouees.reduce((a, x) => a + x.montant, 0), 7000, "seul voyage de novembre");
  assert.strictEqual(N.margeVoyage("v4").charges_generales_allouees.length, 0); assert.strictEqual(N.margeVoyage("inconnu"), null);
  assert.strictEqual(N.margeVoyage("v2").couts_fixes_alloues.length, 0, "camion sans charges fixes renseignées");
});

test("la marge se recalcule à chaque nouvelle ligne de coût et prévient les abonnés", () => {
  etatMarge();
  const recus = []; const stop = N.surMargeVoyage((e) => recus.push([e.voyageId, Math.round(e.marge.marge_directe)]));
  const v = N.S.voyages[0];
  N.recalculerMargeVoyage("v1"); assert.strictEqual(v.marge.directe, 34500);
  N.ajouterLigneCout(v, { type: "parking_securise", montant: 30, devise: "EUR", date: "2026-10-03" }); N.recalculerMargeVoyage("v1");
  N.ajouterLigneCout(v, { type: "carburant", montant: 16000, source: "fuel_card_csv", date: "2026-10-04" }); const m = N.recalculerMargeVoyage("v1");
  assert.strictEqual(JSON.stringify(recus), JSON.stringify([["v1", 34500], ["v1", 34200], ["v1", 33200]]));
  assert.strictEqual(v.marge.directe, 33200); assert.strictEqual(v.marge.couts, 16800); assert.ok(v.marge.nette < v.marge.directe); assert.ok(v.marge.maj);
  const carb = m.couts_directs.filter((l) => l.type === "carburant"); assert.strictEqual(carb.length, 1); assert.strictEqual(carb[0].source, "fuel_card_csv"); assert.strictEqual(carb[0].projete, false);
  assert.strictEqual(m.couts_directs.find((l) => l.type === "parking_securise").origine.montant, 30);
  stop(); N.recalculerMargeVoyage("v1"); assert.strictEqual(recus.length, 3, "désabonné");
  assert.strictEqual(N.recalculerMargeVoyage("inconnu"), null);
});

test("carburant estimé d'après les pleins : compté dans la marge et signalé", () => {
  etatMarge(); const v = N.S.voyages[1];
  N.S.pleins = [{ id: "p1", camionId: "c2", date: "2026-10-13", litres: 300, prix: 10 }, { id: "p2", camionId: "c2", date: "2026-11-20", litres: 300, prix: 10 }];
  let m = N.margeVoyage(v); assert.strictEqual(m.carburant_estime, true); assert.strictEqual(m.total_direct, 3000); assert.strictEqual(m.couts_directs[0].source, "calcule");
  N.ajouterLigneCout(v, { type: "carburant", montant: 3400, source: "fuel_card_csv" });
  m = N.margeVoyage(v); assert.strictEqual(m.carburant_estime, false); assert.strictEqual(m.total_direct, 3400);
});

test("évolution de la marge : un point de départ puis un point par jour de dépense ; courbe miniature", () => {
  etatMarge(); const v = N.S.voyages[0];
  assert.strictEqual(JSON.stringify(N.historiqueMarge(v)), JSON.stringify([{ date: "2026-10-01", marge: 34500 }]));
  N.ajouterLigneCout(v, { type: "traversee", montant: 400, devise: "EUR", date: "2026-10-02", source: "facture_armateur" });
  N.ajouterLigneCout(v, { type: "parking_securise", montant: 500, date: "2026-10-05" }); N.ajouterLigneCout(v, { type: "amendes", montant: 3000, devise: "EUR", date: "2026-10-05" });
  N.ajouterLigneCout(v, { type: "maintien", montant: 9000, date: "2026-10-07" });
  const h = N.historiqueMarge(v);
  assert.strictEqual(JSON.stringify(h), JSON.stringify([{ date: "2026-10-01", marge: 34500 }, { date: "2026-10-02", marge: 30500 }, { date: "2026-10-05", marge: 0 }, { date: "2026-10-07", marge: -9000 }]));
  assert.strictEqual(h[h.length - 1].marge, N.margeVoyage(v).marge_directe, "le dernier point est la marge directe actuelle");
  const c = N.courbeMini(h.map((p) => p.marge), 60, 20), pts = c.points.split(" ").map((p) => p.split(",").map(Number));
  assert.strictEqual(pts.length, 4); assert.strictEqual(pts[0][0], 0); assert.strictEqual(pts[3][0], 60); assert.ok(pts.every(([x, y]) => y >= 0 && y <= 20));
  assert.ok(pts[0][1] < c.zero && pts[3][1] > c.zero, "au-dessus puis au-dessous de la ligne d'équilibre"); assert.strictEqual(pts[2][1], c.zero);
  assert.strictEqual(N.courbeMini([]).points, ""); assert.strictEqual(N.courbeMini([5]).points.split(" ").length, 2);
});

/* ---------- D3 : capture automatique des dépenses ---------- */
const etatCapture = () => {
  N.S.params.tauxEUR = 10;
  N.S.camions = [{ id: "c1", immat: "12345-A-6", carteCarburant: "7077 1234 5678 9012" }, { id: "c2", immat: "WX-99-ZZ", froid: { consomMensuelle: 3043.75 } }];
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", perDiemJournalier: 35, perDiemDevise: "EUR" }, { id: "h2", nom: "Karim" }];
  N.S.voyages = [
    { id: "v1", ref: "V1", camionId: "c1", chauffeurId: "h1", statut: "termine", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-10", prix: 50000, devise: "MAD", carburantMad: 14000, lignesCout: [] },
    { id: "v2", ref: "V2", camionId: "c1", chauffeurId: "h1", statut: "en_cours", dateDepart: "2026-10-20", dateRetourPrevue: "2026-10-28", prix: 50000, devise: "MAD", lignesCout: [] },
    { id: "v3", ref: "V3", camionId: "c2", chauffeurId: "h2", statut: "en_cours", dateDepart: "2026-10-20", dateRetourPrevue: "2026-10-29", prix: 50000, devise: "MAD", lignesCout: [] },
    { id: "v4", ref: "V4", camionId: "c1", chauffeurId: "h1", statut: "annule", dateDepart: "2026-10-12", dateRetourPrevue: "2026-10-18", lignesCout: [] },
  ];
  N.S.depensesAttente = [];
};
const RELEVE_CARB = `Date;Heure;Kennzeichen;Kartennummer;Produkt;Menge;Betrag;Währung;Land;Tankstelle;Beleg
03/10/2026 14:22;;12345 A 6;;Diesel;420,5;588,70;EUR;ES;Algeciras Puerto;T-001
2026-10-09;;;XXXX XXXX 5678 9012;Diesel;300;4 200,00;MAD;MA;Afriquia Tanger;T-002
19.10.2026;;12345-a-6;;AdBlue;40;32,00;EUR;FR;Le Boulou;T-003
14/10/2026 08:00;;12345-A-6;;Diesel;200;280,00;EUR;ES;Murcia;T-004
22/10/2026 10:00;;ZZ-000-ZZ;;Diesel;100;140,00;EUR;ES;Lorca;T-005
23/10/2026 10:00;;WX 99 ZZ;;Diesel;100;95,00;CHF;CH;Basel;T-006
pas une date;;12345-A-6;;Diesel;1;1;EUR;;;
24/10/2026 09:00;;WX-99-ZZ;;Diesel;0;0;EUR;;;`;

test("relevé de carte carburant : colonnes reconnues (allemand, français), dates seules, montants à virgule", () => {
  const r = N.carteCarburantParse(RELEVE_CARB);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.lignes.length, 6); assert.strictEqual(r.rejetes, 2);
  const l = r.lignes[0];
  assert.strictEqual(l.date, "2026-10-03"); assert.strictEqual(l.montant, 588.7); assert.strictEqual(l.devise, "EUR"); assert.strictEqual(l.litres, 420.5); assert.strictEqual(l.plaque, "12345 A 6"); assert.strictEqual(l.pays, "ES"); assert.strictEqual(l.station, "Algeciras Puerto"); assert.strictEqual(l.ref, "T-001"); assert.strictEqual(l.produit, "Diesel");
  assert.strictEqual(r.lignes[1].date, "2026-10-09"); assert.strictEqual(r.lignes[1].montant, 4200); assert.strictEqual(r.lignes[1].carte, "XXXX XXXX 5678 9012"); assert.strictEqual(r.lignes[2].date, "2026-10-19");
  assert.strictEqual(N.carteCarburantParse("a;b\n1;2").ok, false); assert.strictEqual(N.carteCarburantParse("").ok, false);
  const fr = N.carteCarburantParse("Date de transaction,Immatriculation,Quantité,Montant TTC,Devise\n2026-10-05 12:00,12345-A-6,100,\"1 150,50\",MAD");
  assert.strictEqual(fr.lignes[0].montant, 1150.5); assert.strictEqual(fr.lignes[0].litres, 100); assert.strictEqual(fr.lignes[0].plaque, "12345-A-6");
});

test("carte carburant : chaque ligne va au voyage du camion à cette date ; le reste attend avec sa raison ; pas de double import", () => {
  etatCapture();
  const lignes = N.carteCarburantParse(RELEVE_CARB).lignes, b = N.rattacherCarburant(lignes);
  assert.strictEqual(b.rattachees, 3); assert.strictEqual(b.attente, 3); assert.strictEqual(b.doublons, 0); assert.deepStrictEqual([...b.voyages].sort(), ["v1", "v2"]);
  const [v1, v2] = N.S.voyages;
  assert.deepStrictEqual(v1.lignesCout.map((l) => l.ref), ["T-001", "T-002"], "immatriculation écrite autrement, puis carte masquée reconnue par ses derniers chiffres");
  assert.ok(v1.lignesCout.every((l) => l.type === "carburant" && l.source === "fuel_card_csv" && l.camionId === "c1"));
  assert.strictEqual(v1.lignesCout[0].libelle, "Diesel · 421 L · Algeciras Puerto · ES".replace("421", N.fmt(420.5, 0)));
  assert.deepStrictEqual(v2.lignesCout.map((l) => l.ref), ["T-003"], "plein de la veille du départ : pour ce voyage");
  assert.strictEqual(N.coutVoyage(v1).parts.carburant, 5887 + 4200, "les lignes de la carte remplacent le carburant saisi");
  const raisons = N.S.depensesAttente.map((a) => [a.ref, a.raison]);
  assert.strictEqual(JSON.stringify(raisons), JSON.stringify([["T-004", "aucun voyage à cette date"], ["T-005", "camion inconnu"], ["T-006", "devise CHF : à convertir"]]), "le voyage annulé ne reçoit rien");
  const b2 = N.rattacherCarburant(lignes); assert.strictEqual(b2.doublons, 6); assert.strictEqual(b2.rattachees + b2.attente, 0); assert.strictEqual(v1.lignesCout.length, 2); assert.strictEqual(N.S.depensesAttente.length, 3);
});

test("dépenses en attente : affectation à la main (avec conversion) et nouvel essai automatique", () => {
  etatCapture(); N.rattacherCarburant(N.carteCarburantParse(RELEVE_CARB).lignes);
  const chf = N.S.depensesAttente.find((a) => a.ref === "T-006");
  const l = N.affecterAttente(chf.id, "v3", { montant: 101.5, devise: "EUR" });
  assert.strictEqual(l.montant, 101.5); assert.strictEqual(l.devise, "EUR"); assert.strictEqual(l.source, "fuel_card_csv"); assert.strictEqual(N.S.voyages[2].lignesCout.length, 1); assert.strictEqual(N.S.depensesAttente.length, 2);
  assert.strictEqual(N.affecterAttente("inconnu", "v3"), null); assert.strictEqual(N.affecterAttente(N.S.depensesAttente[0].id, "inconnu"), null);
  assert.strictEqual(N.retenterAttente().length, 0);
  N.S.voyages.push({ id: "v5", camionId: "c1", statut: "termine", dateDepart: "2026-10-13", dateRetourPrevue: "2026-10-16", lignesCout: [] }); // le voyage manquant est créé après coup
  N.S.camions.push({ id: "c3", immat: "ZZ 000 ZZ" }); N.S.voyages.push({ id: "v6", camionId: "c3", statut: "en_cours", dateDepart: "2026-10-21", dateRetourPrevue: "2026-10-30", lignesCout: [] });
  assert.deepStrictEqual([...N.retenterAttente()].sort(), ["v5", "v6"]); assert.strictEqual(N.S.depensesAttente.length, 0);
  assert.strictEqual(N.S.voyages[4].lignesCout[0].ref, "T-004"); assert.strictEqual(N.S.voyages[5].lignesCout[0].ref, "T-005");
});

test("per diem : tarif du chauffeur × jours, recalculé quand les dates changent, figé une fois le voyage terminé", () => {
  etatCapture(); const v = N.S.voyages[1];
  assert.strictEqual(N.majCoutsCalcules(v), true);
  let l = v.lignesCout.find((x) => x.cle === "auto:perdiem");
  assert.strictEqual(l.type, "per_diem_chauffeur"); assert.strictEqual(l.montant, 35 * 9); assert.strictEqual(l.devise, "EUR"); assert.strictEqual(l.source, "calcule"); assert.strictEqual(l.date, "2026-10-20");
  assert.strictEqual(N.coutVoyage(v).parts.fraisRoute, 3150); assert.strictEqual(N.majCoutsCalcules(v), false, "rien à refaire");
  v.dateRetourPrevue = "2026-10-31"; assert.strictEqual(N.majCoutsCalcules(v), true); assert.strictEqual(v.lignesCout.filter((x) => x.cle === "auto:perdiem").length, 1); assert.strictEqual(v.lignesCout[0].montant, 35 * 12);
  v.jalons = [{ type: "retour", date: "2026-10-27T18:00:00.000Z" }]; N.majCoutsCalcules(v); assert.strictEqual(v.lignesCout[0].montant, 35 * 8, "la date réelle de retour l'emporte");
  v.statut = "termine"; N.S.chauffeurs[0].perDiemJournalier = 50; assert.strictEqual(N.majCoutsCalcules(v), false); assert.strictEqual(v.lignesCout[0].montant, 280, "un tarif changé après coup ne réécrit pas un voyage terminé");
  const t = N.S.voyages[0]; assert.strictEqual(N.majCoutsCalcules(t), false); assert.strictEqual(t.lignesCout.length, 0, "voyage déjà terminé : rien n'est ajouté rétroactivement");
  const w = N.S.voyages[2]; N.majCoutsCalcules(w); assert.ok(!w.lignesCout.some((x) => x.cle === "auto:perdiem"), "chauffeur sans tarif : pas de ligne");
  v.statut = "en_cours"; v.chauffeurId = "h2"; assert.strictEqual(N.majCoutsCalcules(v), true); assert.strictEqual(v.lignesCout.length, 0, "chauffeur changé pour un chauffeur sans tarif : la ligne disparaît");
});

test("énergie du groupe froid : part mensuelle du camion au prorata des jours ; péage mesuré par GPS : ligne de source GPS", () => {
  etatCapture(); const v = N.S.voyages[2];
  N.majCoutsCalcules(v); const f = v.lignesCout.find((x) => x.cle === "auto:froid");
  assert.strictEqual(f.type, "froid_energie"); assert.strictEqual(f.montant, 1000); assert.strictEqual(N.coutVoyage(v).parts.froid, 1000); // 10 jours sur 30,4375
  v.peagesMad = 600; v.peagesReelMad = 471; assert.strictEqual(N.majCoutsCalcules(v), true);
  const g = v.lignesCout.find((x) => x.cle === "auto:peage-gps"); assert.strictEqual(g.source, "gps"); assert.strictEqual(g.type, "peage_ma"); assert.strictEqual(g.montant, 471);
  assert.strictEqual(N.coutVoyage(v).parts.peagesMaroc, 471, "compté une seule fois");
  v.peagesReelMad = 498; N.majCoutsCalcules(v); assert.strictEqual(v.lignesCout.find((x) => x.cle === "auto:peage-gps").montant, 498);
  v.statut = "termine"; delete v.peagesReelMad; assert.strictEqual(N.majCoutsCalcules(v), true); assert.ok(!v.lignesCout.some((x) => x.cle === "auto:peage-gps"), "retour au trajet type, même sur un voyage terminé");
  assert.strictEqual(N.coutVoyage(v).parts.peagesMaroc, 600); assert.ok(v.lignesCout.some((x) => x.cle === "auto:froid"), "le froid d'un voyage terminé reste");
  N.S.voyages[1].peagesReelMad = 100; assert.deepStrictEqual([...N.majCoutsCalculesTous()].sort(), ["v2"]);
});

test("amende : rattachée au voyage en cours du chauffeur à sa date, sinon mise en attente", () => {
  etatCapture();
  const r = N.enregistrerAmende({ chauffeurId: "h1", date: "2026-10-22", montant: 1500, devise: "EUR", ref: "PV-77", motif: "Repos journalier insuffisant" });
  assert.strictEqual(r.voyage.id, "v2"); assert.strictEqual(r.ligne.type, "amendes"); assert.strictEqual(r.ligne.libelle, "Repos journalier insuffisant"); assert.strictEqual(N.coutVoyage(r.voyage).parts.amendes, 15000);
  assert.strictEqual(N.margeVoyage("v2").marge_directe, 50000 - 15000);
  const a = N.enregistrerAmende({ chauffeurId: "h2", date: "2026-11-15", montant: 300 }); assert.strictEqual(a.attente.raison, "aucun voyage à cette date"); assert.strictEqual(N.S.depensesAttente.length, 1);
  assert.strictEqual(N.enregistrerAmende({ camionId: "c2", date: "2026-10-25", montant: 90 }).voyage.id, "v3", "par le camion si le chauffeur n'est pas connu");
  assert.throws(() => N.enregistrerAmende({ chauffeurId: "h1", date: "2026-10-22", montant: 0 }), /obligatoires/);
  N.S.voyages.push({ id: "v7", chauffeurId: "h2", camionId: "c2", statut: "prevu", dateDepart: "2026-11-10", dateRetourPrevue: "2026-11-20", lignesCout: [] });
  assert.deepStrictEqual([...N.retenterAttente()], ["v7"]); assert.strictEqual(N.S.voyages[4].lignesCout[0].type, "amendes");
});

test("rappels de dépense : transitaire après la douane, facture de traversée après l'embarquement — au bon moment, une seule fois", () => {
  etatCapture(); N.S.params.fraisTransitaire = 800;
  const v = N.S.voyages[1]; v.traversees = [{ sens: "aller", ligne: "tmed-alg", fret: 300, ml: 16.5, baf: 2, ref: "DFDS-123" }, { sens: "retour", ligne: "alg-tmed", fret: 280 }]; v.jalons = [{ type: "depart", date: "2026-10-20T06:00:00Z" }];
  const cles = () => N.invitesCout(v).map((i) => i.cle);
  assert.deepStrictEqual([...cles()], [], "avant la douane : aucun rappel");
  v.jalons.push({ type: "douane_export", date: "2026-10-20T15:00:00Z" });
  let i = N.invitesCout(v); assert.strictEqual(i.length, 1); assert.strictEqual(i[0].type, "douane_frais"); assert.strictEqual(i[0].defaut, 800); assert.strictEqual(i[0].devise, "MAD");
  v.jalons.push({ type: "port_tmed", date: "x" }, { type: "embarque_aller", date: "x" });
  i = N.invitesCout(v); assert.deepStrictEqual([...i.map((x) => x.cle)], ["jalon:douane_export", "jalon:embarque_aller"]);
  assert.strictEqual(i[1].sens, "aller"); assert.strictEqual(i[1].defaut, 333); assert.strictEqual(i[1].ref, "DFDS-123"); assert.strictEqual(i[1].source, "facture_armateur"); assert.strictEqual(i[1].devise, "EUR");
  N.ajouterLigneCout(v, { type: "douane_frais", montant: 850, cle: "jalon:douane_export" }); N.ajouterLigneCout(v, { type: "traversee", montant: 341, devise: "EUR", source: "facture_armateur", sens: "aller" });
  assert.deepStrictEqual([...cles()], []);
  v.jalons.push({ type: "embarque_retour", date: "x" }, { type: "douane_import", date: "x" });
  assert.deepStrictEqual([...cles()], ["jalon:douane_import", "jalon:embarque_retour"]);
  v.invitesIgnorees = ["jalon:douane_import"]; assert.deepStrictEqual([...cles()], ["jalon:embarque_retour"]);
  const w = N.S.voyages[2]; w.jalons = [{ type: "douane_export", date: "x" }]; w.douaneMad = 900; assert.strictEqual(N.invitesCout(w).length, 0, "frais de douane déjà saisis globalement : pas de rappel");
  assert.strictEqual(N.invitesCout({ statut: "annule", jalons: [{ type: "douane_export" }] }).length, 0);
});

/* ---------- D4 : compte de résultat de l'entreprise ---------- */
const etatPnl = () => {
  N.S.params.tauxEUR = 10;
  N.S.clients = [{ id: "k1", nom: "Primeurs du Sud", delai: 30 }, { id: "k2", nom: "Froid Express", delai: 45 }];
  N.S.camions = [{ id: "c1", immat: "A", coutsFixes: { leasing_mensuel: 12000, assurance_mensuel: 1000 } }, { id: "c2", immat: "B", fixeMensuel: 5000 }];
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef" }, { id: "h2", nom: "Karim" }];
  N.S.chargesGenerales = [{ id: "g1", libelle: "Loyer", montant_mensuel: 6000, categorie: "loyer", cle_allocation: "km" }, { id: "g2", libelle: "Comptable", montant_mensuel: 1000, categorie: "comptable", cle_allocation: "equal" }];
  N.S.interventions = [{ id: "i1", camionId: "c1", date: "2026-10-15", cout: 2500 }, { id: "i2", camionId: "c1", date: "2026-08-01", cout: 999 }];
  N.S.voyages = [
    { id: "v1", ref: "V1", clientId: "k1", camionId: "c1", chauffeurId: "h1", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-10", prix: 5000, devise: "EUR", kmAller: 3000, kmRetourVide: 1000, carburantMad: 15000, peagesMad: 500, lignesCout: [{ id: "l1", type: "amendes", montant: 100, devise: "EUR", source: "saisie", date: "2026-10-05" }] },
    { id: "v2", ref: "V2", clientId: "k2", camionId: "c2", chauffeurId: "h2", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-10-12", dateRetourPrevue: "2026-10-20", prix: 30000, devise: "MAD", kmAller: 2000, carburantMad: 9000, lignesCout: [] },
    { id: "v3", ref: "V3", clientId: "k1", camionId: "c2", chauffeurId: "h1", origine: "Casablanca", destination: "Lyon", dateDepart: "2026-10-22", dateRetourPrevue: "2026-10-30", prix: 40000, devise: "MAD", kmAller: 2000, carburantMad: 12000, lignesCout: [] },
    { id: "v4", ref: "V4", clientId: "k1", camionId: "c1", dateDepart: "2026-10-15", statut: "annule", prix: 99999, devise: "MAD", lignesCout: [] },
    { id: "v5", ref: "V5", clientId: "k2", camionId: "c1", chauffeurId: "h1", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-03", dateRetourPrevue: "2026-11-10", prix: 30000, devise: "MAD", kmAller: 2000, lignesCout: [] },
  ];
  N.S.trajets = [{ id: "t1", distance: 500, calcul: { coutTotal: 2000 } }];
  N.S.commandes = [{ id: "o1", ref: "C1", clientId: "k2", camionId: "c2", origine: "Tanger", destination: "Casablanca", statut: "livre", dateChargement: "2026-10-08", prix: 6000, devise: "MAD", trajetId: "t1", autres: 500 }, { id: "o2", statut: "devis", dateChargement: "2026-10-09", prix: 7000, devise: "MAD" }];
  N.S.factures = []; N.S.echeances = []; N.S.entreprise = {};
};

test("compte de résultat : chiffre d'affaires, coûts directs par type, charges de structure de la période, marge nette, euros", () => {
  etatPnl();
  const p = N.pnlPeriode("2026-10-01", "2026-10-31"), mois = 31 / 30.4375;
  assert.strictEqual(p.nb, 4, "3 voyages et 1 commande : ni l'annulé, ni le devis, ni novembre");
  assert.strictEqual(p.revenue, 50000 + 30000 + 40000 + 6000);
  assert.strictEqual(JSON.stringify(p.couts_directs_par_type), JSON.stringify({ amendes: 1000, peage_ma: 500, carburant: 36000, commandes: 2500 }));
  assert.strictEqual(p.couts_directs, 40000); assert.strictEqual(p.marge_brute, 86000);
  const f = p.couts_fixes_alloues_par_categorie; proche(f.leasing, 12000 * mois); proche(f.assurance, 1000 * mois); proche(f.global, 5000 * mois); assert.strictEqual(f.entretien, 2500); assert.strictEqual(f.amortissement, 0);
  proche(p.charges_generales_allouees_par_categorie.loyer, 6000 * mois); proche(p.charges_generales_allouees_par_categorie.comptable, 1000 * mois);
  proche(p.structure, 25000 * mois + 2500); proche(p.marge_nette, 86000 - 25000 * mois - 2500); proche(p.pct_marge, (p.marge_nette / 126000) * 100);
  proche(p.eur.revenue, 12600); proche(p.eur.marge_nette, p.marge_nette / 10);
  // même résultat que la page Rentabilité (deux calculs indépendants)
  const r = N.rentabilite({ debut: "2026-10-01", fin: "2026-10-31" }); proche(r.totaux.ca, p.revenue); proche(r.totaux.marge, p.marge_nette); proche(r.totaux.variable, p.couts_directs);
  // la part de structure qu'aucun voyage ne porte (camions à l'arrêt) est donnée à part : rien ne disparaît
  proche(p.lignes.reduce((s, l) => s + l.structure, 0) + p.non_alloue, p.structure); assert.ok(p.non_alloue > 0);
  assert.strictEqual(N.pnlPeriode("2030-01-01", "2030-01-31").revenue, 0);
});

test("compte de résultat : regroupements par client, corridor, camion, chauffeur, mois — cohérents entre eux et jusqu'au voyage", () => {
  etatPnl();
  const p = N.pnlPeriode("2026-10-01", "2026-11-30");
  for (const k of ["par_client", "par_corridor", "par_camion", "par_chauffeur", "par_mois"]) {
    proche(p[k].reduce((s, x) => s + x.revenue, 0), p.revenue, k); proche(p[k].reduce((s, x) => s + x.marge_directe, 0), p.marge_brute, k);
    assert.strictEqual(p[k].reduce((s, x) => s + x.nb, 0), p.nb, k); assert.deepStrictEqual([...p[k].flatMap((x) => [...x.ids])].sort(), [...p.lignes.map((l) => l.id)].sort(), k + " : chaque activité apparaît une fois");
  }
  const k1 = p.par_client.find((x) => x.cle === "k1"); assert.strictEqual(k1.nom, "Primeurs du Sud"); assert.strictEqual(k1.revenue, 90000); assert.deepStrictEqual([...k1.ids].sort(), ["v1", "v3"]);
  const vs = k1.ids.map((id) => N.margeVoyage(id)); proche(k1.marge_directe, vs.reduce((s, m) => s + m.marge_directe, 0)); proche(k1.marge_nette, vs.reduce((s, m) => s + m.marge_nette, 0)); proche(k1.pct_marge, (k1.marge_nette / 90000) * 100);
  assert.deepStrictEqual([...p.par_corridor.map((x) => x.nom)].sort(), ["Agadir → Perpignan", "Casablanca → Lyon", "Tanger → Casablanca"]);
  assert.deepStrictEqual([...p.par_mois.map((x) => x.cle)], ["2026-10", "2026-11"]); assert.strictEqual(p.par_chauffeur.find((x) => x.cle === "").nom, "Sans chauffeur");
  // croisement client × corridor × camion × chauffeur
  const cube = N.pivotPnl(p.lignes, ["client", "corridor", "camion", "chauffeur"]);
  proche(cube.reduce((s, x) => s + x.revenue, 0), p.revenue); assert.strictEqual(cube.length, 5);
  const x = cube.find((c) => c.cle === "k1|Agadir → Perpignan|c1|h1"); assert.strictEqual(x.nom, "Primeurs du Sud · Agadir → Perpignan · A · Youssef"); assert.deepStrictEqual([...x.ids], ["v1"]);
  const cc = N.pivotPnl(p.lignes, ["client", "corridor"]); assert.strictEqual(cc.find((c) => c.cle === "k2|Agadir → Perpignan").nb, 2); assert.ok(cc[0].revenue >= cc[1].revenue, "trié par chiffre d'affaires");
});

test("tendance sur 12 mois : un point par mois, charges de structure du mois entier", () => {
  etatPnl();
  const t = N.tendancePnl(12, "2026-11-12");
  assert.strictEqual(t.length, 12); assert.strictEqual(t[0].mois, "2025-12"); assert.strictEqual(t[11].mois, "2026-11"); assert.strictEqual(t[10].revenue, 126000); assert.strictEqual(t[11].revenue, 30000);
  proche(t[10].marge_nette, N.pnlPeriode("2026-10-01", "2026-10-31").marge_nette); assert.strictEqual(t[5].revenue, 0); assert.ok(t[5].marge_nette < 0, "un mois sans activité porte quand même ses charges");
  proche(t[11].structure, 25000 * (30 / 30.4375));
});

/* ---------- D5 : prévision de trésorerie ---------- */
test("prévision de trésorerie : factures à leur échéance, échéances récurrentes, solde jour par jour, jour de passage en négatif", () => {
  etatPnl(); N.S.voyages = []; N.S.commandes = [];
  N.S.entreprise = { tresorerie: { solde: 20000 } };
  N.S.factures = [
    { id: "f1", numero: "F-1", clientId: "k1", echeance: "2026-11-20", devise: "MAD", tva: 20, statut: "emise", lignes: [{ montant: 10000 }] },
    { id: "f2", numero: "F-2", clientId: "k2", echeance: "2026-12-05", devise: "EUR", tva: 0, statut: "emise", lignes: [{ montant: 3000 }] },
    { id: "f3", numero: "F-3", clientId: "k1", echeance: "2026-11-01", devise: "MAD", tva: 0, statut: "emise", lignes: [{ montant: 4000 }] }, // en retard
    { id: "f4", numero: "F-4", echeance: "2026-11-25", devise: "MAD", tva: 0, statut: "payee", lignes: [{ montant: 99999 }] },
    { id: "f5", numero: "F-5", echeance: "2027-06-01", devise: "MAD", tva: 0, statut: "emise", lignes: [{ montant: 77777 }] }, // hors horizon
  ];
  N.S.echeances = [{ id: "e1", libelle: "Salaires", type: "salaire", montant: 30000, devise: "MAD", date: "2026-10-28", recurs: { frequence: "mensuel" } }, { id: "e2", libelle: "TVA T4", type: "taxe_tva", montant: 18000, devise: "MAD", date: "2027-01-20" }, { id: "e3", libelle: "Leasing", type: "credit_leasing", montant: 1200, devise: "EUR", date: "2026-11-15", recurs: { frequence: "mensuel" } }];
  const p = N.previsionsTresorerie(90, { depart: "2026-11-12" });
  assert.strictEqual(p.jours.length, 90); assert.strictEqual(p.jours[0].date, "2026-11-12"); assert.strictEqual(p.fin, "2027-02-09"); assert.strictEqual(p.solde_initial, 20000); assert.strictEqual(p.solde_renseigne, true);
  const j = (d) => p.jours.find((x) => x.date === d);
  assert.strictEqual(j("2026-11-12").solde, 24000); assert.strictEqual(j("2026-11-12").items[0].retard, true, "facture en retard : attendue dès aujourd'hui, signalée");
  assert.strictEqual(j("2026-11-15").solde, 12000); assert.strictEqual(j("2026-11-20").solde, 24000, "TTC"); assert.strictEqual(j("2026-11-28").solde, -6000); assert.strictEqual(j("2026-12-05").solde, 24000, "3 000 € convertis");
  assert.strictEqual(p.negatif, "2026-11-28"); assert.strictEqual(j("2027-01-20").items[0].libelle, "TVA T4");
  proche(p.total_entrees, 4000 + 12000 + 30000); proche(p.total_sorties, 30000 * 3 + 12000 * 3 + 18000); proche(p.solde_final, 20000 + p.total_entrees - p.total_sorties);
  assert.strictEqual(p.min.solde, p.solde_final); assert.strictEqual(p.min.date, "2027-01-28"); proche(p.eur.solde_final, p.solde_final / 10);
  let s = 20000; for (const x of p.jours) { s += x.entrees - x.sorties; proche(x.solde, s); proche(x.items.reduce((a, i) => a + i.montant, 0), x.entrees - x.sorties); }
  assert.strictEqual(N.previsionsTresorerie(30, { depart: "2026-11-12", solde: 0 }).jours.length, 30);
  N.S.entreprise = {}; assert.strictEqual(N.previsionsTresorerie(10, { depart: "2026-11-12" }).solde_renseigne, false);
});

test("prévision de trésorerie : dépenses attendues des voyages en cours et recette à facturer", () => {
  etatPnl(); N.S.interventions = []; N.S.commandes = [];
  N.S.voyages = [{ id: "v1", ref: "V1", clientId: "k2", camionId: "c1", statut: "en_cours", dateDepart: "2026-11-08", dateRetourPrevue: "2026-11-18", prix: 5000, devise: "EUR", carburantMad: 15000, peagesMad: 500, douaneMad: 900,
    traversees: [{ sens: "aller", ligne: "tmed-alg", fret: 300, date: "2026-11-09" }, { sens: "retour", ligne: "alg-tmed", fret: 280, dateFacturation: "2026-12-31" }],
    lignesCout: [{ id: "l1", type: "douane_frais", montant: 850, devise: "MAD", source: "saisie", date: "2026-11-08" }] },
    { id: "v2", ref: "V2", statut: "termine", dateDepart: "2026-10-01", dateRetourPrevue: "2026-10-10", prix: 30000, devise: "MAD", carburantMad: 9000, lignesCout: [] }];
  const p = N.previsionsTresorerie(90, { depart: "2026-11-12", solde: 0 }), tous = p.jours.flatMap((x) => x.items.map((i) => [x.date, i.type, Math.round(i.montant)]));
  assert.strictEqual(JSON.stringify(tous), JSON.stringify([["2026-11-18", "depense_prevue", -500], ["2026-12-03", "depense_prevue", -15000], ["2026-12-09", "depense_prevue", -3000], ["2026-12-31", "depense_prevue", -2800], ["2027-01-02", "recette_prevue", 50000]]),
    "péage à la fin du voyage, carburant 15 jours après, traversée aller 30 jours après, retour à sa date de facturation, recette au retour + 45 jours ; la douane déjà enregistrée et le voyage terminé ne comptent pas");
  N.S.commandes = [{ id: "o9", statut: "livre", factureId: "f9" }]; N.S.factures = [{ id: "f9", numero: "FAC-9", statut: "payee", lignes: [] }]; N.S.voyages[0].commandeId = "o9";
  assert.ok(!N.previsionsTresorerie(90, { depart: "2026-11-12", solde: 0 }).jours.some((x) => x.items.some((i) => i.type === "recette_prevue")), "voyage déjà facturé : sa recette vient de la facture");
  N.S.params.delaiCarteCarburant = 0; assert.strictEqual(N.previsionsTresorerie(90, { depart: "2026-11-12", solde: 0 }).jours.find((x) => x.date === "2026-11-18").sorties, 15500);
});

/* ---------- D6 : simulateur d'investissement ---------- */
test("crédit : mensualité constante, intérêts dégressifs, capital entièrement remboursé ; taux zéro", () => {
  const c = N.tableauCredit(900000, 6, 60);
  proche(c.mensualite, (900000 * 0.005) / (1 - Math.pow(1.005, -60))); assert.ok(Math.abs(c.mensualite - 17399.52) < 0.01);
  assert.strictEqual(c.lignes.length, 60); proche(c.lignes[0].interet, 4500); proche(c.lignes[0].capital, c.mensualite - 4500); assert.ok(c.lignes[59].reste < 1e-6);
  proche(c.lignes.reduce((s, l) => s + l.capital, 0), 900000); proche(c.total_interets, c.mensualite * 60 - 900000); assert.ok(c.lignes[1].interet < c.lignes[0].interet);
  const z = N.tableauCredit(120000, 0, 12); assert.strictEqual(z.mensualite, 10000); assert.strictEqual(z.total_interets, 0);
  assert.strictEqual(N.tableauCredit(0, 5, 12).mensualite, 0); assert.strictEqual(N.tableauCredit(1000, 5, 0).lignes.length, 0);
});

test("simulateur : charge fixe ajoutée, taux de charge d'équilibre, délai de retour, trésorerie sur 36 mois", () => {
  const base = { prix: 1200000, annexes_mensuel: 3000, km_mois: 10000, taux_charge: 80, corridors: [{ nom: "Agadir → Perpignan", pct: 75, margeKm: 4 }, { nom: "Casablanca → Lyon", pct: 25, margeKm: 8 }] };
  const c = N.simulerInvestissement({ ...base, mode: "comptant", duree_amort_ans: 5, valeur_residuelle: 300000 });
  assert.strictEqual(c.marge_km, 5); assert.strictEqual(c.amortissement_mensuel, 15000); assert.strictEqual(c.fixe_mensuel, 18000); assert.strictEqual(c.marge_mensuelle, 40000); assert.strictEqual(c.resultat_mensuel, 22000);
  assert.strictEqual(c.seuil_charge, 36); assert.strictEqual(c.atteignable, true);
  assert.strictEqual(c.tresorerie.length, 37); assert.strictEqual(c.tresorerie[0].cumul, -1200000); assert.strictEqual(c.tresorerie[1].flux, 37000, "comptant : l'amortissement n'est pas une sortie d'argent");
  assert.strictEqual(c.retour_mois, 33); assert.strictEqual(c.impact_36, -1200000 + 36 * 37000); assert.strictEqual(c.point_bas, -1200000);
  const k = N.simulerInvestissement({ ...base, mode: "credit", apport: 300000, taux: 6, duree_mois: 60 });
  assert.ok(Math.abs(k.mensualite - 17399.52) < 0.01); proche(k.fixe_mensuel, k.mensualite + 3000); assert.strictEqual(k.tresorerie[0].cumul, -300000); proche(k.tresorerie[1].flux, 40000 - k.mensualite - 3000);
  assert.strictEqual(k.retour_mois, Math.ceil(300000 / (37000 - k.mensualite))); assert.strictEqual(k.tableau_credit.length, 60); proche(k.seuil_charge, (k.fixe_mensuel / 50000) * 100);
  const l = N.simulerInvestissement({ ...base, mode: "leasing", loyer: 22000, duree_mois: 24 });
  assert.strictEqual(l.fixe_mensuel, 25000); assert.strictEqual(l.retour_mois, 0, "aucune mise de départ et résultat positif dès le premier mois"); assert.strictEqual(l.tresorerie[24].flux, 15000); assert.strictEqual(l.tresorerie[25].flux, 37000, "après la fin du contrat");
  const perdant = N.simulerInvestissement({ ...base, mode: "leasing", loyer: 60000 }); assert.strictEqual(perdant.atteignable, false); assert.ok(perdant.seuil_charge > 100); assert.strictEqual(perdant.retour_mois, null); assert.ok(perdant.impact_36 < 0);
  assert.strictEqual(N.simulerInvestissement({ ...base, mode: "comptant", corridors: [] }).seuil_charge, null);
});

test("simulateur : tableau de sensibilité (taux de charge × corridors)", () => {
  const s = N.simulerInvestissement({ prix: 600000, mode: "leasing", loyer: 17000, annexes_mensuel: 3000, km_mois: 10000, taux_charge: 80, corridors: [{ nom: "A", pct: 50, margeKm: 2 }, { nom: "B", pct: 50, margeKm: 6 }] }).sensibilite;
  assert.deepStrictEqual([...s.charges], [50, 60, 70, 80, 90, 100]); assert.deepStrictEqual([...s.lignes.map((l) => l.nom)], ["Répartition prévue", "100 % A", "100 % B"]);
  assert.deepStrictEqual([...s.lignes[0].resultats], [0, 4000, 8000, 12000, 16000, 20000]); assert.deepStrictEqual([...s.lignes[1].resultats], [-10000, -8000, -6000, -4000, -2000, 0]); assert.strictEqual(s.lignes[2].resultats[5], 40000);
});

test("simulateur : s'appuie sur la marge au kilomètre réellement observée par corridor", () => {
  etatPnl();
  const o = N.corridorsObserves(365, "2026-11-30"), ap = o.corridors.find((c) => c.nom === "Agadir → Perpignan");
  assert.strictEqual(ap.nb, 3); assert.strictEqual(ap.km, 8000); proche(ap.margeKm, (50000 - 16500 + 30000 - 9000 + 30000) / 8000); proche(ap.kmMoyen, 8000 / 3);
  const p = N.pnlPeriode("2025-11-30", "2026-11-30"); proche(o.flotte.margeKm, p.marge_brute / p.km); proche(o.flotte.kmMoisParCamion, p.km / p.mois / 2);
  const s = N.simulerInvestissement({ prix: 800000, mode: "leasing", loyer: 15000, km_mois: 9000, taux_charge: 85, corridors: o.corridors.slice(0, 2).map((c, i) => ({ nom: c.nom, pct: i ? 30 : 70, margeKm: c.margeKm })) });
  proche(s.marge_km, o.corridors[0].margeKm * 0.7 + o.corridors[1].margeKm * 0.3); assert.ok(s.seuil_charge > 0);
  N.S.voyages = []; N.S.commandes = []; assert.strictEqual(N.corridorsObserves(365, "2026-11-30").corridors.length, 0);
});

/* ---------- D7 : anomalies par camion ---------- */
const AU = "2026-11-12";
const jr = (n) => N.dateISO(Date.parse(AU + "T00:00:00Z") + n * 86400000);
// pleins « plein à plein » : chaque plein couvre 1 000 km ; litres = consommation × 10
const pleinsDe = (camionId, serie) => { let km = 100000; const r = [{ id: camionId + "p0", camionId, date: jr(serie[0][0] - 5), km, litres: 300, prix: 11, plein: true }]; serie.forEach(([j, conso, prix = 11], i) => { km += 1000; r.push({ id: `${camionId}p${i + 1}`, camionId, date: jr(j), km, litres: conso * 10, prix, plein: true }); }); return r; };
const voyageDe = (id, camionId, jFin, total, km, plus = {}) => ({ id, camionId, statut: "termine", origine: "Agadir", destination: "Perpignan", dateDepart: jr(jFin - 8), dateRetourPrevue: jr(jFin), prix: 40000, devise: "MAD", kmAller: km, autresMad: total, lignesCout: [], ...plus });

test("anomalies : référence sur 90 jours, moyenne pondérée, pente, semaine ISO", () => {
  N.S.camions = [{ id: "c1", immat: "A" }];
  N.S.pleins = pleinsDe("c1", [[-80, 30], [-60, 32], [-40, 31], [-20, 31], [-3, 40], [-120, 99]].sort((a, b) => a[0] - b[0]));
  const r = N.referencesCamion("c1", AU);
  assert.strictEqual(r.conso.n, 4, "ni la dernière semaine ni ce qui a plus de 97 jours"); proche(r.conso.valeur, 31); proche(r.conso.pente, ((31 - 30) / 30) * 100);
  assert.strictEqual(r.coutKm, undefined, "aucune observation : pas de référence");
  N.S.pleins = [];
  N.S.voyages = [voyageDe("v1", "c1", -60, 10000, 1000), voyageDe("v2", "c1", -30, 36000, 3000)];
  proche(N.referencesCamion("c1", AU).coutKm.valeur, 46000 / 4000, "pondérée par les kilomètres"); assert.strictEqual(N.referencesCamion("c1", AU).vide.valeur, 0);
  assert.strictEqual(N.semaineISO("2026-11-12"), "2026-W46"); assert.strictEqual(N.semaineISO("2026-01-01"), "2026-W01"); assert.strictEqual(N.semaineISO("2027-01-01"), "2026-W53"); assert.strictEqual(N.semaineISO("2024-12-30"), "2025-W01");
});

test("anomalies : seuil de 15 % (réglable), au moins 3 observations, seulement à la hausse", () => {
  N.S.camions = [{ id: "c1", immat: "A" }, { id: "c2", immat: "B" }, { id: "c3", immat: "C" }];
  N.S.pleins = [...pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-2, 34]]), ...pleinsDe("c2", [[-70, 30], [-50, 30], [-30, 30], [-2, 35]]), ...pleinsDe("c3", [[-50, 30], [-30, 30], [-2, 45]])];
  let a = N.anomalies(AU);
  assert.strictEqual(a.length, 1, "+13 % : rien ; +17 % : alerte ; 2 observations de référence : rien"); assert.strictEqual(a[0].camionId, "c2"); assert.strictEqual(a[0].mesure, "conso"); proche(a[0].ecart, (5 / 30) * 100); assert.strictEqual(a[0].niveau, "warn");
  assert.ok(/B — consommation 35,0 L\/100 km sur 7 jours, soit \+17 % par rapport à sa référence \(30,0\)/.test(a[0].texte), a[0].texte);
  N.S.params.seuilAnomalie = 10; assert.deepStrictEqual([...N.anomalies(AU).map((x) => x.camionId)].sort(), ["c1", "c2"]);
  N.S.params.seuilAnomalie = 5; assert.strictEqual(N.anomalies(AU).find((x) => x.camionId === "c2").niveau, "danger", "au-delà du double du seuil");
  N.S.params.seuilAnomalie = 15; N.S.pleins = pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-2, 20]]); assert.strictEqual(N.anomalies(AU).length, 0, "une baisse n'est pas une anomalie");
  N.S.pleins = pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-10, 45]]); assert.strictEqual(N.anomalies(AU).length, 0, "rien dans les 7 derniers jours");
});

test("anomalies : cause probable — hausse brutale ou progressive, prix du gasoil, nouveau corridor, dépense exceptionnelle", () => {
  N.S.camions = [{ id: "c1", immat: "A" }];
  N.S.pleins = pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-2, 40]]);
  let a = N.anomalies(AU)[0]; assert.strictEqual(a.allure, "brutale"); assert.ok(/fuite, vol de gasoil/.test(a.cause));
  N.S.pleins = pleinsDe("c1", [[-80, 28], [-65, 29], [-50, 31], [-35, 32], [-20, 33], [-10, 34], [-2, 40]]);
  a = N.anomalies(AU)[0]; assert.strictEqual(a.allure, "progressive"); assert.ok(/pneus, filtres/.test(a.cause));
  // coût au kilomètre : le gasoil a augmenté
  N.S.pleins = pleinsDe("c1", [[-70, 30, 10], [-50, 30, 10], [-30, 30, 10], [-2, 30, 12]]);
  N.S.voyages = [voyageDe("v1", "c1", -70, 10000, 2000), voyageDe("v2", "c1", -45, 10000, 2000), voyageDe("v3", "c1", -20, 10000, 2000), voyageDe("v4", "c1", -1, 12500, 2000)];
  a = N.anomalies(AU).find((x) => x.mesure === "coutKm"); assert.ok(a.ecart > 15, "carburant des pleins compris"); assert.strictEqual(a.categorie, "prix_carburant"); assert.ok(/gasoil a augmenté de 17 %/.test(a.cause));
  // même hausse, prix stable, mais corridor jamais fait
  N.S.pleins = []; N.S.voyages[3].destination = "Hambourg";
  a = N.anomalies(AU)[0]; assert.strictEqual(a.categorie, "itineraire"); assert.ok(/Agadir → Hambourg/.test(a.cause));
  // même corridor, prix stable : dépense exceptionnelle
  N.S.voyages[3].destination = "Perpignan"; a = N.anomalies(AU)[0]; assert.strictEqual(a.categorie, "coutKm"); assert.ok(/dépense exceptionnelle/.test(a.cause));
  // retours à vide et temps à l'arrêt
  N.S.voyages = [voyageDe("v1", "c1", -70, 10000, 2000, { kmRetourVide: 200 }), voyageDe("v2", "c1", -45, 10000, 2000, { kmRetourVide: 200 }), voyageDe("v3", "c1", -20, 10000, 2000, { kmRetourVide: 200 }), voyageDe("v4", "c1", -1, 11000, 1200, { kmRetourVide: 1000 })];
  a = N.anomalies(AU).find((x) => x.mesure === "vide"); assert.strictEqual(a.categorie, "retour_vide"); proche(a.reference, (200 / 2200) * 100); proche(a.recent, (1000 / 2200) * 100);
  const t = (j, d, c) => ({ id: "t" + j, camionId: "c1", fin: Date.parse(jr(j) + "T12:00:00Z") / 1000, dureeH: d, conduiteH: c });
  N.S.voyages = []; N.S.traces = [t(-60, 100, 60), t(-40, 100, 60), t(-20, 100, 60), t(-2, 100, 30)];
  a = N.anomalies(AU)[0]; assert.strictEqual(a.mesure, "arret"); proche(a.reference, 40); proche(a.recent, 70); assert.ok(/attente inhabituelle/.test(a.cause));
  N.S.traces[3].conduiteH = 57; assert.strictEqual(N.anomalies(AU).length, 0, "43 % contre 40 % : moins de 5 points d'écart");
});

test("anomalies : la référence est mémorisée et ne bouge qu'une fois par semaine ; elles remontent dans les alertes", () => {
  N.S.camions = [{ id: "c1", immat: "A" }];
  N.S.pleins = pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-9, 30]]);
  assert.strictEqual(N.majReferences(AU), true); assert.strictEqual(N.S.meta.references.semaine, "2026-W46"); assert.strictEqual(N.S.meta.references.date, AU); proche(N.S.meta.references.camions.c1.conso.valeur, 30);
  assert.strictEqual(N.majReferences(jr(2)), false, "même semaine : inchangée");
  N.S.pleins = pleinsDe("c1", [[-70, 30], [-50, 30], [-30, 30], [-9, 30], [0, 39]]);
  assert.strictEqual(N.majReferences(jr(3)), false); proche(N.S.meta.references.camions.c1.conso.valeur, 30);
  const a = N.anomalies(jr(3)); assert.strictEqual(a.length, 1); proche(a[0].reference, 30); proche(a[0].ecart, 30);
  assert.strictEqual(N.majReferences(jr(5)), true, "lundi suivant : recalculée"); assert.strictEqual(N.S.meta.references.semaine, "2026-W47");
  // alertes() s'appuie sur la date du jour : on y place l'anomalie
  const auj = N.today(), d = (n) => N.dateISO(Date.parse(auj + "T00:00:00Z") + n * 86400000); delete N.S.meta.references;
  N.S.pleins = [{ id: "p0", camionId: "c1", date: d(-80), km: 1000, litres: 1, prix: 11, plein: true }, ...[[-70, 30], [-50, 30], [-30, 30], [-1, 42]].map(([j, c], i) => ({ id: "p" + (i + 1), camionId: "c1", date: d(j), km: 2000 + i * 1000, litres: c * 10, prix: 11, plein: true }))];
  const al = N.alertes().filter((x) => x.cat === "anomalie" || /conso/.test(x.cle));
  assert.strictEqual(al.length, 1, "une seule alerte de consommation, pas deux"); assert.strictEqual(al[0].cle, "anomalie:c1:conso"); assert.strictEqual(al[0].onglet, "carburant"); assert.ok(/\+40 %/.test(al[0].texte));
});

/* ---------- D8 : conseils d'exploitation ---------- */
test("prix plancher du fret de retour : coût complet de l'aller-retour moins le prix de l'aller", () => {
  etatMarge(); N.S.chargesGenerales = []; const v = N.S.voyages[0];
  assert.strictEqual(N.seuilRetour(v), null, "pas encore livré");
  v.statut = "en_cours"; v.jalons = [{ type: "depart", date: "x" }, { type: "livre", date: "x" }]; v.kmRetourCharge = 0; v.kmRetourVide = 2500; v.prix = 1800;
  const s = N.seuilRetour(v), m = N.margeVoyage(v);
  proche(s.coutComplet, 15500 + 4000); assert.strictEqual(s.revenu, 18000); proche(s.seuilMad, 1500); proche(s.seuilEur, 150); assert.strictEqual(s.dejaCouvert, false); proche(s.parKm, 1500 / 2500); proche(s.coutComplet, m.total_direct + m.total_structure);
  v.prix = 5000; assert.strictEqual(N.seuilRetour(v).seuilMad, 0); assert.strictEqual(N.seuilRetour(v).dejaCouvert, true);
  v.retourTrouve = true; assert.strictEqual(N.seuilRetour(v), null); delete v.retourTrouve;
  v.kmRetourCharge = 1500; assert.strictEqual(N.seuilRetour(v), null); v.kmRetourCharge = 0;
  v.jalons.push({ type: "charge_retour", date: "x" }); assert.strictEqual(N.seuilRetour(v), null); v.jalons.pop(); v.statut = "termine"; assert.strictEqual(N.seuilRetour(v), null);
});

test("camions à l'arrêt : plus de 24 h sans voyage, corridors les plus rentables proposés", () => {
  etatPnl(); const maintenant = Date.parse("2026-11-12T10:00:00Z");
  N.S.voyages.forEach((v) => { if (v.statut !== "annule") v.statut = "termine"; }); N.S.voyages[4].statut = "en_cours"; // c1 roule (v5), c2 a fini v3 le 30/10
  let a = N.camionsALArret({ maintenant });
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].camionId, "c2"); assert.ok(a[0].heures > 12 * 24); assert.strictEqual(a[0].corridors[0].propre, true);
  assert.deepStrictEqual([...a[0].corridors.map((c) => c.nom)], ["Casablanca → Lyon", "Agadir → Perpignan", "Tanger → Casablanca"], "classés par marge au kilomètre de ce camion");
  proche(a[0].corridors[0].margeKm, 28000 / 2000);
  a = N.camionsALArret({ maintenant, positions: [{ camionId: "c2", zone: "Port de Tanger Med", arretMin: 30 * 60 }] }); assert.strictEqual(a[0].lieu, "Port de Tanger Med"); proche(a[0].heures, 30);
  assert.strictEqual(N.camionsALArret({ maintenant, positions: [{ camionId: "c2", zone: "Dépôt", arretMin: 5 * 60 }] }).length, 0, "5 h : pas encore");
  N.S.voyages.push({ id: "v9", camionId: "c2", statut: "prevu", dateDepart: "2026-11-13", lignesCout: [] }); assert.strictEqual(N.camionsALArret({ maintenant }).length, 0, "un départ est prévu demain");
  N.S.camions.push({ id: "c9", immat: "NEUF" }); assert.ok(!N.camionsALArret({ maintenant }).some((x) => x.camionId === "c9"), "camion sans historique ni position : rien à dire");
  assert.strictEqual(N.meilleursCorridors("c9", 2, "2026-11-12")[0].propre, false, "sans historique propre : corridors de la flotte");
});

test("traversées à réserver : l'aller avant le départ, le retour une fois parti, urgence à 2 jours", () => {
  const tr = (a, r) => [{ sens: "aller", ligne: "tmed-alg", statut: a }, { sens: "retour", ligne: "alg-tmed", statut: r }];
  N.S.voyages = [{ id: "v1", ref: "V1", statut: "prevu", dateDepart: "2026-11-20", dateRetourPrevue: "2026-11-30", traversees: tr("a_reserver", "a_reserver") },
    { id: "v2", ref: "V2", statut: "prevu", dateDepart: "2026-11-13", traversees: tr("a_reserver", "a_reserver") }, { id: "v3", ref: "V3", statut: "prevu", dateDepart: "2026-11-14", traversees: tr("reservee", "a_reserver") },
    { id: "v4", ref: "V4", statut: "en_cours", dateDepart: "2026-11-08", dateRetourPrevue: "2026-11-18", jalons: [{ type: "embarque_aller", date: "x" }], traversees: tr("a_reserver", "a_reserver") }, { id: "v5", ref: "V5", statut: "termine", traversees: tr("a_reserver", "a_reserver") }, { id: "v6", ref: "V6", statut: "prevu", dateDepart: "2026-12-01" }];
  const t = N.traverseesAReserver("2026-11-12");
  assert.strictEqual(JSON.stringify(t.map((x) => [x.ref, x.sens, x.jours, x.urgent])), JSON.stringify([["V2", "aller", 1, true], ["V4", "retour", 6, false], ["V1", "aller", 8, false], ["V6", "aller", 19, false]]));
});

test("conduite légale : 9 h par jour, 10 h deux fois, 56 h par semaine, 90 h sur deux semaines", () => {
  assert.strictEqual(N.conduiteLegaleMax(1), 10); assert.strictEqual(N.conduiteLegaleMax(2), 20); assert.strictEqual(N.conduiteLegaleMax(3), 29); assert.strictEqual(N.conduiteLegaleMax(6), 56); assert.strictEqual(N.conduiteLegaleMax(7), 56);
  assert.strictEqual(N.conduiteLegaleMax(8), 66); assert.strictEqual(N.conduiteLegaleMax(14), 90); assert.strictEqual(N.conduiteLegaleMax(15), 100); assert.strictEqual(N.conduiteLegaleMax(0), 0);
});

test("faisabilité pour le chauffeur : heures nécessaires contre heures possibles, carte conducteur, Schengen", () => {
  N.S.params.vitesseMoyenne = 70;
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [] }];
  const v = { id: "v1", ref: "V1", chauffeurId: "h1", statut: "prevu", dateDepart: "2026-11-16", dateRetourPrevue: "2026-11-21", kmAller: 2100, kmRetourVide: 2100 };
  let f = N.faisabiliteChauffeur(v); proche(f.heuresNecessaires, 60); assert.strictEqual(f.heuresPossibles, 56); assert.strictEqual(f.ok, false); assert.strictEqual(f.joursMin, 8); assert.ok(/60 h de conduite nécessaires.*56 h légalement possibles en 6 jour.*au moins 8 jours/.test(f.raisons[0]), f.raisons[0]);
  v.dateRetourPrevue = "2026-11-25"; f = N.faisabiliteChauffeur(v); assert.strictEqual(f.ok, true); assert.strictEqual(f.raisons.length, 0);
  N.S.chauffeurs[0].tachy = { semaines: [{ debut: "2026-11-16", conduiteH: 30 }] }; f = N.faisabiliteChauffeur(v); assert.strictEqual(f.ok, false); assert.ok(/30 h déjà conduites/.test(f.raisons.join()));
  delete N.S.chauffeurs[0].tachy; N.S.chauffeurs[0].sejours = [{ entree: "2026-08-01", sortie: "2026-10-28" }]; f = N.faisabiliteChauffeur(v); assert.strictEqual(f.conduiteOk, true); assert.strictEqual(f.schengenOk, false); assert.strictEqual(f.ok, false); assert.ok(/Schengen/.test(f.raisons[0]));
  assert.strictEqual(N.faisabiliteChauffeur({ ...v, chauffeurId: "" }), null); assert.strictEqual(N.faisabiliteChauffeur({ ...v, kmAller: 0, kmRetourVide: 0 }), null);
});

test("repos hebdomadaire : au-delà de 6 jours, coût et effet sur la marge ; satisfait par une ligne d'hébergement", () => {
  N.S.params.tauxEUR = 10; N.S.camions = []; N.S.chargesGenerales = [];
  const v = { id: "v1", ref: "V1", statut: "en_cours", dateDepart: "2026-11-02", dateRetourPrevue: "2026-11-07", prix: 30000, devise: "MAD", carburantMad: 10000, lignesCout: [] }; N.S.voyages = [v];
  assert.strictEqual(N.reposHebdoAPrevoir(v), null, "6 jours");
  v.dateRetourPrevue = "2026-11-10"; let r = N.reposHebdoAPrevoir(v); assert.strictEqual(r.jours, 9); assert.strictEqual(r.nb, 1); assert.strictEqual(r.coutEur, 70); assert.strictEqual(r.margeAvant, 20000); assert.strictEqual(r.margeApres, 19300);
  v.dateRetourPrevue = "2026-11-15"; assert.strictEqual(N.reposHebdoAPrevoir(v).nb, 2); N.S.params.reposHebdoEur = 100; assert.strictEqual(N.reposHebdoAPrevoir(v).coutEur, 200);
  N.ajouterLigneCout(v, { type: "hebergement", montant: 90, devise: "EUR" }); r = N.reposHebdoAPrevoir(v); assert.strictEqual(r.nb, 1); assert.strictEqual(r.margeAvant, 19100);
  N.ajouterLigneCout(v, { type: "hebergement", montant: 90, devise: "EUR" }); assert.strictEqual(N.reposHebdoAPrevoir(v), null); v.lignesCout = []; v.statut = "termine"; assert.strictEqual(N.reposHebdoAPrevoir(v), null);
});

test("conseils : tout est rassemblé, le plus urgent d'abord, chaque conseil mène à une action", () => {
  etatPnl(); N.S.params.vitesseMoyenne = 70; const maintenant = Date.parse("2026-11-12T10:00:00Z");
  N.S.voyages.forEach((v) => { if (v.statut !== "annule") v.statut = "termine"; });
  const v5 = N.S.voyages[4]; Object.assign(v5, { statut: "en_cours", dateRetourPrevue: "2026-11-14", jalons: [{ type: "livre", date: "x" }], kmRetourVide: 2000, traversees: [{ sens: "aller", ligne: "tmed-alg", statut: "effectuee" }, { sens: "retour", ligne: "alg-tmed", statut: "a_reserver" }] });
  N.S.voyages.push({ id: "v6", ref: "V6", camionId: "c1", chauffeurId: "h2", statut: "prevu", origine: "Agadir", destination: "Hambourg", dateDepart: "2026-11-20", dateRetourPrevue: "2026-11-23", kmAller: 3300, kmRetourVide: 3300, prix: 6000, devise: "EUR", lignesCout: [], traversees: [{ sens: "aller", ligne: "tmed-alg", statut: "reservee" }, { sens: "retour", ligne: "alg-tmed", statut: "reservee" }] });
  const c = N.conseils({ maintenant }), types = c.map((x) => x.type);
  assert.deepStrictEqual([...types].sort(), ["arret", "chauffeur", "repos", "retour", "traversee"]);
  assert.deepStrictEqual([...c.map((x) => x.niveau)], ["danger", "danger", "warn", "warn", "warn"], "blocages d'abord : chauffeur hors règles, traversée de retour à réserver sous 2 jours"); assert.ok(c.every((x) => x.action && x.action.lib && x.titre && x.texte));
  const ret = c.find((x) => x.type === "retour"); assert.ok(/En dessous de .* € de fret de retour|couvre déjà/.test(ret.texte)); assert.strictEqual(ret.voyageId, "v5");
  assert.strictEqual(c.find((x) => x.type === "traversee").voyageId, "v5"); assert.strictEqual(c.find((x) => x.type === "chauffeur").voyageId, "v6"); assert.strictEqual(c.find((x) => x.type === "arret").camionId, "c2");
  N.S.voyages = []; N.S.camions = []; assert.strictEqual(N.conseils({ maintenant }).length, 0);
});

/* ---------- D10 : tableau des opérations, actions directes, historique ---------- */
test("tableau des opérations : une carte par camion, état, prochaine étape, marge en direct, alertes d'abord", () => {
  etatPnl(); N.S.voyages.forEach((v) => { if (v.statut !== "annule") v.statut = "termine"; });
  N.S.camions[0].officeResponsable = "allemagne"; N.S.camions.push({ id: "c3", immat: "C" }); N.S.chauffeurs[1].camionId = "c2"; N.S.chauffeurs[0].tel = "0612345678";
  Object.assign(N.S.voyages[4], { statut: "en_cours", dateRetourPrevue: "2026-11-10", jalons: [{ type: "depart", date: "x" }, { type: "douane_export", date: "x" }] });
  N.S.voyages.push({ id: "v8", ref: "V8", camionId: "c2", statut: "prevu", origine: "Agadir", destination: "Lyon", dateDepart: "2026-11-20", lignesCout: [] });
  let c = N.cartesOperations({ auj: "2026-11-12" });
  assert.deepStrictEqual([...c.map((x) => x.immat)], ["A", "B", "C"]);
  assert.strictEqual(c[0].etat.libelle, "Douane export (BADR)"); assert.strictEqual(c[0].prochain, "Entrée port Tanger Med"); assert.strictEqual(c[0].voyage.ref, "V5"); assert.strictEqual(c[0].chauffeur.nom, "Youssef"); assert.strictEqual(c[0].bureau, "allemagne");
  proche(c[0].marge, N.margeVoyage("v5").marge_directe); assert.strictEqual(c[1].etat.libelle, "Départ le 20/11/2026"); assert.strictEqual(c[1].chauffeur.nom, "Karim"); assert.strictEqual(c[2].etat.libelle, "Disponible"); assert.strictEqual(c[2].voyage, null); assert.strictEqual(c[2].marge, null);
  c = N.cartesOperations({ auj: "2026-11-12", flotte: [{ camion: { id: "c3" }, etat: { code: "au_port", libelle: "Au port", niveau: "ok", zone: { nom: "Port de Tanger Med" } }, eta: { arrivee: 1 }, alertes: [{ niveau: "warn" }, { niveau: "danger" }] }] });
  assert.strictEqual(c[0].immat, "C", "le camion en alerte passe en tête"); assert.strictEqual(c[0].nbAlertes, 2); assert.strictEqual(c[0].etat.libelle, "Au port"); assert.strictEqual(c[0].etat.zone, "Port de Tanger Med"); assert.ok(c[0].eta);
});

test("chaque alerte mène à une action directe : appeler, WhatsApp, écrire au client, ouvrir le voyage", () => {
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", tel: "06 12 34 56 78", camionId: "c1" }, { id: "h2", nom: "Karim" }];
  N.S.clients = [{ id: "k1", nom: "Primeurs", email: "compta@primeurs.example", tel: "+33 4 68 00 00 00" }]; N.S.factures = [{ id: "f1", numero: "F-1", clientId: "k1" }]; N.S.voyages = [{ id: "v1", chauffeurId: "h1" }];
  const g = (cle) => N.actionsAlerte({ cle, texte: "votre repos commence dans 30 min" }).map((x) => x.genre).join();
  assert.strictEqual(g("repos:h1"), "tel,whatsapp"); assert.strictEqual(g("docs:ch:h1:permis"), "tel,whatsapp"); assert.strictEqual(g("schengen:h1"), "tel,whatsapp"); assert.strictEqual(g("anomalie:c1:conso"), "tel,whatsapp"); assert.strictEqual(g("docs:cam:c1:Assurance"), "tel,whatsapp");
  assert.strictEqual(g("repos:h2"), "", "pas de téléphone : pas de bouton"); assert.strictEqual(g("fac:f1"), "mail,tel"); assert.strictEqual(g("voy:v1:retard"), "voyage,tel,whatsapp"); assert.strictEqual(g("sauvegarde"), ""); assert.strictEqual(g(""), "");
  const a = N.actionsAlerte({ cle: "repos:h1", texte: "repos obligatoire" }); assert.strictEqual(a[0].href, "tel:+212612345678"); assert.ok(a[1].href.startsWith("https://wa.me/212612345678?text=Bonjour%20Youssef"));
  assert.ok(N.actionsAlerte({ cle: "fac:f1" })[0].href.startsWith("mailto:compta@primeurs.example?subject=Facture%20F-1")); assert.strictEqual(N.actionsAlerte({ cle: "voy:v1:x" })[0].id, "v1");
});

test("historique du voyage : étapes, statut, dépenses ajoutées, modifiées, supprimées — avec l'auteur, avant et après", () => {
  N.S.params.tauxEUR = 10; const memoire = new Map();
  const v = { id: "v1", ref: "V1", statut: "prevu", prix: 4000, devise: "EUR", dateDepart: "2026-11-10", dateRetourPrevue: "2026-11-18" }; N.S.voyages = [v];
  assert.strictEqual(N.journaliser(memoire, "Direction", "2026-11-09T08:00:00Z"), 1); assert.strictEqual(v.auditLog[0].action, "creation"); assert.strictEqual(v.auditLog[0].qui, "Direction");
  assert.strictEqual(N.journaliser(memoire, "Direction"), 0, "rien n'a changé : rien n'est écrit");
  v.statut = "en_cours"; v.jalons = [{ type: "depart", date: "x" }]; const l = N.ajouterLigneCout(v, { type: "carburant", montant: 9000, ref: "T-1" });
  assert.strictEqual(N.journaliser(memoire, "Exploitation", "2026-11-10T06:00:00Z"), 3);
  assert.strictEqual(JSON.stringify(v.auditLog.slice(1).map((e) => [e.action, e.avant, e.apres, e.qui])), JSON.stringify([["statut", "Prévu", "En cours", "Exploitation"], ["jalon", "", "Départ du dépôt", "Exploitation"], ["cout_ajout", "", "Carburant 9 000 MAD (T-1)", "Exploitation"]].map((x) => [x[0], x[1], x[2].replace("9 000", N.fmt(9000)), x[3]])));
  l.montant = 9500; assert.strictEqual(N.journaliser(memoire, "Comptabilité", "2026-11-11T09:00:00Z"), 1);
  let e = v.auditLog[v.auditLog.length - 1]; assert.strictEqual(e.action, "cout_modif"); assert.ok(e.avant.includes(N.fmt(9000)) && e.apres.includes(N.fmt(9500))); assert.strictEqual(e.qui, "Comptabilité"); assert.strictEqual(e.date, "2026-11-11T09:00:00Z");
  N.retirerLigneCout(v, l.id); v.jalons = []; v.prix = 4200; v.dateRetourPrevue = "2026-11-20"; assert.strictEqual(N.journaliser(memoire, "Direction"), 4);
  assert.deepStrictEqual([...v.auditLog.slice(-4).map((x) => x.action)].sort(), ["cout_suppr", "dates", "jalon_annule", "prix"]); assert.strictEqual(v.auditLog.find((x) => x.action === "prix").apres, "4200 EUR");
  // rechargement de la page : la mémoire est vide, le voyage a déjà son journal → pas de fausse « création »
  const n = v.auditLog.length; assert.strictEqual(N.journaliser(new Map(), "Direction"), 0); assert.strictEqual(v.auditLog.length, n);
  // voyage ancien (avant l'historique) : pas de fausse création non plus ; voyage supprimé : oublié
  N.S.voyages.push({ id: "v0", statut: "termine", jalons: [{ type: "depart" }] }); assert.strictEqual(N.journaliser(memoire, "x"), 0); N.S.voyages = []; N.journaliser(memoire, "x"); assert.strictEqual(memoire.size, 0);
  // plafond
  const w = { id: "w", statut: "prevu", auditLog: Array.from({ length: 300 }, (_, i) => ({ action: "x", date: String(i) })) }; N.S.voyages = [w]; const m2 = new Map(); N.journaliser(m2, ""); w.statut = "en_cours"; N.journaliser(m2, ""); assert.strictEqual(w.auditLog.length, 300); assert.strictEqual(w.auditLog[299].action, "statut");
});

/* ---------- D12 : attentes aux ports mesurées et arrivée estimée ---------- */
const HH = 3600000, T0 = Date.parse("2026-11-09T08:00:00Z"); // lundi 9 novembre 2026, 9 h au Maroc
const mesure = (portId, i, dureeH, plus = {}) => ({ id: `m${portId}${i}`, portId, voyageId: "x" + i, dureeMs: dureeH * HH, jourSemaine: 1, heureEntree: 9, saison: "haute", avecSPS: false, scanRouge: false, ...plus });

test("attente au port : mesurée de l'étape d'entrée à l'étape de sortie (Tanger Med export, Algeciras, Tanger Med import)", () => {
  const iso = (h) => new Date(T0 + h * HH).toISOString();
  const v = { id: "v1", camionId: "c1", statut: "en_cours", tempMin: 2, tempMax: 6, jalons: [{ type: "depart", date: iso(-8) }, { type: "port_tmed", date: iso(0) }, { type: "embarque_aller", date: iso(2.5) }, { type: "debarque_alg", date: iso(5) }], sortiesPort: { alg_entry: iso(11) } };
  let a = N.attentesVoyage(v);
  assert.strictEqual(a.length, 2); assert.strictEqual(a[0].id, "v1:tmed_export"); assert.strictEqual(a[0].dureeMs, 2.5 * HH); assert.strictEqual(a[0].heureEntree, 9); assert.strictEqual(a[0].jourSemaine, 1); assert.strictEqual(a[0].saison, "haute"); assert.strictEqual(a[0].avecSPS, false);
  assert.strictEqual(a[1].portId, "alg_entry"); assert.strictEqual(a[1].dureeMs, 6 * HH); assert.strictEqual(a[1].avecSPS, true, "marchandise sous température dirigée : contrôle sanitaire"); assert.strictEqual(a[1].heureEntree, 14);
  v.jalons.push({ type: "livre", date: iso(40) }, { type: "debarque_tmed", date: iso(90) }, { type: "douane_import", date: iso(93.5) }); v.scanRouge = { tmed_import: true };
  a = N.attentesVoyage(v); assert.strictEqual(a.length, 3); assert.strictEqual(a[2].dureeMs, 3.5 * HH); assert.strictEqual(a[2].scanRouge, true);
  N.S.voyages = [v]; N.S.attentesPort = []; assert.strictEqual(N.majAttentesPort(), true); assert.strictEqual(N.S.attentesPort.length, 3); assert.strictEqual(N.majAttentesPort(), false, "rien de nouveau");
  v.jalons = v.jalons.filter((j) => j.type !== "douane_import"); assert.strictEqual(N.majAttentesPort(), true); assert.strictEqual(N.S.attentesPort.length, 2, "étape annulée : la mesure disparaît");
  N.S.voyages = []; N.majAttentesPort(); assert.strictEqual(N.S.attentesPort.length, 2, "voyage supprimé : ses mesures restent");
  assert.strictEqual(N.attentesVoyage({ id: "v", jalons: [{ type: "port_tmed", date: iso(0) }, { type: "embarque_aller", date: iso(0.01) }] }).length, 0, "moins de 5 minutes : pas une mesure");
  assert.strictEqual(N.attentesVoyage({ id: "v", jalons: [{ type: "port_tmed", date: iso(0) }, { type: "embarque_aller", date: iso(200) }] }).length, 0, "plus de 5 jours : écarté");
  assert.strictEqual(N.saisonDe(Date.parse("2026-07-15")), "basse"); assert.strictEqual(N.saisonDe(Date.parse("2026-10-01")), "haute");
  const s = N.sortiesPortDepuisVisites([{ type: "port_maroc", zone: "Port de Tanger Med", entree: 100, sortie: 200 }, { type: "port_europe", zone: "Port d'Algeciras", entree: 5000, sortie: 9000 }], 20000);
  assert.strictEqual(s.alg_entry, new Date(9000 * 1000).toISOString()); assert.strictEqual(N.sortiesPortDepuisVisites([{ type: "port_europe", zone: "Port d'Algeciras", entree: 5000, sortie: 9000 }], 9100).alg_entry, undefined, "encore dans le port");
});

test("attente au port : médiane et centiles, repli progressif quand les mesures manquent, estimation générique", () => {
  N.S.params.seuilCalibrationAttente = 10; N.S.attentesPort = [];
  let a = N.attentePort("tmed_export", 9, 1, "haute"); assert.strictEqual(a.source, "estimation_generique"); assert.strictEqual(a.p50, 3 * HH); assert.strictEqual(a.n_samples, 0);
  assert.strictEqual(N.attentePort("alg_entry", 9, 1, "haute").p50, 1 * HH); assert.strictEqual(N.attentePort("alg_entry", 9, 1, "haute", { avecSPS: true }).p50, 4 * HH);
  // 10 mesures au même créneau : 1 à 10 h
  N.S.attentesPort = Array.from({ length: 10 }, (_, i) => mesure("tmed_export", i, i + 1));
  a = N.attentePort("tmed_export", 9, 1, "haute"); assert.strictEqual(a.source, "operateur_calibre"); assert.strictEqual(a.niveau, "heure_jour_saison"); assert.strictEqual(a.n_samples, 10); proche(a.p50, 5.5 * HH); proche(a.p75, 7.75 * HH); proche(a.p90, 9.1 * HH);
  assert.strictEqual(N.attentePort("tmed_export", 11, 1, "haute").niveau, "heure_jour_saison", "à ± 2 h"); assert.strictEqual(N.attentePort("tmed_export", 22, 1, "haute").niveau, "port", "autre créneau : tout le port");
  assert.strictEqual(N.attentePort("tmed_export", 9, 1, "basse").niveau, "heure_jour", "autre saison : on l'ignore"); assert.strictEqual(N.attentePort("tmed_export", 9, 3, "basse").niveau, "heure", "autre jour : on l'ignore aussi");
  assert.strictEqual(N.attentePort("tmed_export", 14, 3, "basse").niveau, "heure_large", "à ± 6 h"); assert.strictEqual(N.attentePort("tmed_export", 23, 1, "haute").niveau, "heure_jour_saison" === "x" ? "" : "port");
  assert.strictEqual(N.attentePort("tmed_import", 9, 1, "haute").source, "estimation_generique", "un autre port n'emprunte rien");
  N.S.attentesPort.pop(); a = N.attentePort("tmed_export", 9, 1, "haute"); assert.strictEqual(a.source, "estimation_generique"); assert.strictEqual(a.n_samples, 9, "9 mesures : pas encore assez");
  N.S.params.seuilCalibrationAttente = 5; assert.strictEqual(N.attentePort("tmed_export", 9, 1, "haute").source, "operateur_calibre"); N.S.params.seuilCalibrationAttente = 10;
  // minuit : 23 h et 1 h sont à 2 heures l'une de l'autre
  N.S.attentesPort = Array.from({ length: 10 }, (_, i) => mesure("tmed_export", i, 2, { heureEntree: 23 })); assert.strictEqual(N.attentePort("tmed_export", 1, 1, "haute").niveau, "heure_jour_saison");
});

test("attente au port : scanner écarté de la médiane, frais et sec jamais mélangés à Algeciras, valeur saisie prioritaire", () => {
  N.S.params.seuilCalibrationAttente = 10; delete N.S.params.attentesForcees;
  N.S.attentesPort = [...Array.from({ length: 10 }, (_, i) => mesure("tmed_export", i, 2)), mesure("tmed_export", 90, 30, { scanRouge: true }), mesure("tmed_export", 91, 30, { scanRouge: true })];
  let a = N.attentePort("tmed_export", 9, 1, "haute"); assert.strictEqual(a.p50, 2 * HH); assert.strictEqual(a.p75, 2 * HH); assert.strictEqual(a.n_samples, 10); assert.ok(a.p90 > 2 * HH, "le P90 garde la queue des passages au scanner");
  N.S.attentesPort = [...Array.from({ length: 10 }, (_, i) => mesure("alg_entry", i, 1)), ...Array.from({ length: 10 }, (_, i) => mesure("alg_entry", 100 + i, 9, { avecSPS: true }))];
  assert.strictEqual(N.attentePort("alg_entry", 9, 1, "haute").p50, 1 * HH); assert.strictEqual(N.attentePort("alg_entry", 9, 1, "haute", { avecSPS: true }).p50, 9 * HH);
  N.S.attentesPort = N.S.attentesPort.filter((x) => !x.avecSPS); assert.strictEqual(N.attentePort("alg_entry", 9, 1, "haute", { avecSPS: true }).source, "estimation_generique", "aucune mesure « frais » : on n'utilise pas celles du sec");
  N.S.params.attentesForcees = { alg_entry: { p50_ms: 4 * HH } }; a = N.attentePort("alg_entry", 9, 1, "haute"); assert.strictEqual(a.source, "saisie_manuelle"); assert.strictEqual(a.p50, 4 * HH); delete N.S.params.attentesForcees;
});

test("arrivée estimée : attentes de l'opérateur, attente réelle au port franchi, fourchette qui se resserre", () => {
  N.S.params.seuilCalibrationAttente = 10; delete N.S.params.attentesForcees;
  N.S.attentesPort = [...Array.from({ length: 10 }, (_, i) => mesure("tmed_export", i, 4 + (i === 9 ? 6 : 0))), ...Array.from({ length: 10 }, (_, i) => mesure("alg_entry", i, 2 + (i === 9 ? 3 : 0)))];
  const pe = N.attentePort("tmed_export", 9, 1, "haute"), pa = N.attentePort("alg_entry", 9, 1, "haute"); assert.strictEqual(pe.p50, 4 * HH); assert.strictEqual(pa.p50, 2 * HH);
  const iso = (h) => new Date(T0 + h * HH).toISOString(), v = { id: "v1", statut: "en_cours", jalons: [{ type: "depart", date: iso(-6) }] };
  let a = N.attentesPourEta(v, T0);
  assert.strictEqual(a.portH, 4); assert.strictEqual(a.auPortH, null); assert.strictEqual(a.debarqH, 2); assert.strictEqual(a.source, "operateur_calibre"); assert.deepStrictEqual([...a.ports.map((p) => p.statut)], ["a_venir", "a_venir"]);
  const f0 = a.fourchetteMin; proche(f0, Math.round((pe.p90 - pe.p50 + pa.p90 - pa.p50) / 60000));
  v.jalons.push({ type: "port_tmed", date: iso(0) }); a = N.attentesPourEta(v, T0 + 1 * HH);
  assert.strictEqual(a.portH, null); assert.strictEqual(a.auPortH, 3, "au port depuis 1 h : il reste la médiane moins le temps passé"); assert.strictEqual(a.ports[0].statut, "en_cours");
  assert.strictEqual(N.attentesPourEta(v, T0 + 9 * HH).auPortH, 0.25, "médiane dépassée : au moins un quart d'heure");
  const c = N.attenteEnCours(v, T0 + 1 * HH); assert.strictEqual(c.portId, "tmed_export"); assert.strictEqual(c.depuisMs, HH); assert.strictEqual(c.sortiePrevue, T0 + 4 * HH); assert.ok(/Tanger Med \(export\) depuis 1 h 00 — sortie attendue vers 13:00 \(médiane 4 h 00, 10 mesures\)/.test(c.texte), c.texte);
  v.jalons.push({ type: "embarque_aller", date: iso(6) }); a = N.attentesPourEta(v, T0 + 6.5 * HH);
  assert.strictEqual(a.ports[0].statut, "mesure"); assert.strictEqual(a.ports[0].ms, 6 * HH, "attente réelle : 6 h"); assert.strictEqual(a.portH, null); assert.strictEqual(a.auPortH, null); assert.strictEqual(a.debarqH, 2);
  const f1 = a.fourchetteMin; assert.ok(f1 < f0, "un port franchi : la fourchette se resserre"); proche(f1, Math.round((pa.p90 - pa.p50) / 60000)); assert.strictEqual(N.attenteEnCours(v, T0 + 6.5 * HH), null);
  v.jalons.push({ type: "debarque_alg", date: iso(8) }); v.sortiesPort = { alg_entry: iso(9.5) }; a = N.attentesPourEta(v, T0 + 10 * HH);
  assert.strictEqual(a.fourchetteMin, 0); assert.strictEqual(a.source, "mesure"); assert.strictEqual(a.debarqH, null); assert.strictEqual(a.ports[1].ms, 1.5 * HH);
  v.jalons.push({ type: "livre", date: iso(30) }); a = N.attentesPourEta(v, T0 + 31 * HH); assert.deepStrictEqual([...a.ports.map((p) => p.portId)], ["tmed_import"]); assert.strictEqual(a.source, "estimation_generique"); assert.strictEqual(a.debarqH, 3);
  N.S.attentesPort = []; assert.strictEqual(N.attentesPourEta({ id: "w", statut: "en_cours", jalons: [] }, T0).source, "estimation_generique");
});

test("arrivée estimée : le calcul utilise ces attentes ; décalage signalé au-delà du seuil et créneau promis franchi", () => {
  const now = Math.floor(T0 / 1000), zones = [...N.ZONES_DEFAUT], hist = [[now - 600, 33.60, -7.60, 80], [now, 33.65, -7.55, 80]], dest = [42.70, 2.89]; // Casablanca → Perpignan
  const base = N.etaVoyage(hist, now, dest, { zones }), generique = N.etaPrevision(hist, now, dest, null, { zones });
  assert.strictEqual(generique.arrivee, base.arrivee, "sans mesure : même arrivée que le calcul d'origine"); assert.ok(generique.fourchetteMin >= 20); assert.strictEqual(generique.source, "estimation_generique");
  const long = N.etaPrevision(hist, now, dest, { portH: 7, auPortH: null, debarqH: 5, fourchetteMin: 240, ports: [], source: "operateur_calibre" }, { zones });
  proche(long.attentesH, base.attentesH + 4 + 4); assert.ok(long.arrivee >= base.arrivee + 8 * 3600 - 1, "8 h d'attente de plus"); assert.strictEqual(long.source, "operateur_calibre");
  assert.ok(long.fourchetteMin >= 240 + 20); assert.strictEqual(long.max - long.arrivee, long.fourchetteMin * 60); assert.strictEqual(long.arrivee - long.min, long.fourchetteMin * 60);
  const court = N.etaPrevision(hist, now, dest, { portH: 7, debarqH: 5, fourchetteMin: 30, ports: [] }, { zones }); assert.ok(court.fourchetteMin < long.fourchetteMin);
  // décalage
  N.S.params.seuilDecalageETA = 30; const promis = new Date((now + 40 * 3600) * 1000).toISOString(), v = { livraisonPrevue: promis, eta: { arrivee: now + 39 * 3600 } };
  let d = N.decalageEta(v, now + 39.4 * 3600); assert.strictEqual(d.decalageMin, 24); assert.strictEqual(d.notifier, false); assert.strictEqual(d.franchitCreneau, false); assert.strictEqual(d.retardMin, -36);
  d = N.decalageEta(v, now + 41 * 3600); assert.strictEqual(d.decalageMin, 120); assert.strictEqual(d.notifier, true); assert.strictEqual(d.franchitCreneau, true); assert.strictEqual(d.retardMin, 60);
  v.eta.arrivee = now + 41 * 3600; d = N.decalageEta(v, now + 41.2 * 3600); assert.strictEqual(d.franchitCreneau, false, "déjà en retard : pas signalé une deuxième fois"); assert.strictEqual(d.notifier, false);
  d = N.decalageEta(v, now + 38 * 3600); assert.strictEqual(d.decalageMin, -180); assert.strictEqual(d.notifier, true, "une avance se signale aussi");
  assert.strictEqual(N.decalageEta({}, now).decalageMin, 0); assert.strictEqual(N.decalageEta({}, now).retardMin, null);
});

test("attentes aux ports : partagées entre les bureaux par la synchronisation", () => {
  const base = { attentesPort: [mesure("tmed_export", 1, 2)] }, casa = { attentesPort: [mesure("tmed_export", 1, 2), mesure("tmed_export", 2, 3)] }, francfort = { attentesPort: [mesure("tmed_export", 1, 2), mesure("alg_entry", 3, 5)] };
  const f = N.fusionnerEtat(base, casa, francfort).etat;
  assert.deepStrictEqual([...f.attentesPort.map((x) => x.id)].sort(), ["malg_entry3", "mtmed_export1", "mtmed_export2"]);
});

/* ---------- D11 : notifications par étape ---------- */
const etatNotif = () => {
  N.S.params.tauxEUR = 10; N.S.routageJalons = []; N.S.notifsEtat = { annulees: {}, reports: {} }; N.S.commandes = []; N.S.factures = [];
  N.S.entreprise = { nom: "Atlas Fret", langueDefaut: "fr", audiences: { dispatcher_casa: { ntfy: "https://ntfy.sh/atlas-casa-7f3k" }, exploitante_frankfurt: { ntfy: "https://ntfy.sh/atlas-ffm-9q2z" }, comptabilite: { email: "compta@atlas.example" } } };
  N.S.clients = [{ id: "k1", nom: "Primeurs du Sud", tel: "+33 4 68 00 00 00", email: "achats@primeurs.example", langueNotif: "es", canalNotifPrefere: "whatsapp", notificationsClientAutorisees: true }, { id: "k2", nom: "Sans accord", tel: "0600000000", email: "x@y.example" }];
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", tel: "0612345678", langueNotif: "ar" }, { id: "h2", nom: "Karim", ntfy: "https://ntfy.sh/karim-camion-01" }];
  N.S.camions = [{ id: "c1", immat: "12345-A-6" }];
  N.S.voyages = [{ id: "v1", ref: "V-26-001", clientId: "k1", camionId: "c1", chauffeurId: "h1", statut: "prevu", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-20", heureDepart: "05:30", dateRetourPrevue: "2026-11-28", livraisonPrevue: "2026-11-23T08:00:00.000Z",
    traversees: [{ sens: "aller", ligne: "tmed-alg", date: "2026-11-20", heure: "16:00", ref: "DFDS-778", statut: "reservee" }, { sens: "retour", ligne: "alg-tmed", statut: "a_reserver" }], jalons: [], lignesCout: [] }];
};

test("routage des étapes : 11 étapes par défaut, valides ; une étape personnalisée remplace la sienne ; erreurs détectées", () => {
  etatNotif();
  const d = N.routageDefaut(); assert.strictEqual(d.length, 11); assert.deepStrictEqual([...d.map((r) => r.jalon)], [...N.JALONS_VOYAGE.map(([k]) => k)]);
  assert.ok(d.every((r) => N.routageErreurs(r).length === 0), JSON.stringify(d.map(N.routageErreurs)));
  assert.strictEqual(d.find((r) => r.jalon === "livre").auto, false); assert.strictEqual(d.find((r) => r.jalon === "port_tmed").auto, true); assert.deepStrictEqual([...d.find((r) => r.jalon === "livre").audiences.client_externe], ["prefere"]);
  N.S.routageJalons = [{ ...d[0], audiences: { chef_entreprise: ["in_app"] } }];
  assert.deepStrictEqual(Object.keys(N.routageJalons()[0].audiences), ["chef_entreprise"]); assert.strictEqual(N.routageJalons().length, 11);
  assert.deepStrictEqual([...N.routageErreurs({ jalon: "x", auto: "oui", audiences: { pirate: ["ntfy"], chauffeur: ["pigeon"] }, pre_notifications: [{ audience: "chauffeur", canal: "ntfy" }], modeles: { de: "Hallo" } })],
    ["Étape inconnue", "« auto » doit valoir vrai ou faux", "Destinataire inconnu : pirate", "Canaux invalides pour chauffeur", "Rappel avant : décalage en heures ou jour et heure attendus", "Message invalide (de)"]);
  assert.deepStrictEqual([...N.routageErreurs(null)], ["Entrée illisible"]);
});

test("étape atteinte : destinataires résolus (équipe, client avec accord, comptabilité), langue de chacun, manques signalés", () => {
  etatNotif(); const v = N.S.voyages[0]; v.statut = "en_cours"; v.jalons = [{ type: "livre", date: "2026-11-23T07:40:00.000Z" }];
  const { messages, manques } = N.notificationsJalon(v, "livre");
  const par = (a) => messages.find((m) => m.audience === a);
  const cl = par("client_externe"); assert.strictEqual(cl.canal, "whatsapp"); assert.strictEqual(cl.destination, "33468000000"); assert.strictEqual(cl.langue, "es"); assert.deepStrictEqual({ ...cl.repli }, { canal: "email", destination: "achats@primeurs.example" });
  assert.strictEqual(cl.texte, "Hola, su mercancía (V-26-001) fue entregada en Perpignan el 23/11 08:40. Gracias por su confianza — Atlas Fret.");
  const co = par("comptabilite"); assert.strictEqual(co.canal, "email"); assert.strictEqual(co.destination, "compta@atlas.example"); assert.ok(/V-26-001 livré le 23\/11 08:40 \(Primeurs du Sud\) : facture à émettre/.test(co.texte), co.texte); assert.strictEqual(co.sujet, "V-26-001 — Livré");
  assert.strictEqual(par("chef_entreprise").canal, "in_app"); assert.strictEqual(par("commercial").canal, "in_app");
  assert.strictEqual(messages.length, 4); assert.deepStrictEqual([...manques], []); assert.ok(messages.every((m) => m.id && m.cle && m.texte && !/\{\w+\}/.test(m.texte)));
  // client sans accord : jamais prévenu
  v.clientId = "k2"; const r = N.notificationsJalon(v, "livre"); assert.ok(!r.messages.some((m) => m.audience === "client_externe")); assert.ok(r.manques.some((x) => /notifications non autorisées/.test(x)));
  // étape d'équipe : sujet ntfy ; destinataire non renseigné → manque
  const e = N.notificationsJalon(v, "embarque_aller"); assert.deepStrictEqual([...e.messages.map((m) => [m.audience, m.canal])], [["dispatcher_casa", "ntfy"], ["exploitante_frankfurt", "ntfy"], ["chef_entreprise", "in_app"]]);
  assert.ok(/^V-26-001 — Embarqué \(aller\) \(\d\d\/\d\d \d\d:\d\d\)\. 12345-A-6 · Youssef · Agadir → Perpignan\.$/.test(e.messages[0].texte), e.messages[0].texte);
  delete N.S.entreprise.audiences.exploitante_frankfurt; assert.ok(N.notificationsJalon(v, "embarque_aller").manques.some((x) => /Exploitation Allemagne : sujet ntfy à renseigner/.test(x)));
});

test("messages : modèle personnalisé de l'étape dans la langue du destinataire, sinon modèle par défaut ; variables inconnues visibles", () => {
  etatNotif(); const v = N.S.voyages[0];
  N.S.routageJalons = [{ ...N.routageDefaut()[2], modeles: { fr: "{ref} au port à {heure} — {camion}", ar: "{ref} في الميناء {heure}" } }];
  N.S.entreprise.audiences.dispatcher_casa.langue = "ar"; v.jalons = [{ type: "port_tmed", date: "2026-11-20T11:00:00.000Z" }];
  const m = N.notificationsJalon(v, "port_tmed").messages; assert.strictEqual(m[0].texte, "V-26-001 في الميناء 20/11 12:00"); assert.strictEqual(m[1].texte, "V-26-001 au port à 20/11 12:00 — 12345-A-6");
  N.S.entreprise.audiences.exploitante_frankfurt.langue = "en"; assert.ok(/^V-26-001 — Entry into Tanger Med port \(20\/11 12:00\)|^V-26-001 — Entry into Tanger Med port \(2026-11-20 12:00\)/.test(N.notificationsJalon(v, "port_tmed").messages[1].texte), "pas de modèle anglais personnalisé : modèle par défaut en anglais");
  assert.strictEqual(N.remplirModele("{ref} {inconnue}", { ref: "A" }), "A {inconnue}"); assert.strictEqual(N.heureNotif(Date.parse("2026-11-20T23:30:00Z")), "21/11 00:30", "heure du Maroc (UTC+1)");
});

test("rappels programmés : veille du départ à 18 h, présentation au port, embarquement, livraison — ils suivent le voyage", () => {
  etatNotif(); const v = N.S.voyages[0]; N.S.chauffeurs[0].ntfy = "https://ntfy.sh/youssef-camion-1";
  const p = N.planNotifications({ depuis: Date.parse("2026-11-15T00:00:00Z"), jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: Date.parse("2026-11-15T00:00:00Z") });
  const vue = p.map((x) => [x.jalon, x.type, new Date(x.quand).toISOString().slice(0, 16), x.audience, x.canal]);
  assert.strictEqual(JSON.stringify(vue), JSON.stringify([
    ["depart", "pre", "2026-11-19T17:00", "dispatcher_casa", "ntfy"],        // veille à 18 h (Maroc)
    ["port_tmed", "pre", "2026-11-20T10:00", "chauffeur", "ntfy"],          // embarquement 16 h − 3 h de présentation − 2 h
    ["embarque_aller", "pre", "2026-11-20T12:00", "chauffeur", "ntfy"],     // 16 h − 3 h
    ["livre", "pre", "2026-11-23T07:00", "chauffeur", "ntfy"],              // créneau promis − 1 h
  ]));
  assert.strictEqual(p[1].langue, "ar"); assert.strictEqual(p[1].texte, "التقديم في ميناء طنجة المتوسط بعد ساعتين (20/11 13:00) — الرحلة V-26-001."); assert.ok(/Contrôles : /.test(p[0].texte)); assert.ok(/DFDS-778/.test(p[2].texte));
  // le départ est décalé d'un jour : le rappel de la veille aussi
  v.dateDepart = "2026-11-21"; const p2 = N.planNotifications({ depuis: Date.parse("2026-11-15T00:00:00Z"), jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: Date.parse("2026-11-15T00:00:00Z") });
  const d2 = p2.find((x) => x.jalon === "depart"); assert.strictEqual(new Date(d2.quand).toISOString().slice(0, 16), "2026-11-20T17:00"); assert.strictEqual(d2.id, p[0].id, "même identifiant : une annulation tient malgré le décalage"); assert.notStrictEqual(d2.cle, p[0].cle);
  // l'arrivée estimée recalculée décale le rappel de livraison
  v.eta = { arrivee: Date.parse("2026-11-23T12:00:00Z") / 1000 }; assert.strictEqual(new Date(N.planNotifications({ depuis: 0, jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: Date.parse("2026-11-15T00:00:00Z") }).find((x) => x.jalon === "livre").quand).toISOString().slice(11, 16), "11:00");
  // étape atteinte : plus de rappel avant elle ; fenêtre ; passé
  v.jalons = [{ type: "depart", date: "2026-11-21T05:00:00Z" }]; assert.ok(!N.planNotifications({ depuis: 0, jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: 0 }).some((x) => x.jalon === "depart"));
  assert.strictEqual(N.planNotifications({ depuis: Date.parse("2026-11-20T00:00:00Z"), jusqua: Date.parse("2026-11-20T11:00:00Z"), maintenant: Date.parse("2026-11-20T00:00:00Z") }).length, 1);
  assert.strictEqual(N.planNotifications({ depuis: 0, jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: Date.parse("2026-11-24T00:00:00Z") }).length, 0, "tout est passé");
  // chauffeur sans moyen de contact : rappel signalé, pas inventé
  delete N.S.chauffeurs[0].ntfy; N.S.chauffeurs[0].tel = ""; const p3 = N.planNotifications({ depuis: 0, jusqua: Date.parse("2026-12-01T00:00:00Z"), maintenant: Date.parse("2026-11-15T00:00:00Z") });
  assert.ok(!p3.some((x) => x.audience === "chauffeur")); assert.ok(p3.manques.length >= 3 && p3.manques.every((m) => /Youssef/.test(m.texte)));
});

test("rappels après une étape (facture à émettre), annulation et report d'un rappel", () => {
  etatNotif(); const v = N.S.voyages[0]; v.statut = "en_cours"; v.jalons = [{ type: "livre", date: "2026-11-23T07:40:00Z" }];
  const w = { depuis: Date.parse("2026-11-23T08:00:00Z"), jusqua: Date.parse("2026-11-30T00:00:00Z"), maintenant: Date.parse("2026-11-23T08:00:00Z") };
  let p = N.planNotifications(w); const f = p.find((x) => x.type === "post");
  assert.strictEqual(f.audience, "comptabilite"); assert.strictEqual(f.canal, "email"); assert.strictEqual(new Date(f.quand).toISOString(), "2026-11-24T07:40:00.000Z"); assert.ok(/facture à émettre/.test(f.texte));
  N.S.commandes = [{ id: "o1", factureId: "f1" }]; N.S.factures = [{ id: "f1", numero: "FAC-1", statut: "emise", lignes: [] }]; v.commandeId = "o1"; assert.ok(!N.planNotifications(w).some((x) => x.type === "post"), "déjà facturé : pas de rappel"); v.commandeId = "";
  N.S.notifsEtat.reports[f.id] = 2 * 3600000; p = N.planNotifications(w); assert.strictEqual(p.find((x) => x.id === f.id).quand, f.quand + 2 * 3600000); assert.strictEqual(p.find((x) => x.id === f.id).reporte, true);
  N.S.notifsEtat.annulees[f.id] = "2026-11-23T09:00:00Z"; assert.ok(!N.planNotifications(w).some((x) => x.id === f.id));
});

test("étapes à notifier automatiquement : récentes, routage automatique, une seule fois", () => {
  etatNotif(); const v = N.S.voyages[0], now = Date.parse("2026-11-20T15:00:00Z");
  v.jalons = [{ type: "depart", date: "2026-11-20T05:00:00Z" }, { type: "douane_export", date: "2026-11-20T13:00:00Z" }, { type: "port_tmed", date: "2026-11-20T14:30:00Z" }];
  assert.deepStrictEqual([...N.jalonsANotifier(now).map((x) => x.jalon)], ["port_tmed"], "départ trop ancien (10 h), douane manuelle");
  v.notifsJalons = ["port_tmed"]; assert.strictEqual(N.jalonsANotifier(now).length, 0);
  v.statut = "annule"; v.notifsJalons = []; assert.strictEqual(N.jalonsANotifier(now).length, 0);
});

test("schéma 8 : migration sans perte, routage vide = routage par défaut", () => {
  const r = N.migrer({ meta: { version: 7 }, voyages: [{ id: "v1", lignesCout: [{ id: "l" }] }], chargesGenerales: [{ id: "g" }] });
  assert.strictEqual(r.etat.meta.version, 8); assert.deepStrictEqual([...r.etat.routageJalons], []); assert.deepStrictEqual([...r.etat.notificationsApp], []); assert.deepStrictEqual(JSON.parse(JSON.stringify(r.etat.notifsEtat)), { annulees: {}, reports: {} });
  assert.strictEqual(r.etat.voyages[0].lignesCout.length, 1); assert.strictEqual(r.etat.chargesGenerales.length, 1);
  const k = N.migrer({ meta: { version: 7 }, notifsEtat: { annulees: { a: "x" } } }); assert.strictEqual(k.etat.notifsEtat.annulees.a, "x");
});

/* ---------- D9 : arabe sur les nouveaux écrans ---------- */
test("arabe : chaque libellé fixe des écrans de direction, d'opérations, de rentabilité, de dépenses et de notifications est traduit", () => {
  const src = fs.readFileSync(path.join(racine, "langue.js"), "utf8");
  const code = src.slice(src.indexOf("const AR = {"), src.indexOf("const LANGUES")) + src.slice(src.indexOf("const traduireTexte"), src.indexOf("function traduire("));
  const c = vm.createContext({}); vm.runInContext(code + ";this.AR = AR; this.traduireTexte = traduireTexte;", c);
  const pats = [/section-title"[^>]*>([^<$]+?)(?: · \$\{|<\/)/g, /<h2>([^<$]+?)(?:<\/h2>| · \$\{)/g, /\btitre: "([^"]+)"/g, /\bsous: "([^"]+)"/g, /class="l">(?:\$\{ic\("[a-z]+"\)\} )?([^<$]+)<\/div>/g, /\bbtn\("[a-z-]+", "([^"$]+)"/g, /<div class="groupe">([^<$]+?)(?: · |<)/g, /<th(?: class="r")?>([^<$]+)<\/th>/g];
  const manquants = new Set(), vus = new Set();
  for (const f of ["direction.js", "operations.js", "notifier.js", "cockpit.js", "marge.js", "depenses.js", "calendrier.js", "passages_ui.js", "aller_retour_ui.js", "lecture_commande_ui.js", "documents_commande_ui.js", "quais_ui.js", "fret_retour_ui.js", "devis_ui.js", "plein_ui.js", "envoi_facture_ui.js", "relais_ui.js", "ports_gps_ui.js", "fiche_ui.js", "factures_voyages.js", "boite_ui.js", "liens_ui.js", "itineraire_ui.js", "coupures_ui.js", "creneaux_ui.js", "chauffeur_ui.js"]) {
    const s = fs.readFileSync(path.join(racine, f), "utf8");
    for (const p of pats) for (const m of s.matchAll(p)) { const t = m[1].trim(); if (!t || /[{}]/.test(t) || !/[a-zé]/i.test(t)) continue; vus.add(t); if (!c.AR[t]) manquants.add(`${f} : ${t}`); }
  }
  assert.ok(vus.size >= 80, `${vus.size} libellés trouvés`); assert.deepStrictEqual([...manquants], []);
  assert.ok(Object.values(c.AR).every((x) => typeof x === "string" && /[؀-ۿ]/.test(x) || /^[+\d\sA-Za-z()./:…-]*$/.test(x)), "chaque traduction contient de l'arabe");
  assert.strictEqual(c.traduireTexte("Anomalies"), "حالات شاذة"); assert.strictEqual(c.traduireTexte("  Marge nette "), "  الهامش الصافي ");
  assert.strictEqual(c.traduireTexte("Anomalies · 3"), "حالات شاذة · 3", "libellé suivi d'un compte"); assert.strictEqual(c.traduireTexte("Programmées · 24 h · 2"), "المبرمجة · 24 h · 2");
  assert.strictEqual(c.traduireTexte("Texte inconnu · 3"), "Texte inconnu · 3");
});

/* ---------- D13 : droits par rôle (comptes.js, appliqués par le relais) ---------- */
const VOY = () => ({ id: "v1", ref: "V-1", chauffeurId: "h1", transitaireId: "u-tr", camionId: "c1", statut: "en_cours", origine: "Agadir", destination: "Perpignan", prix: 4000, devise: "EUR",
  lignesCout: [{ id: "l1", type: "carburant", montant: 9000 }], marge: { directe: 20000 }, carburantMad: 9000, jalons: [{ type: "depart", date: "x" }], traversees: [{ sens: "aller", ligne: "tmed-alg", fret: 320, baf: 2, ref: "DFDS-1", date: "2026-11-20" }], _v: 3, _seq: 9 });
const U = (role, plus = {}) => ({ id: "u-" + role, nom: role, role, ...plus });

test("droits : matrice des rôles — qui lit, voit les prix, écrit, supprime", () => {
  const dr = (role, col) => N.droitsSur(U(role), col);
  assert.strictEqual(dr("chef_entreprise", "factures").suppression, true); assert.ok(N.COLLECTIONS_SERVEUR.every((c) => dr("chef_entreprise", c)));
  assert.strictEqual(dr("dispatcher", "factures"), null, "le répartiteur n'a aucun accès aux factures"); assert.strictEqual(dr("dispatcher", "voyages").finances, false); assert.strictEqual(dr("dispatcher", "voyages").ecriture, true);
  assert.strictEqual(dr("exploitant", "voyages").finances, true); assert.strictEqual(dr("exploitant", "factures").ecriture, false);
  assert.strictEqual(dr("commercial", "voyages").ecriture, false); assert.strictEqual(dr("commercial", "factures").ecriture, true); assert.strictEqual(dr("commercial", "factures").suppression, false);
  assert.deepStrictEqual([...dr("comptable", "voyages").ecriture], ["lignesCout", "marge", "factureId"]); assert.strictEqual(dr("comptable", "voyages").suppression, false);
  assert.strictEqual(dr("chauffeur", "voyages").lecture, "propre"); assert.strictEqual(dr("chauffeur", "factures"), null); assert.strictEqual(dr("transitaire", "dossiers").lecture, "propre"); assert.strictEqual(dr("transitaire", "clients"), null);
  assert.strictEqual(N.droitsSur({ ...U("chef_entreprise"), cloture: true }, "voyages"), null, "compte clôturé : plus rien");
  assert.strictEqual(N.estChef(U("chef_entreprise")), true); assert.strictEqual(N.estChef(U("exploitant")), false); assert.strictEqual(N.peutSuivre(U("dispatcher")), true); assert.strictEqual(N.peutSuivre(U("chauffeur")), false);
  assert.strictEqual(N.ROLES_COMPTES.length, 7); assert.ok(N.ROLES_COMPTES.every(([k]) => N.PROFIL_DU_ROLE[k]));
});

test("droits : prix et marges retirés pour qui ne doit pas les voir, jusque dans les traversées et les réglages", () => {
  const v = VOY(), d = N.filtrerEnregistrement("voyages", v, U("dispatcher"));
  for (const k of ["prix", "lignesCout", "marge", "carburantMad"]) assert.ok(!(k in d), k);
  assert.strictEqual(d.destination, "Perpignan"); assert.strictEqual(d.traversees[0].ref, "DFDS-1"); assert.ok(!("fret" in d.traversees[0]) && !("baf" in d.traversees[0])); assert.strictEqual(v.traversees[0].fret, 320, "l'original n'est pas modifié");
  assert.strictEqual(N.filtrerEnregistrement("voyages", v, U("exploitant")).prix, 4000); assert.strictEqual(N.filtrerEnregistrement("factures", { id: "f" }, U("dispatcher")), null);
  const e = N.filtrerEnregistrement("reglages", { id: "entreprise", nom: "Atlas", tresorerie: { solde: 1 } }, U("dispatcher")); assert.strictEqual(e.nom, "Atlas"); assert.ok(!("tresorerie" in e));
  assert.ok(!("fixeMensuel" in N.filtrerEnregistrement("camions", { id: "c1", immat: "A", fixeMensuel: 9000 }, U("commercial"))));
});

test("droits : une écriture ne peut ni effacer les prix qu'on ne voit pas, ni toucher un champ interdit, ni sortir de son périmètre", () => {
  const v = VOY();
  // le répartiteur renvoie le voyage tel qu'il le voit (sans prix) en changeant la destination : les prix sont conservés
  const vue = N.filtrerEnregistrement("voyages", v, U("dispatcher")); vue.destination = "Lyon"; vue.traversees[0].ref = "DFDS-2";
  let r = N.appliquerEcriture("voyages", v, vue, U("dispatcher")); assert.strictEqual(r.ok, true);
  assert.strictEqual(r.enregistrement.destination, "Lyon"); assert.strictEqual(r.enregistrement.prix, 4000); assert.strictEqual(r.enregistrement.lignesCout.length, 1); assert.strictEqual(r.enregistrement.traversees[0].fret, 320); assert.strictEqual(r.enregistrement.traversees[0].ref, "DFDS-2");
  assert.ok(!("_v" in r.enregistrement), "champs techniques ignorés");
  r = N.appliquerEcriture("voyages", v, { ...vue, prix: 1 }, U("dispatcher")); assert.strictEqual(r.enregistrement.prix, 4000, "ni modifier un prix qu'il ne voit pas");
  // comptable : seulement les dépenses
  r = N.appliquerEcriture("voyages", v, { ...v, destination: "Paris", lignesCout: [...v.lignesCout, { id: "l2", type: "amendes", montant: 100 }] }, U("comptable"));
  assert.strictEqual(r.enregistrement.destination, "Perpignan"); assert.strictEqual(r.enregistrement.lignesCout.length, 2);
  assert.strictEqual(N.appliquerEcriture("voyages", null, { id: "v9" }, U("comptable")).ok, false, "écriture partielle : pas de création");
  // chauffeur : son voyage seulement, ses champs seulement, sans pouvoir se l'attribuer
  const ch = U("chauffeur", { chauffeurId: "h1" });
  r = N.appliquerEcriture("voyages", v, { ...v, jalons: [...v.jalons, { type: "douane_export", date: "y" }], prix: 1, chauffeurId: "h1" }, ch); assert.strictEqual(r.ok, true); assert.strictEqual(r.enregistrement.jalons.length, 2); assert.strictEqual(r.enregistrement.prix, 4000);
  assert.strictEqual(N.appliquerEcriture("voyages", { ...v, chauffeurId: "h2" }, v, ch).ok, false, "voyage d'un autre");
  assert.strictEqual(N.appliquerEcriture("factures", null, { id: "f" }, U("dispatcher")).ok, false); assert.strictEqual(N.appliquerEcriture("voyages", v, v, U("transitaire")).ok, false);
  assert.strictEqual(N.appliquerEcriture("reglages", null, { id: "pirate" }, U("chef_entreprise")).ok, false);
  // suppression et périmètre
  assert.strictEqual(N.peutSupprimer("voyages", v, U("comptable")), false); assert.strictEqual(N.peutSupprimer("voyages", v, U("dispatcher")), true);
  assert.strictEqual(N.peutVoir("voyages", v, ch), true); assert.strictEqual(N.peutVoir("voyages", { ...v, chauffeurId: "h2" }, ch), false); assert.strictEqual(N.peutVoir("voyages", v, U("chauffeur")), false, "compte chauffeur non relié à une fiche : rien");
  assert.strictEqual(N.peutVoir("camions", { id: "c1" }, ch, { camionsDuChauffeur: ["c1"] }), true); assert.strictEqual(N.peutVoir("camions", { id: "c2" }, ch, { camionsDuChauffeur: ["c1"] }), false);
  assert.strictEqual(N.peutVoir("dossiers", { id: "d", transitaireId: "u-transitaire" }, U("transitaire")), true); assert.strictEqual(N.peutVoir("dossiers", { id: "d", transitaireId: "x" }, U("transitaire")), false);
  // journal : différences
  assert.deepStrictEqual(JSON.parse(JSON.stringify(N.diffEnregistrement({ a: 1, b: 2, _v: 1 }, { a: 1, b: 3, c: 4, _v: 2 }))), { b: [2, 3], c: [null, 4] });
  assert.strictEqual(N.motDePasseValide("court"), false); assert.strictEqual(N.motDePasseValide("douze-caract"), true); assert.strictEqual(N.emailCompteValide("a@b.example"), true); assert.strictEqual(N.emailCompteValide("a@b"), false);
});

/* ---------- planning des chauffeurs et des camions ---------- */
const etatPlanning = () => {
  N.S.entreprise = { nom: "Atlas Fret" };
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [], absences: [{ id: "a1", type: "conge", debut: "2026-11-23", fin: "2026-11-27", note: "Mariage" }] }, { id: "h2", nom: "Karim", sejours: [], permis: "2026-11-20" }, { id: "h3", nom: "Said", sejours: [{ entree: "2026-07-28", sortie: "2026-10-25" }] }, { id: "h4", nom: "Anas", conge: true, sejours: [] }];
  N.S.camions = [{ id: "c1", immat: "111-A-1", immobilisations: [{ id: "i1", type: "panne", debut: "2026-11-25", fin: "2026-11-26" }] }, { id: "c2", immat: "222-B-2", visite: "2026-11-30" }];
  N.S.voyages = [
    { id: "v1", ref: "V-1", chauffeurId: "h1", camionId: "c1", statut: "en_cours", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-16", dateRetourPrevue: "2026-11-21", traversees: [{ sens: "aller", date: "2026-11-17", heure: "14:00", ref: "DFDS-9" }] },
    { id: "v2", ref: "V-2", chauffeurId: "h2", camionId: "c2", statut: "prevu", origine: "Casablanca", destination: "Lyon", dateDepart: "2026-11-18", dateRetourPrevue: "2026-11-24" },
    { id: "v3", ref: "V-3", chauffeurId: "h1", camionId: "c2", statut: "annule", dateDepart: "2026-11-18", dateRetourPrevue: "2026-11-20" },
  ];
};

test("planning : occupation jour par jour — voyage, absence, immobilisation, papiers expirés, libre", () => {
  etatPlanning(); const ch = (id) => N.parId(N.S.chauffeurs, id), cam = (id) => N.parId(N.S.camions, id);
  assert.strictEqual(N.occupation("chauffeur", ch("h1"), "2026-11-16").statut, "voyage"); assert.strictEqual(N.occupation("chauffeur", ch("h1"), "2026-11-21").libelle, "V-1", "jour du retour compris");
  assert.strictEqual(N.occupation("chauffeur", ch("h1"), "2026-11-22").statut, "libre"); const a = N.occupation("chauffeur", ch("h1"), "2026-11-25"); assert.strictEqual(a.statut, "absent"); assert.strictEqual(a.libelle, "Congé"); assert.strictEqual(a.note, "Mariage");
  assert.strictEqual(N.occupation("chauffeur", ch("h2"), "2026-11-19").statut, "voyage", "le voyage passe avant les papiers"); assert.strictEqual(N.occupation("chauffeur", ch("h2"), "2026-11-25").libelle, "Permis expiré");
  assert.strictEqual(N.occupation("camion", cam("c1"), "2026-11-25").libelle, "Panne"); assert.strictEqual(N.occupation("camion", cam("c2"), "2026-12-01").statut, "papiers"); assert.strictEqual(N.occupation("camion", cam("c2"), "2026-11-30").statut, "libre", "valable jusqu'au jour inclus");
  assert.strictEqual(N.occupation("chauffeur", ch("h4"), N.today()).statut, "absent", "ancienne case « en congé »"); assert.strictEqual(N.occupation("chauffeur", ch("h4"), "2020-01-01").statut, "libre");
  // un voyage terminé plus tôt libère les jours restants
  N.S.voyages[0].jalons = [{ type: "retour", date: "2026-11-19T18:00:00Z" }]; assert.strictEqual(N.occupation("chauffeur", ch("h1"), "2026-11-20").statut, "libre");
});

test("planning : grille sur 14 jours, libres par jour, jours Schengen restants", () => {
  etatPlanning(); const g = N.grillePlanning("chauffeur", "2026-11-16", 14);
  assert.strictEqual(g.jours.length, 14); assert.strictEqual(g.jours[13], "2026-11-29"); assert.deepStrictEqual([...g.lignes.map((l) => l.nom)], ["Youssef", "Karim", "Said", "Anas"]);
  assert.strictEqual(g.lignes[0].libres, 14 - 6 - 5); assert.strictEqual(g.libresParJour[0], g.lignes.filter((l) => l.cellules[0].statut === "libre").length); assert.strictEqual(g.libresParJour[0], "2026-11-16" >= N.today() ? 2 : 3, "16/11 : Karim (part le 18) et Said ; Youssef part ce jour-là ; Anas (case « en congé » : comptée à partir d'aujourd'hui seulement)");
  assert.strictEqual(g.lignes[2].schengen, N.schengenEtat(N.S.chauffeurs[2].sejours, "2026-11-16").restant); assert.ok(g.lignes[2].schengen < g.lignes[0].schengen);
  assert.strictEqual(N.grillePlanning("camion", "2026-11-16", 7).lignes[0].cellules.filter((c) => c.statut === "voyage").length, 6);
});

test("planning : conflits d'affectation (double voyage, absence, immobilisation), sans compter le voyage lui-même ni les annulés", () => {
  etatPlanning();
  N.S.voyages.push({ id: "v4", ref: "V-4", chauffeurId: "h1", camionId: "c1", statut: "prevu", origine: "Tanger", destination: "Madrid", dateDepart: "2026-11-20", dateRetourPrevue: "2026-11-26" });
  const c = N.conflitsAffectation(N.S.voyages[3]).map((x) => x.texte);
  assert.ok(c.some((t) => /Youssef est déjà sur le voyage V-1 du 16\/11\/2026 au 21\/11\/2026/.test(t))); assert.ok(c.some((t) => /Youssef : congé du 23\/11\/2026 au 27\/11\/2026/.test(t)));
  assert.ok(c.some((t) => /111-A-1 est déjà sur le voyage V-1/.test(t))); assert.ok(c.some((t) => /111-A-1 : panne du 25\/11\/2026/.test(t))); assert.ok(!c.some((t) => /V-3/.test(t)), "voyage annulé ignoré");
  assert.ok(N.controlesVoyage(N.S.voyages[3]).some((x) => x.niveau === "danger" && /déjà sur le voyage V-1/.test(x.texte)), "dans les contrôles avant départ (et donc les alertes)");
  N.S.voyages[3].dateDepart = "2026-11-28"; N.S.voyages[3].dateRetourPrevue = "2026-12-02"; assert.strictEqual(N.conflitsAffectation(N.S.voyages[3]).length, 0, "plus de chevauchement");
  N.S.voyages[3].statut = "termine"; assert.strictEqual(N.conflitsAffectation(N.S.voyages[3]).length, 0);
});

test("planning : qui est libre sur une période — libres d'abord, raisons, Schengen", () => {
  etatPlanning(); N.S.chauffeurs[3].conge = false;
  const l = N.ressourcesLibres("chauffeur", "2026-11-19", "2026-11-22");
  assert.deepStrictEqual([...l.filter((x) => x.libre).map((x) => x.nom)], ["Anas"], "Said a trop de jours Schengen, Karim et Youssef sont en voyage");
  assert.ok(l.find((x) => x.nom === "Said").raisons.some((r) => /jours Schengen sur 180/.test(r))); assert.ok(l.find((x) => x.nom === "Karim").raisons.some((r) => /permis expiré le 20\/11\/2026, pendant la période/.test(r)));
  assert.strictEqual(l[0].nom, "Anas"); assert.ok(N.ressourcesLibres("chauffeur", "2026-11-19", "2026-11-22", { sauf: "v1" }).find((x) => x.nom === "Youssef").libre, "en modifiant V-1, son propre voyage ne compte pas");
  assert.deepStrictEqual([...N.ressourcesLibres("camion", "2026-11-24", "2026-11-25").filter((x) => x.libre).map((x) => x.nom)], [], "c1 en panne le 25, c2 encore en voyage le 24");
});

test("dupliquer un voyage : même trajet, équipe et prix ; dates décalées ; étapes, dépenses et réservations remises à zéro", () => {
  etatPlanning(); const v = { ...N.S.voyages[0], prix: 4000, devise: "EUR", kmAller: 2000, tempMin: 2, tempMax: 6, livraisonPrevue: "2026-11-18T08:00:00.000Z", lignesCout: [{ id: "l", type: "carburant", montant: 1 }], jalons: [{ type: "depart" }], pod: { signataire: "X" }, auditLog: [{}], partage: { id: "p" } };
  const d = N.dupliquerVoyage(v, "2026-12-01", "V-2026-0099");
  assert.strictEqual(d.ref, "V-2026-0099"); assert.notStrictEqual(d.id, v.id); assert.strictEqual(d.statut, "prevu"); assert.strictEqual(d.dateRetourPrevue, "2026-12-06", "même durée (5 jours)"); assert.strictEqual(d.livraisonPrevue, "2026-12-03T08:00:00.000Z");
  for (const k of ["origine", "destination", "chauffeurId", "camionId", "prix", "devise", "kmAller", "tempMin"]) assert.strictEqual(d[k], v[k], k);
  assert.strictEqual(d.lignesCout.length, 0); assert.strictEqual(d.jalons.length, 0); assert.ok(!d.pod && !d.auditLog && !d.partage);
  assert.strictEqual(d.traversees[0].statut, "a_reserver"); assert.strictEqual(d.traversees[0].ref, ""); assert.strictEqual(v.traversees[0].ref, "DFDS-9", "l'original n'est pas touché");
});

test("programme du chauffeur : voyages et absences des 7 prochains jours, prêt à envoyer", () => {
  etatPlanning(); const t = N.programmeChauffeur(N.S.chauffeurs[0], "2026-11-20", 7);
  assert.ok(t.startsWith("Bonjour Youssef, votre programme du 20/11/2026 au 26/11/2026 :")); assert.ok(/• V-1 : Agadir → Perpignan, départ le 16\/11\/2026, retour prévu le 21\/11\/2026, camion 111-A-1, traversée le 17\/11\/2026 à 14:00 \(réservation DFDS-9\)/.test(t), t);
  assert.ok(/• Congé du 23\/11\/2026 au 27\/11\/2026/.test(t)); assert.ok(t.endsWith("— Atlas Fret")); assert.ok(/Aucun voyage prévu/.test(N.programmeChauffeur(N.S.chauffeurs[2], "2026-11-20")));
});

/* ---------- voyage fait → facture ---------- */
const etatFac = () => {
  N.S.params.tauxEUR = 10; N.S.params.tvaDefaut = 0; N.S.params.delaiPaiement = 30;
  N.S.clients = [{ id: "k1", nom: "Primeurs du Sud", delai: 45 }, { id: "k2", nom: "Froid Express" }];
  N.S.factures = []; N.S.commandes = [{ id: "o1", ref: "C-1", factureId: "" }];
  N.S.voyages = [
    { id: "v1", ref: "V-1", clientId: "k1", statut: "en_cours", origine: "Agadir", destination: "Perpignan", marchandise: "Tomates", cmr: "CMR-77", prix: 4000, devise: "EUR", kmRetourCharge: 1900, jalons: [{ type: "livre", date: "2026-11-05T09:00:00Z" }] },
    { id: "v2", ref: "V-2", clientId: "k1", statut: "termine", origine: "Casablanca", destination: "Lyon", prix: 3000, devise: "EUR", dateDepart: "2026-10-20", dateRetourPrevue: "2026-10-30", jalons: [] },
    { id: "v3", ref: "V-3", clientId: "k2", statut: "en_cours", prix: 30000, devise: "MAD", jalons: [{ type: "depart", date: "2026-11-10T06:00:00Z" }] },
    { id: "v4", ref: "V-4", statut: "annule", prix: 1, jalons: [{ type: "livre", date: "2026-11-01" }] },
    { id: "v5", ref: "V-5", clientId: "k2", commandeId: "o1", statut: "termine", dateRetourPrevue: "2026-11-02", prix: 5000, devise: "MAD", jalons: [] },
  ];
};
test("voyages à facturer : faits (livrés ou terminés), pas encore facturés, du plus ancien au plus récent ; alerte", () => {
  etatFac(); assert.strictEqual(N.voyageFaitLe(N.S.voyages[0]), "2026-11-05"); assert.strictEqual(N.voyageFaitLe(N.S.voyages[1]), "2026-10-30"); assert.strictEqual(N.voyageFaitLe(N.S.voyages[2]), ""); assert.strictEqual(N.voyageFaitLe(N.S.voyages[3]), "");
  const l = N.voyagesAFacturer("2026-11-13"); assert.deepStrictEqual([...l.map((x) => [x.voyage.id, x.depuis])], [["v2", 14], ["v1", 8], ["v5", 11]].sort((a, b) => b[1] - a[1]));
  N.S.factures = [{ id: "f9", numero: "FAC-9", clientId: "k2", lignes: [] }]; N.S.commandes[0].factureId = "f9";
  assert.strictEqual(N.factureDuVoyage(N.S.voyages[4]).numero, "FAC-9", "facturé par sa commande liée"); assert.ok(!N.voyagesAFacturer("2026-11-13").some((x) => x.voyage.id === "v5"));
  const a = N.alertes().filter((x) => /pas encore facturé/.test(x.texte)); assert.ok(a.length >= 2); assert.ok(a.every((x) => x.cat === "factures" && x.onglet === "voyages"));
});
test("facturer un voyage : facture créée et reliée (numéro, échéance du client, devise, ligne détaillée) ; double facturation refusée", () => {
  etatFac(); const v = N.S.voyages[0];
  const f = N.creerFactureVoyages([v], { date: "2026-11-13" });
  assert.strictEqual(f.numero, N.prochainNumero("FAC", [], "numero")); assert.strictEqual(f.clientId, "k1"); assert.strictEqual(f.devise, "EUR"); assert.strictEqual(f.echeance, "2026-12-28", "délai du client : 45 jours"); assert.strictEqual(f.tva, 0);
  assert.strictEqual(f.lignes[0].montant, 4000); assert.strictEqual(f.lignes[0].designation, "Transport international Agadir → Perpignan et retour — Tomates · voyage V-1 · CMR CMR-77");
  assert.strictEqual(v.factureId, f.id); assert.deepStrictEqual([...f.voyageIds], ["v1"]); assert.strictEqual(N.factureDuVoyage(v), f); assert.strictEqual(N.totauxFacture(f).ttc, 4000);
  assert.throws(() => N.creerFactureVoyages([v]), /déjà facturé/); assert.throws(() => N.creerFactureVoyages([{ id: "x", ref: "X" }]), /n'a pas de client/); assert.throws(() => N.creerFactureVoyages([N.S.voyages[1], N.S.voyages[2]]), /même client/);
  // un voyage de plus sur la même facture ; conversion si la devise diffère
  const g = N.creerFactureVoyages([N.S.voyages[2]]); N.S.voyages.push({ id: "v6", ref: "V-6", clientId: "k2", prix: 100, devise: "EUR", jalons: [] });
  N.rattacherVoyageFacture(N.S.voyages[5], g); assert.strictEqual(g.lignes.length, 2); assert.strictEqual(g.lignes[1].montant, 1000, "100 € convertis en MAD"); assert.strictEqual(N.factureDuVoyage(N.S.voyages[5]), g);
  assert.throws(() => N.rattacherVoyageFacture(N.S.voyages[1], g), /autre client/); assert.throws(() => N.rattacherVoyageFacture(N.S.voyages[5], g), /déjà facturé/);
  // facture supprimée : le voyage redevient à facturer
  N.S.factures = N.S.factures.filter((x) => x.id !== f.id); assert.strictEqual(N.factureDuVoyage(v), null);
  // la trésorerie ne compte plus la recette d'un voyage facturé (elle vient de la facture)
  N.S.voyages[2].statut = "en_cours"; N.S.voyages[2].dateDepart = "2026-11-10"; N.S.voyages[2].dateRetourPrevue = "2026-11-20"; N.S.voyages[2].lignesCout = [];
  assert.ok(!N.previsionsTresorerie(90, { depart: "2026-11-13", solde: 0 }).jours.some((j) => j.items.some((i) => i.type === "recette_prevue" && i.ref === "v3")));
});
/* ---------- passage des ports étape par étape ---------- */
const etatPorts = () => {
  N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [] }];
  N.S.voyages = [{ id: "v1", ref: "V-1", chauffeurId: "h1", statut: "en_cours", tempMin: 2, tempMax: 6, jalons: [{ type: "depart", date: "2026-11-12T05:00:00.000Z" }], traversees: [{ sens: "aller", ligne: "tmed-alg", statut: "reservee" }, { sens: "retour", ligne: "alg-tmed", statut: "a_reserver" }] }];
};
test("ports : quatre passages (aller et retour), étapes détaillées, contrôles sanitaires seulement pour le frais", () => {
  etatPorts(); const v = N.S.voyages[0];
  assert.deepStrictEqual([...N.portsDuSens("aller").map((p) => p.id)], ["tmed_export", "alg_entree"]); assert.deepStrictEqual([...N.portsDuSens("retour").map((p) => p.id)], ["alg_sortie", "tmed_import"]);
  for (const [id, p] of Object.entries(N.PORTS_PASSAGE)) for (const e of p.etapes) { assert.ok(e.id && e.lib && e.detail && Array.isArray(e.docs), `${id}/${e.id}`); if (e.jalon) assert.ok(N.JALONS_VOYAGE.some(([k]) => k === e.jalon), e.jalon); }
  assert.strictEqual(new Set(Object.values(N.PORTS_PASSAGE).flatMap((p) => p.etapes.map((e) => e.id))).size, Object.values(N.PORTS_PASSAGE).reduce((n, p) => n + p.etapes.length, 0), "identifiants uniques");
  assert.ok(N.etapesApplicables(v, "alg_entree").some((e) => e.id === "alg_pcf"), "frais : contrôle sanitaire à Algeciras"); assert.ok(!N.etapesApplicables({ ...v, tempMin: undefined, tempMax: undefined }, "alg_entree").some((e) => e.id === "alg_pcf"), "sec : pas de contrôle sanitaire");
});
const etatRelances = () => { N.S.params = { ...N.S.params, relancesJours: "-3,7,15,30", relancesAuto: false }; N.S.entreprise = { nom: "Atlas Fret", banque: "Banque Populaire", rib: "190 780 21211 1234567 000 05" };
  N.S.clients = [{ id: "k1", nom: "Primeurs du Souss", contact: "Karim", email: "achats@souss.ma", langueNotif: "es" }, { id: "k2", nom: "Sans e-mail" }];
  N.S.voyages = [{ id: "v1", ref: "V-1", factureId: "f1", commandeId: "o1", commandeRetourId: "o2", jalons: [], pod: { date: "2026-11-10T09:00:00Z", signataire: "M. Dupont" } }, { id: "v2", ref: "V-2", commandeId: "o3", jalons: [] }];
  N.S.factures = [{ id: "f1", numero: "FAC-2026-0010", clientId: "k1", voyageIds: ["v1"], date: "2026-11-10", echeance: "2026-12-10", devise: "EUR", tva: 0, statut: "emise", lignes: [{ designation: "Transport", montant: 3200 }] },
    { id: "f2", numero: "FAC-2026-0011", clientId: "k2", commandeIds: ["o3"], date: "2026-11-01", echeance: "2026-11-20", devise: "MAD", tva: 14, statut: "emise", lignes: [{ designation: "Transport", montant: 10000 }] }]; };
const ms = (iso) => Date.parse(iso + "T00:00:00Z");
test("relances : voyages et photos d'une facture, message d'envoi et relances dans la langue du client (rappel avant l'échéance, puis de plus en plus fermes)", () => {
  etatRelances(); const [f1, f2] = N.S.factures;
  assert.deepStrictEqual([...N.voyagesFacture(f1).map((v) => v.id)], ["v1"]); assert.deepStrictEqual([...N.voyagesFacture(f2).map((v) => v.id)], ["v2"], "par la commande facturée");
  assert.deepStrictEqual([...N.ciblesPhotosFacture(f1)].sort(), ["commande:o1", "commande:o2", "voyage:v1"].sort());
  const e = N.texteEnvoiFacture(f1); assert.strictEqual(e.langue, "es"); assert.ok(/^Buenos días Karim,/.test(e.texte)); assert.ok(/factura FAC-2026-0010 del 10\/11\/2026 por un importe de 3[\s\u202f\u00a0]?200,00 €, con vencimiento el 10\/12\/2026/.test(e.texte), e.texte); assert.ok(/CMR firmado y la prueba de entrega/.test(e.texte)); assert.ok(/190 780/.test(e.texte), "RIB");
  assert.ok(/^Factura FAC-2026-0010 — V-1$/.test(e.sujet));
  const r0 = N.texteRelance(f1, -3), r1 = N.texteRelance(f1, 7), r3 = N.texteRelance(f1, 30);
  assert.ok(/^Recordatorio de vencimiento/.test(r0.sujet) && /vence el 10\/12\/2026/.test(r0.texte)); assert.ok(/sigue pendiente/.test(r1.texte)); assert.ok(/ocho días/.test(r3.texte));
  N.S.clients[0].langueNotif = "fr"; assert.ok(/^Relance — facture FAC-2026-0010$/.test(N.texteRelance(f1, 15).sujet)); assert.ok(/^Bonjour Karim,\n\nMalgré notre précédent rappel/.test(N.texteRelance(f1, 15).texte));
});
test("relances : plan (fil de l'équipe ; e-mail au client si activé), 9 h 30 heure du Maroc, payée ou suspendue = plus de relance, prochaines relances", () => {
  etatRelances(); const [f1, f2] = N.S.factures;
  let p = N.planRelances({ depuis: ms("2026-11-01"), jusqua: ms("2027-02-01") });
  assert.deepStrictEqual([...p.filter((m) => m.factureId === "f1").map((m) => m.id.split(":")[2])], ["-3", "7", "15", "30"]); assert.ok(p.every((m) => m.canal === "in_app"), "sans envoi automatique : l'équipe seulement");
  assert.strictEqual(p.find((m) => m.id === "relance:f1:7:equipe").quand, Date.parse("2026-12-17T08:30:00Z"), "9 h 30 au Maroc (UTC+1)"); assert.ok(/^Relancer Primeurs du Souss : facture FAC-2026-0010/.test(p[0].texte) || p.some((m) => /^Relancer Primeurs du Souss/.test(m.texte)));
  N.S.params.relancesAuto = true; p = N.planRelances({ depuis: ms("2026-11-01"), jusqua: ms("2027-02-01") });
  const cli = p.filter((m) => m.canal === "email"); assert.strictEqual(cli.length, 4, "e-mail au client qui a une adresse"); assert.strictEqual(cli[0].destination, "achats@souss.ma"); assert.ok(!p.some((m) => m.canal === "email" && m.factureId === "f2"), "client sans e-mail : équipe seulement");
  f1.statut = "payee"; assert.ok(!N.planRelances({ depuis: ms("2026-11-01"), jusqua: ms("2027-02-01") }).some((m) => m.factureId === "f1"), "payée : plus de relance"); f1.statut = "emise";
  f1.sansRelance = true; assert.ok(!N.planRelances({ depuis: ms("2026-11-01"), jusqua: ms("2027-02-01") }).some((m) => m.factureId === "f1")); delete f1.sansRelance;
  N.S.clients[0].sansRelance = true; assert.deepStrictEqual([...N.prochainesRelances(f1, ms("2026-11-16"))], [], "client sans relance"); delete N.S.clients[0].sansRelance;
  assert.deepStrictEqual([...N.prochainesRelances(f2, ms("2026-11-25")).map((x) => x.j)], [7, 15, 30], "échéance passée : les relances suivantes");
  N.S.params.relancesJours = "5, 20"; assert.deepStrictEqual([...N.prochainesRelances(f2, ms("2026-11-16")).map((x) => x.date)], ["2026-11-25", "2026-12-10"], "jours réglables");
});

const etatPlein = () => { N.S.params = { ...N.S.params, tauxEUR: 10.91, prixGasoil: 12.5, consoDefaut: 32, reservoirL: 700, prixGasoilJour: { maj: Date.parse("2026-11-16T08:00:00Z"), MA: { prix: 12.5 }, ES: { prix: 1.869, algeciras: 1.867 }, FR: { prix: 2.149, pyreneesOrientales: 2.109 } } }; N.S.camions = [{ id: "c1", immat: "111-A-1" }]; N.S.voyages = []; N.S.commandes = []; N.S.pleins = []; N.S.chauffeurs = []; };
const voyagePlein = (destination, plus = {}) => ({ id: "v", ref: "V-1", origine: "Agadir", destination, camionId: "c1", statut: "en_cours", jalons: [], ...plus });
test("plein par pays : trajet découpé (Maroc, Espagne, France), plein complet au Maroc, Espagne avant la frontière et au retour, jamais en France", () => {
  etatPlein();
  const t = N.trajetParPays(voyagePlein("Lyon")); assert.strictEqual(t.paysDest, "France"); assert.ok(/Jonquera/.test(t.frontiere)); assert.ok(t.kmES > 1100 && t.kmES < 1400 && t.kmFR > 400 && t.kmFR < 600, JSON.stringify(t));
  assert.ok(/Irun/.test(N.trajetParPays(voyagePlein("Bordeaux")).frontiere), "ouest de la France : par Irun");
  const p = N.planPlein(voyagePlein("Lyon"));
  assert.deepStrictEqual([...p.achats.map((a) => a.pays + ":" + a.lieu.split(" (")[0])], ["MA:avant Tanger Med", "ES:avant la frontière", "ES:après la frontière"]);
  assert.strictEqual(p.achats[0].litres, 700, "plein complet au Maroc, le moins cher"); assert.ok(!p.achats.some((a) => a.pays === "FR"), "rien en France");
  assert.ok(p.economieEuros > 300, `économie ${p.economieEuros} €`); assert.strictEqual(p.prix.ES, 1.867, "prix d'Algeciras"); assert.strictEqual(p.prix.FR, 2.109, "prix des Pyrénées-Orientales");
  const m = N.planPlein(voyagePlein("Madrid")); assert.deepStrictEqual([...m.achats.map((a) => a.pays)], ["MA"], "Madrid : tout l'aller-retour sur le gasoil marocain"); assert.ok(m.achats[0].litres < 700);
  assert.strictEqual(N.planPlein(voyagePlein("Casablanca")), null, "trajet national : pas de consigne");
  const txt = N.texteConsignePlein(voyagePlein("Lyon")); assert.ok(/^Consigne de plein — V-1 \(Agadir → Lyon\)\n1\. Maroc, avant Tanger Med : plein complet \(12,50 MAD\/L\)/.test(txt), txt); assert.ok(/Ne pas faire le plein en France/.test(txt));
});
test("plein par pays : petit réservoir (un complément en France devient nécessaire), consommation du camion, écart après coup d'après la carte carburant", () => {
  etatPlein(); N.S.camions[0].reservoirL = 400;
  const p = N.planPlein(voyagePlein("Rungis")); assert.strictEqual(p.reservoir, 400); assert.ok(p.achats.some((a) => a.pays === "FR"), "400 L ne suffisent pas pour l'aller-retour en France");
  N.S.camions[0].reservoirL = 700;
  const v = voyagePlein("Perpignan", { lignesCout: [{ type: "carburant", litres: 300, pays: "FR", montant: 640, devise: "EUR" }, { type: "carburant", litres: 200, pays: "ES", montant: 374, devise: "EUR" }] });
  const e = N.ecartPlein(v); assert.strictEqual(e.reelFR, 300); assert.strictEqual(e.prevuFR, 0); assert.strictEqual(e.surcoutEuros, Math.round(300 * (2.109 - 1.867)));
  assert.strictEqual(N.ecartPlein(voyagePlein("Perpignan")), null, "pas de ligne carburant : pas d'écart");
});

const etatDevis = () => { N.S.params = { ...N.S.params, tauxEUR: 10, prixGasoil: 12, consoDefaut: 30, margeVisee: 15, fretDetroitEur: 0 }; delete N.S.params.prixGasoilJour; N.S.factures = []; N.S.trajets = []; N.S.interventions = []; N.S.chargesGenerales = []; N.S.pleins = [];
  N.S.camions = [{ id: "c1", immat: "111-A-1" }]; N.S.chauffeurs = [{ id: "h1", nom: "Y" }]; N.S.clients = [{ id: "k1", nom: "Souss", contact: "Karim", langueNotif: "en", delai: 45, tarifAttente: 35 }]; N.S.voyages = []; N.S.commandes = []; N.S.entreprise = { nom: "Atlas Fret" }; };
const cmdDevis = (plus = {}) => ({ id: "o9", ref: "CMD-9", clientId: "k1", origine: "Agadir", paysOrigine: "Maroc", destination: "Perpignan", paysDest: "France", dateChargement: "2026-11-19", devise: "EUR", camionId: "c1", statut: "devis", palettes: 26, tempMin: 2, tempMax: 6, jalons: [], ...plus });
test("devis : coût de l'aller-retour estimé (km par le détroit, gasoil, traversées) avec ce qui manque, puis tiré de vos voyages passés", () => {
  etatDevis(); const c = cmdDevis();
  const k = N.kmEstimes(c); assert.ok(k.traverse); assert.ok(k.km > 1900 && k.km < 2500, `${k.km} km Agadir → Perpignan par le détroit`);
  let e = N.coutAllerRetour(c, "2026-11-16"); assert.strictEqual(e.source, "estimation"); assert.ok(e.manques.some((m) => /fret du détroit/.test(m)) && e.manques.some((m) => /péages/.test(m)) && e.manques.some((m) => /gasoil estimé/.test(m)));
  assert.ok(e.mad >= ((2 * k.km * 30) / 100) * 12, "le gasoil est compté");
  N.S.params.fretDetroitEur = 700; assert.ok(!N.coutAllerRetour(c, "2026-11-16").manques.some((m) => /fret du détroit/.test(m)), "fret du détroit réglé"); assert.ok(N.coutAllerRetour(c, "2026-11-16").mad > e.mad + 2 * 700 * 10 - 1);
  N.S.voyages = [1, 2, 3].map((i) => ({ id: `v${i}`, ref: `V-${i}`, statut: "termine", origine: "Agadir", destination: "Perpignan", dateDepart: `2026-0${i + 6}-10`, camionId: "c1", prix: 3000, devise: "EUR", carburantMad: 18000 + i * 1000, autresMad: 6000, jalons: [], traversees: [] }));
  e = N.coutAllerRetour(c, "2026-11-16"); assert.strictEqual(e.source, "historique"); assert.strictEqual(e.n, 3); assert.strictEqual(e.mad, 26000, "médiane : 18 000 + 2 000 + 6 000");
});
test("devis : prix conseillé = coût ÷ (1 − marge) − retour attendu, plancher, variantes ; chance de retour et prix de retour d'après l'historique", () => {
  etatDevis(); N.S.voyages = [1, 2, 3, 4].map((i) => ({ id: `v${i}`, ref: `V-${i}`, statut: "termine", origine: "Agadir", destination: i === 4 ? "Le Boulou" : "Perpignan", dateDepart: `2026-0${i + 5}-10`, camionId: "c1", prix: 3000, devise: "EUR", carburantMad: 20000, autresMad: 6000, jalons: [], traversees: [], ...(i <= 3 ? { commandeRetourId: `r${i}` } : {}) }));
  N.S.commandes = [1, 2, 3].map((i) => ({ id: `r${i}`, ref: `R-${i}`, origine: "Perpignan", paysOrigine: "France", destination: "Casablanca", paysDest: "Maroc", prix: 1000 + i * 200, devise: "EUR", statut: "livre", jalons: [] }));
  const r = N.chanceRetour(cmdDevis(), "2026-11-16"); assert.strictEqual(r.n, 4); assert.strictEqual(r.proba, 0.75); assert.strictEqual(r.prixRetourEur, 1400); assert.ok(!r.defaut);
  const p = N.prixConseille(cmdDevis(), { aujourdhui: "2026-11-16" });
  assert.strictEqual(p.cout.source, "historique"); assert.strictEqual(p.cout.montant, 2600, "26 000 MAD à 10 MAD/€");
  assert.strictEqual(p.retour.attendu, 1050); assert.strictEqual(p.conseille, Math.round((2600 / 0.85 - 1050) / 10) * 10); assert.strictEqual(p.plancher, 1550); assert.strictEqual(p.sansRetour, Math.round(2600 / 0.85 / 10) * 10);
  assert.deepStrictEqual([...p.variantes.map((x) => x.marge)], [0.1, 0.2]); assert.ok(p.fiable);
  etatDevis(); assert.ok(N.chanceRetour(cmdDevis(), "2026-11-16").defaut, "moins de 3 voyages : 50 % par défaut");
});
test("devis : historique de prix du client et du corridor ; envoyé, expiré, accepté (commande confirmée), perdu (motif) ; taux de devis gagnés ; texte dans la langue du client", () => {
  etatDevis();
  N.S.commandes = [{ id: "a", ref: "A", clientId: "k1", origine: "Agadir", destination: "Perpignan", prix: 3100, devise: "EUR", dateChargement: "2026-09-01", statut: "livre", jalons: [] }, { id: "b", ref: "B", clientId: "k2", origine: "Agadir", destination: "Perpignan", prix: 3300, devise: "EUR", dateChargement: "2026-10-01", statut: "livre", jalons: [] }, { id: "x", ref: "X", clientId: "k1", origine: "Tanger", destination: "Madrid", prix: 1800, devise: "EUR", statut: "livre", jalons: [] }];
  const c = cmdDevis(); N.S.commandes.push(c);
  const h = N.historiquePrix(c); assert.deepStrictEqual([...h.client.map((x) => x.ref)], ["A"]); assert.strictEqual(h.corridor.mediane, 3200); assert.strictEqual(h.corridor.n, 2);
  assert.strictEqual(N.etatDevis(c, "2026-11-16"), "a_chiffrer");
  N.noterDevis(c, { prix: 3250, validiteJours: 7, date: "2026-11-16" }); assert.strictEqual(c.prix, 3250); assert.strictEqual(c.devis.validite, "2026-11-23"); assert.strictEqual(N.etatDevis(c, "2026-11-20"), "envoye"); assert.strictEqual(N.etatDevis(c, "2026-11-24"), "expire");
  const t = N.texteDevis(c); assert.strictEqual(t.langue, "en"); assert.ok(/^Hello Karim,/.test(t.texte)); assert.ok(/3[\s\u202f\u00a0]?250 € HT, ferry and tolls included\. Waiting time beyond 2 h per dock: 35 €\/h\./.test(t.texte), t.texte); assert.ok(/valid until 23\/11\/2026/.test(t.texte));
  const d = { ...cmdDevis({ id: "o10", ref: "CMD-10" }) }; N.S.commandes.push(d); N.noterDevis(d, { prix: 3600, date: "2026-11-10" }); N.devisPerdu(d, { motif: "prix", prixConcurrent: 3100 });
  assert.strictEqual(N.etatDevis(d), "perdu");
  N.devisAccepte(c); assert.strictEqual(c.statut, "confirme"); assert.strictEqual(N.etatDevis(c), "gagne");
  const r = N.tauxDevis("2026-11-01", "2026-11-16"); assert.deepStrictEqual([r.envoyes, r.gagnes, r.perdus, r.taux, r.motifs.prix], [2, 1, 1, 50, 1]);
});

const etatRetour = () => { N.S.params = { ...N.S.params, tauxEUR: 11 }; N.S.factures = []; N.S.trajets = []; N.S.interventions = []; N.S.chargesGenerales = []; N.S.entreprise = { nom: "Atlas Fret" };
  N.S.camions = [{ id: "c1", immat: "111-A-1" }]; N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [] }];
  N.S.clients = [{ id: "k1", nom: "Souss Agrumes", pays: "Maroc" },
    { id: "k2", nom: "Roussillon Emballages", pays: "France", ville: "Perpignan", chargeurRetour: true, tel: "+33 6 11 22 33 44", contact: "Marie" },
    { id: "k3", nom: "Frutas Levante", pays: "Espagne", ville: "Murcia", villesRetour: "Murcie", chargeurRetour: true, email: "logistica@levante.es" },
    { id: "k4", nom: "Cartonnerie du Boulou", pays: "France", villesRetour: "Le Boulou", chargeurRetour: false },
    { id: "k5", nom: "Lyon Pièces", pays: "France", ville: "Lyon", chargeurRetour: true }];
  N.S.commandes = [{ id: "o1", ref: "CMD-1", clientId: "k1", origine: "Agadir", paysOrigine: "Maroc", destination: "Perpignan", paysDest: "France", prix: 3000, devise: "EUR", tempMin: 2, tempMax: 6, statut: "transit", jalons: [] },
    { id: "h1", ref: "CMD-0", clientId: "k4", origine: "Le Boulou", paysOrigine: "France", destination: "Casablanca", paysDest: "Maroc", prix: 1350, devise: "EUR", dateChargement: "2026-10-02", statut: "livre", jalons: [] }];
  N.S.voyages = [{ id: "v1", ref: "V-1", statut: "en_cours", clientId: "k1", commandeId: "o1", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-15", livraisonPrevue: "2026-11-18T12:00", camionId: "c1", prix: 3000, devise: "EUR", kmAller: 2300, kmRetourVide: 2300, fraisRouteMad: 9000, autresMad: 30000, jalons: [], traversees: [] }]; };
test("fret de retour : voyage sans retour repéré, livraison et prix plancher, alerte à J-3 puis urgente, éteinte par un retour ou « à vide »", () => {
  etatRetour(); const v = N.S.voyages[0];
  assert.ok(N.chercheRetour(v)); assert.strictEqual(N.livraisonAller(v), "2026-11-18");
  const p = N.plancherRetour(v); assert.ok(p.mad > 0 && !p.couvert); assert.strictEqual(p.eur, Math.round(p.mad / 11));
  assert.strictEqual(N.alertesRetour("2026-11-14").length, 0, "J-4 : rien");
  let a = N.alertesRetour("2026-11-15"); assert.strictEqual(a.length, 1); assert.strictEqual(a[0].niveau, "warn"); assert.ok(/livre dans 3 j à Perpignan, pas encore de retour \(prix plancher/.test(a[0].texte));
  assert.strictEqual(N.alertesRetour("2026-11-17")[0].niveau, "danger");
  v.jalons.push({ type: "livre", date: "2026-11-18T10:00:00Z" }); assert.ok(/livré/.test(N.alertesRetour("2026-11-18")[0].texte));
  v.retourAVide = true; assert.strictEqual(N.alertesRetour("2026-11-18").length, 0, "à vide décidé"); delete v.retourAVide;
  v.commandeRetourId = "x"; assert.ok(!N.chercheRetour(v), "retour chargé"); delete v.commandeRetourId;
  assert.ok(!N.chercheRetour({ ...v, destination: "Casablanca", commandeId: "" }), "un voyage vers le Maroc ne cherche pas de retour");
});
test("fret de retour : chargeurs proches de la livraison (rayon, historique, dernier prix, dernier contact) et message dans leur langue", () => {
  etatRetour(); const v = N.S.voyages[0];
  const l = N.chargeursPour(v); assert.deepStrictEqual([...l.map((x) => x.client.id)], ["k4", "k2"], "Le Boulou (déjà un retour) puis Perpignan, même zone ; Murcie et Lyon trop loin");
  assert.strictEqual(l[0].nb, 1); assert.strictEqual(l[0].dernierPrix, 1350); assert.strictEqual(l[0].ville, "Le Boulou"); assert.ok(l[0].km > 10 && l[0].km < 40);
  const large = N.chargeursPour(v, { rayonKm: 900 }).map((x) => x.client.id); assert.ok(large.includes("k5") && large.includes("k3"), "rayon élargi : Lyon et Murcie apparaissent");
  N.noterContactRetour(N.S.clients[1], v); assert.ok(N.chargeursPour(v).find((x) => x.client.id === "k2").dernierContact.startsWith("20"));
  let m = N.messageDisponibilite(v, N.S.clients[1]); assert.strictEqual(m.langue, "fr"); assert.ok(/^Bonjour Marie,/.test(m.texte)); assert.ok(/camion frigorifique disponible à Perpignan le 18\/11\/2026, retour vers le Maroc \(Tanger Med → Agadir\)/.test(m.texte)); assert.ok(/Atlas Fret$/.test(m.texte));
  m = N.messageDisponibilite(v, N.S.clients[2]); assert.strictEqual(m.langue, "es"); assert.ok(/camión frigorífico disponible en Perpignan/.test(m.texte));
  assert.strictEqual(N.messageDisponibilite(v).langue, "fr", "message de groupe : langue du pays de livraison");
});

const etatQuais = () => { N.S.params = { ...N.S.params, tauxEUR: 11, tvaDefaut: 0, delaiPaiement: 30, franchiseAttenteH: 2, tarifAttente: 0, deviseAttente: "EUR" }; N.S.factures = []; N.S.voyages = []; N.S.trajets = [];
  N.S.clients = [{ id: "k1", nom: "Souss Agrumes", tarifAttente: 35, deviseAttente: "EUR" }, { id: "k2", nom: "Sans tarif" }];
  N.S.commandes = [{ id: "o1", ref: "CMD-1", clientId: "k1", origine: "Agadir", destination: "Perpignan", prix: 3000, devise: "EUR", statut: "confirme", jalons: [] }, { id: "o2", ref: "CMD-2", clientId: "k2", origine: "Perpignan", destination: "Agadir", prix: 1400, devise: "EUR", statut: "confirme", jalons: [] }]; };
test("attente aux quais : arrivée, départ, franchise du client, demi-heure entamée, quai en cours non facturé, sans tarif compté quand même", () => {
  etatQuais(); const [o1, o2] = N.S.commandes, T = (h) => `2026-11-17T${h}:00.000Z`;
  N.arriveeQuai(o1, "chargement", T("08:00")); assert.strictEqual(N.arriveeQuai(o1, "chargement", T("09:00")).arrivee, T("08:00"), "une arrivée notée ne bouge pas");
  let a = N.attenteQuai(o1, "chargement", Date.parse(T("11:00"))); assert.ok(a.enCours); assert.strictEqual(a.minutes, 180); assert.strictEqual(a.heuresFacturees, 0, "en cours : rien de facturable");
  N.departQuai(o1, "chargement", T("12:10")); a = N.attenteQuai(o1, "chargement");
  assert.strictEqual(a.minutes, 250); assert.strictEqual(a.auDelaMin, 130); assert.strictEqual(a.heuresFacturees, 2.5, "2 h 10 au-delà → 2,5 h (demi-heure entamée)"); assert.strictEqual(a.montant, 87.5); assert.strictEqual(a.devise, "EUR");
  assert.throws(() => N.departQuai(o1, "chargement", T("07:00")), /avant l'arrivée/);
  N.arriveeQuai(o2, "livraison", T("08:00")); N.departQuai(o2, "livraison", T("13:00")); a = N.attenteQuai(o2, "livraison"); assert.strictEqual(a.auDelaMin, 180); assert.strictEqual(a.montant, 0, "sans tarif : 0");
  const s = N.syntheseAttentes(); assert.strictEqual(s.auDelaMin, 310); assert.strictEqual(s.sansTarifMin, 180); assert.strictEqual(s.facturableMad, 87.5 * 11);
  N.S.clients[1].franchiseAttenteH = 6; assert.strictEqual(N.attenteQuai(o2, "livraison").auDelaMin, 0, "franchise du client");
});
test("attente aux quais : « Chargée » / « Livrée » ferment le quai ; lignes ajoutées à la facture (commande ou voyage), converties, jamais deux fois ; le voyage suit le chauffeur", () => {
  etatQuais(); const [o1, o2] = N.S.commandes, T = (h) => `2026-11-17T${h}:00.000Z`;
  N.arriveeQuai(o1, "chargement", T("08:00")); N.appliquerEtape(o1, "charge", new Date(T("11:30"))); assert.strictEqual(o1.quais.chargement.depart, T("11:30"));
  const v = { id: "v1", ref: "V-1", statut: "en_cours", clientId: "k1", commandeId: "o1", commandeRetourId: "o2", prix: 3000, devise: "EUR", jalons: [], traversees: [] }; N.S.voyages.push(v);
  N.arriveeQuai(o1, "livraison", T("06:00")); v.jalons.push({ type: "douane_export", date: T("15:00") }); o1.statut = "confirme"; o1.quais.chargement.depart = undefined; delete o1.quais.chargement.depart;
  N.synchroCommandesVoyage(v); assert.ok(!o1.quais.chargement.depart, "la douane export ne date pas le départ du quai de chargement");
  o1.quais.chargement.depart = T("11:30"); v.jalons.push({ type: "livre", date: T("09:15") }); N.synchroCommandesVoyage(v); assert.strictEqual(o1.quais.livraison.depart, T("09:15"), "« Livré » du voyage ferme le quai de livraison");
  const f = N.creerFactureVoyages([v]); assert.strictEqual(f.lignes.length, 3, "prix + attente au chargement + attente à la livraison");
  assert.ok(/^Attente au chargement — Agadir, 17\/11\/2026 : 3 h 30 sur place, franchise 2 h → 1,5 h × 35 €/.test(f.lignes[1].designation), f.lignes[1].designation); assert.strictEqual(f.lignes[1].montant, 52.5);
  assert.strictEqual(o1.quais.chargement.facture, f.id); assert.strictEqual(N.lignesAttente(o1).length, 0, "jamais deux fois");
  N.S.clients[1].tarifAttente = 300; N.S.clients[1].deviseAttente = "MAD"; N.arriveeQuai(o2, "chargement", T("10:00")); N.departQuai(o2, "chargement", T("13:00"));
  const g = { id: "g", devise: "EUR", lignes: [] }; assert.strictEqual(N.ajouterAttentesFacture(g, [o2]), 1); assert.strictEqual(g.lignes[0].montant, 27.27, "300 MAD convertis en euros, arrondis au centime");
  const o3 = { id: "o3", ref: "CMD-3", clientId: "k1", statut: "transit", jalons: [] }; N.S.commandes.push(o3); const v3 = { id: "v3", ref: "V-3", statut: "en_cours", commandeId: "o3", jalons: [] }; N.S.voyages.push(v3);
  N.appliquerEtape(o3, "livre"); assert.strictEqual(N.jalonDepuisCommande(o3), "livre"); assert.ok(v3.jalons.some((j) => j.type === "livre" && j.source === "chauffeur")); assert.strictEqual(N.jalonDepuisCommande(o3), null, "pas deux fois");
});

const etatDocs = () => { N.S.clients = [{ id: "k1", nom: "Souss Agrumes", contact: "M. Bennani", tel: "+212 661 22 33 44", email: "achats@souss.ma", langueNotif: "es" }]; N.S.entreprise = { nom: "Atlas Fret" };
  N.S.commandes = [{ id: "o1", ref: "CMD-1", clientId: "k1", marchandise: "Clémentines, 26 palettes", origine: "Agadir", paysOrigine: "Maroc", destination: "Perpignan", paysDest: "France", dateChargement: "2026-11-18", statut: "confirme", refClient: "PO-88412" },
    { id: "o2", ref: "CMD-2", clientId: "k1", marchandise: "Emballages vides", origine: "Perpignan", paysOrigine: "France", destination: "Agadir", paysDest: "Maroc", dateChargement: "2026-11-25", statut: "confirme" },
    { id: "o3", ref: "CMD-3", clientId: "k1", marchandise: "Textile", origine: "Tanger", paysOrigine: "Maroc", destination: "Casablanca", paysDest: "Maroc", dateChargement: "2026-11-17", statut: "confirme" }];
  N.S.voyages = []; };
test("documents du client : liste selon le sens et la marchandise (frais à l'export : EACCE, phyto, CHED ; import : export UE), reçus, non requis", () => {
  etatDocs(); const [o1, o2, o3] = N.S.commandes;
  let e = N.etatDocuments(o1); assert.strictEqual(e.sens, "export"); assert.ok(e.frais);
  assert.deepStrictEqual([...e.attendus.map((x) => x.id)], ["facture", "colisage", "eur1", "eacce", "phyto", "ched", "livraison"]);
  assert.deepStrictEqual([...e.bloquantsManquants.map((x) => x.id)], ["facture", "colisage", "eacce", "phyto", "ched"], "EUR.1 et l'adresse ne bloquent pas");
  assert.deepStrictEqual([...N.etatDocuments(o2).attendus.map((x) => x.id)], ["facture", "colisage", "eur1", "export_ue", "livraison"], "retour : déclaration d'export UE");
  assert.deepStrictEqual([...N.etatDocuments(o3).attendus.map((x) => x.id)], ["livraison"], "national : seulement l'adresse");
  assert.ok(N.etatDocuments({ ...o2, marchandise: "", tempMin: 2 }).frais, "une consigne de température suffit à dire « frais »");
  N.noterDocument(o1, "facture", { recu: true, ref: "FA-2026-118" }); N.noterDocument(o1, "ched", { nonRequis: true });
  e = N.etatDocuments(o1); assert.strictEqual(e.total, 6, "non requis : retiré du compte"); assert.strictEqual(e.recus, 1); assert.strictEqual(e.attendus.find((x) => x.id === "facture").ref, "FA-2026-118");
  N.noterDocument(o1, "facture", { recu: false, ref: "" }); assert.ok(!o1.documents.facture, "rien à garder : effacé");
});
test("documents du client : alerte à J-3 (urgente la veille), point à régler sur le voyage tant que la commande n'est pas chargée, message dans la langue du client", () => {
  etatDocs(); const [o1, o2] = N.S.commandes;
  let a = N.alertesDocuments("2026-11-14"); assert.strictEqual(a.length, 0, "J-4 : pas encore");
  a = N.alertesDocuments("2026-11-15"); assert.strictEqual(a.length, 1); assert.strictEqual(a[0].niveau, "warn"); assert.ok(/dans 3 j/.test(a[0].texte));
  assert.strictEqual(N.alertesDocuments("2026-11-17")[0].niveau, "danger");
  for (const id of ["facture", "colisage", "eacce", "phyto", "ched"]) N.noterDocument(o1, id, { recu: true });
  assert.strictEqual(N.alertesDocuments("2026-11-17").length, 0, "bloquants reçus : plus d'alerte");
  delete o1.documents; const v = { id: "v1", ref: "V-1", commandeId: "o1", commandeRetourId: "o2", jalons: [] }; N.S.voyages.push(v);
  let k = N.controlesDocumentsVoyage(v); assert.deepStrictEqual([...k.map((x) => x.niveau)], ["danger", "warn"]); assert.ok(/aller manquants \(CMD-1\)/.test(k[0].texte));
  o1.statut = "charge"; assert.strictEqual(N.controlesDocumentsVoyage(v).length, 1, "chargée : la question est réglée");
  const d = N.demandeDocuments(o2); assert.strictEqual(d.langue, "es"); assert.ok(/^Buenos días M\. Bennani/.test(d.texte)); assert.ok(/- Declaración de exportación UE \(MRN\)/.test(d.texte)); assert.ok(/Atlas Fret$/.test(d.texte));
  N.S.clients[0].langueNotif = "ar"; assert.strictEqual(N.demandeDocuments(o2).langue, "fr", "langue sans modèle : français");
});

const etatLecture = () => { N.S.clients = [{ id: "k1", nom: "Primeurs du Souss", email: "achats@primeurs-souss.ma", tel: "+212 661 22 33 44" }, { id: "k2", nom: "Roussillon Emballages", email: "logistique@roussillon-emb.fr" }]; N.S.commandes = []; N.S.entreprise = { email: "contact@atlas-fret.ma" }; };
const lire = (m) => N.lireDemande(m, { aujourdhui: "2026-11-16" }); // lundi 16/11/2026
test("lecture d'un message : e-mail en français — villes, jours de la semaine, palettes, tonnes, température, référence, client par son e-mail, demande de prix", () => {
  etatLecture();
  const r = lire("De : Karim <achats@primeurs-souss.ma>\nBonjour, 26 palettes de clémentines, chargement jeudi à Agadir, livraison lundi à Perpignan Saint-Charles. Température 2 à 6 °C, 22 tonnes. Réf. PO-88412. Votre meilleur prix ?");
  const c = r.champs;
  assert.deepStrictEqual([c.origine, c.paysOrigine, c.destination, c.paysDest], ["Agadir", "Maroc", "Perpignan", "France"]);
  assert.strictEqual(c.dateChargement, "2026-11-19", "jeudi suivant"); assert.strictEqual(c.dateLivraison, "2026-11-23", "lundi suivant");
  assert.strictEqual(c.palettes, 26); assert.strictEqual(c.poids, 22000); assert.strictEqual(c.tempMin, 2); assert.strictEqual(c.tempMax, 6); assert.strictEqual(c.refClient, "PO-88412");
  assert.strictEqual(c.marchandise, "Clémentines, 26 palettes"); assert.strictEqual(c.clientId, "k1"); assert.strictEqual(r.client.nom, "Karim");
  assert.strictEqual(r.demandePrix, true); assert.deepStrictEqual([...r.manquants], ["prix"]); assert.ok(/chargement jeudi/.test(r.sources.dateChargement), "l'extrait montre d'où vient la date");
});
test("lecture d'un message : anglais, espagnol, WhatsApp — dates écrites, milliers, prix et devise, ºC négatifs, villes en espagnol", () => {
  etatLecture();
  let c = lire("Hello, we need a reefer from Murcia to Casablanca. Loading Nov 20, delivery Nov 24. 33 pallets, 18.500 kg, +4°C. Price 1.650 EUR. Order no 4521-B").champs;
  assert.deepStrictEqual([c.origine, c.destination, c.dateChargement, c.dateLivraison, c.palettes, c.poids, c.tempMin, c.prix, c.devise, c.refClient], ["Murcie", "Casablanca", "2026-11-20", "2026-11-24", 33, 18500, 4, 1650, "EUR", "4521-B"]);
  const r = lire("Buenos días, carga en Almería el 19/11, entrega en Rotterdam el 22/11. 24 palés de pimientos, -1/+2 ºC. ¿Precio?"); c = r.champs;
  assert.deepStrictEqual([c.origine, c.paysDest, c.dateChargement, c.dateLivraison, c.palettes, c.tempMin, c.tempMax, c.marchandise], ["Almería", "Pays-Bas", "2026-11-19", "2026-11-22", 24, -1, 2, "Poivrons, 24 palettes"]); assert.ok(r.demandePrix);
  c = lire("Salam, 18 pal textile Tanger -> Madrid le 21, 9 t, prix 1850€. Merci").champs;
  assert.deepStrictEqual([c.origine, c.destination, c.dateChargement, c.palettes, c.poids, c.prix], ["Tanger", "Madrid", "2026-11-21", 18, 9000, 1850]);
  c = lire("Besoin camion Casa → Lyon demain, 12 palettes pièces auto, 6500 kg, 2 900 € HT. tél 0661223344").champs;
  assert.deepStrictEqual([c.origine, c.dateChargement, c.prix, c.marchandise, c.clientId], ["Casablanca", "2026-11-17", 2900, "Pièces automobiles, 12 palettes", "k1"], "client reconnu par son numéro");
  c = lire("نقل من طنجة إلى مدريد، 6 500 dh").champs; assert.deepStrictEqual([c.origine, c.destination, c.prix, c.devise], ["Tanger", "Madrid", 6500, "MAD"], "villes en arabe, dirhams");
  assert.strictEqual(lire("chargement le 10, Agadir vers Paris").champs.dateChargement, "2026-12-10", "le 10 déjà passé ce mois-ci : mois suivant");
});
test("lecture d'un message : client par son domaine (pas les messageries publiques), notre propre adresse ignorée, doublon signalé, plusieurs montants", () => {
  etatLecture();
  assert.strictEqual(lire("From: Marie <marie.dupont@roussillon-emb.fr>, To: contact@atlas-fret.ma — Perpignan to Agadir").champs.clientId, "k2", "même domaine");
  const r = lire("De : x@gmail.com Agadir → Paris"); assert.strictEqual(r.champs.clientId, undefined, "gmail : pas d'association au domaine"); assert.strictEqual(r.client.email, "x@gmail.com");
  N.S.commandes = [{ id: "o1", ref: "CMD-1", clientId: "k1", origine: "Agadir", destination: "Perpignan", dateChargement: "2026-11-19", statut: "confirme" }];
  assert.strictEqual(lire("achats@primeurs-souss.ma : chargement Agadir le 20/11 pour Perpignan").doublon?.ref, "CMD-1");
  assert.ok(lire("Agadir → Lyon, 1 200 € ou 1 350 € selon délai").alertes.some((a) => /2 montants/.test(a)));
  assert.ok(lire("camion frigo Agadir Perpignan").alertes.some((a) => /température/.test(a)));
});

const etatAR = () => {
  N.S.params = { ...N.S.params, tauxEUR: 11, tvaDefaut: 0, delaiPaiement: 30 }; N.S.factures = []; N.S.trajets = []; N.S.interventions = []; N.S.chargesGenerales = []; N.S.camions = [{ id: "c1", immat: "111-A-1" }]; N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [] }];
  N.S.clients = [{ id: "k1", nom: "Primeurs Souss", delai: 30 }, { id: "k2", nom: "Emballages Roussillon", delai: 45 }];
  N.S.commandes = [
    { id: "o1", ref: "CMD-1", clientId: "k1", marchandise: "Clémentines", origine: "Agadir", paysOrigine: "Maroc", destination: "Perpignan", paysDest: "France", dateChargement: "2026-11-16", dateLivraison: "2026-11-19", prix: 3000, devise: "EUR", chauffeurId: "h1", camionId: "c1", cmr: "MA-1", fraisChauffeur: 2500, statut: "confirme", jalons: [] },
    { id: "o2", ref: "CMD-2", clientId: "k2", marchandise: "Emballages vides", origine: "Perpignan", paysOrigine: "France", destination: "Casablanca", paysDest: "Maroc", dateChargement: "2026-11-20", prix: 1400, devise: "EUR", statut: "devis", jalons: [] },
  ];
  N.S.voyages = [];
};
test("aller-retour : une commande devient un voyage pré-rempli ; le retour est une seconde commande sur le même voyage", () => {
  etatAR(); const [o1, o2] = N.S.commandes;
  const v = { id: "v1", ...N.voyageDepuisCommande(o1), jalons: [], traversees: [] }; N.S.voyages.push(v);
  assert.strictEqual(v.commandeId, "o1"); assert.strictEqual(v.clientId, "k1"); assert.strictEqual(v.prix, 3000); assert.strictEqual(v.devise, "EUR"); assert.strictEqual(v.dateDepart, "2026-11-16"); assert.strictEqual(v.livraisonPrevue, "2026-11-19T12:00"); assert.strictEqual(v.cmr, "MA-1"); assert.strictEqual(v.fraisRouteMad, 2500); assert.strictEqual(v.chauffeurId, "h1"); assert.strictEqual(v.dateRetourPrevue, "2026-11-23", "retour estimé : livraison + 4 j");
  assert.strictEqual(N.voyageDeCommande(o1).sens, "aller");
  const base = N.commandeRetourDepuisVoyage(v); assert.strictEqual(base.origine, "Perpignan"); assert.strictEqual(base.destination, "Agadir"); assert.strictEqual(base.paysOrigine, "France"); assert.strictEqual(base.paysDest, "Maroc"); assert.strictEqual(base.chauffeurId, "h1");
  N.lierRetour(v, o2); assert.strictEqual(v.commandeRetourId, "o2"); assert.strictEqual(o2.statut, "confirme", "devis confirmé en le chargeant"); assert.strictEqual(o2.camionId, "c1");
  assert.deepStrictEqual([...N.commandesLiees()].sort(), ["o1", "o2"]);
  assert.throws(() => N.lierRetour(v, o1), /déjà l'aller/); const o3 = { id: "o3", ref: "CMD-3", statut: "confirme", jalons: [] }; N.S.commandes.push(o3); assert.throws(() => N.lierRetour(v, o3), /déjà un retour/);
  const v2 = { id: "v2", ref: "V-2", statut: "prevu", jalons: [] }; N.S.voyages.push(v2); assert.throws(() => N.lierRetour(v2, o2), /déjà portée par le voyage/);
  assert.strictEqual(N.delierRetour(v).id, "o2"); assert.ok(!v.commandeRetourId);
});
test("aller-retour : recette = aller + retour, rentabilité et compte de résultat chez chaque client (au km chargé), trésorerie, pas de double compte", () => {
  etatAR(); const [o1, o2] = N.S.commandes;
  const v = { id: "v1", ...N.voyageDepuisCommande(o1), kmAller: 2400, kmRetourCharge: 1600, jalons: [], traversees: [] }; delete v.fraisRouteMad; N.S.voyages.push(v); N.lierRetour(v, o2);
  const c = N.coutVoyage(v); assert.strictEqual(c.prixAller, 33000); assert.strictEqual(c.prixRetour, 15400); assert.strictEqual(c.prix, 48400);
  const p = N.partsVoyage(v); assert.strictEqual(p.length, 2); proche(p[1].part, 0.4); assert.strictEqual(p[1].clientId, "k2"); assert.strictEqual(p[1].ca, 15400);
  const r = N.rentabilite({}); const k2 = [...r.clients].find((x) => x.id === "k2"), k1 = [...r.clients].find((x) => x.id === "k1");
  assert.strictEqual(k2.ca, 15400); assert.strictEqual(k1.ca, 33000); assert.strictEqual(r.totaux.ca, 48400, "la commande de retour n'est pas comptée une seconde fois");
  assert.strictEqual([...r.camions].find((x) => x.id === "c1").nb, 1, "un seul voyage pour le camion"); proche(k2.km, 1600, "km du retour chez son client");
  const pnl = N.pnlPeriode(); assert.strictEqual(pnl.lignes.length, 2); assert.ok(pnl.lignes.some((l) => l.client === "k2" && l.revenue === 15400 && /\(retour\)/.test(l.ref)));
  assert.ok(/et retour/.test(N.designationVoyage({ ...v, commandeRetourId: undefined })) && !/et retour/.test(N.designationVoyage(v)), "la facture de l'aller ne facture pas le retour");
});
test("aller-retour : un seul suivi — les étapes du voyage font avancer ses deux commandes ; une commande facturée par son voyage ne l'est pas deux fois", () => {
  etatAR(); const [o1, o2] = N.S.commandes;
  const v = { id: "v1", ...N.voyageDepuisCommande(o1), jalons: [], traversees: [] }; N.S.voyages.push(v); N.lierRetour(v, o2);
  v.jalons.push({ type: "douane_export", date: "2026-11-16T15:00:00.000Z" }, { type: "embarque_aller", date: "2026-11-17T10:00:00.000Z" });
  N.synchroCommandesVoyage(v); assert.strictEqual(o1.statut, "transit"); assert.strictEqual(o1.jalons.find((j) => j.statut === "charge").date, "2026-11-16T15:00:00.000Z", "étape datée comme le voyage"); assert.strictEqual(o2.statut, "confirme");
  v.jalons.push({ type: "livre", date: "2026-11-19T09:00:00.000Z" }, { type: "charge_retour", date: "2026-11-20T08:00:00.000Z" });
  v.chauffeurId = "h2"; N.synchroCommandesVoyage(v); assert.strictEqual(o1.statut, "livre"); assert.strictEqual(o2.statut, "charge"); assert.strictEqual(o2.chauffeurId, "h2", "l'équipe suit le voyage");
  assert.strictEqual(N.synchroCommandesVoyage(v), 0, "rien ne change deux fois"); o1.statut = "livre"; v.jalons.push({ type: "douane_export", date: "2026-11-21T00:00:00.000Z" }); N.synchroCommandesVoyage(v); assert.strictEqual(o1.statut, "livre", "jamais en arrière");
  const f = N.creerFactureVoyages([v]); assert.strictEqual(N.factureDeCommande(o1).id, f.id, "l'aller est facturé par le voyage"); assert.strictEqual(N.factureDeCommande(o2), null, "le retour se facture à son client");
  assert.strictEqual(f.lignes[0].montant, 3000, "facture de l'aller : prix de l'aller seulement");
  N.S.commandes = N.S.commandes.filter((c) => c.id !== "o2"); N.synchroToutesCommandes(); assert.ok(!v.commandeRetourId, "commande supprimée : lien retiré");
});

test("passages : chaque étape a sa signification, ce qui suit (étape suivante, documents, qui agit), d'un port à l'autre", () => {
  etatPorts(); const v = N.S.voyages[0];
  for (const p of Object.values(N.PORTS_PASSAGE)) for (const e of p.etapes) assert.ok(N.SUITES_PASSAGE[e.id]?.apres, `signification de ${e.id}`);
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-12T09:00:00.000Z", ref: "DFDS-778" });
  let ev = N.evenementsPassage(v, Date.parse("2026-11-12T09:30:00.000Z")), f = ev.find((e) => e.type === "fait");
  assert.strictEqual(f.etape, "tme_parc"); assert.ok(/PortNet/.test(f.texte)); assert.strictEqual(f.suite.id, "tme_portnet"); assert.strictEqual(f.suite.acteur, "Transitaire"); assert.ok([...f.suite.docs].includes("DUM export (BADR)"));
  assert.ok(ev.some((e) => e.type === "preparer" && /CHED/.test(e.titre)), "frais : CHED à déposer dès le départ");
  for (const id of ["tme_portnet", "tme_douane", "tme_sanitaire", "tme_scanner", "tme_police", "tme_tmpa"]) N.marquerEtapePort(v, id, { date: "2026-11-12T10:00:00.000Z", ref: "X" });
  N.marquerEtapePort(v, "tme_embarquement", { date: "2026-11-12T12:00:00.000Z" });
  f = N.evenementsPassage(v, Date.parse("2026-11-12T12:10:00.000Z")).find((e) => e.type === "fait" && e.etape === "tme_embarquement");
  assert.strictEqual(f.suite.id, "alg_debarquement", "la suite passe au port suivant"); assert.ok(/^Algeciras — Débarquement$/.test(f.suite.lib));
  assert.ok(N.evenementsPassage(v, Date.parse("2026-11-12T12:10:00.000Z")).some((e) => e.type === "preparer" && /ENS/.test(e.titre)), "ENS à vérifier avant l'arrivée");
  for (const id of ["alg_debarquement", "alg_police", "alg_douane", "alg_pcf"]) N.marquerEtapePort(v, id, { date: "2026-11-12T15:00:00.000Z", ref: id === "alg_pcf" ? "CHEDPP.ES.2026.1" : "" });
  N.marquerEtapePort(v, "alg_sortie", { date: "2026-11-12T16:00:00.000Z" });
  f = N.evenementsPassage(v, Date.parse("2026-11-12T16:10:00.000Z")).find((e) => e.etape === "alg_sortie");
  assert.strictEqual(f.suite.id, ""); assert.ok(/^Route vers/.test(f.suite.lib), "fin du passage aller");
  const parc = N.evenementsPassage(v, Date.parse("2026-11-12T16:10:00.000Z")).find((e) => e.etape === "tme_parc" && e.type === "fait");
  assert.strictEqual(parc.suite.id, "tme_portnet", "une étape passée garde sa vraie suite"); assert.strictEqual(parc.suite.fait, true); assert.strictEqual(parc.suite.date, "2026-11-12T10:00:00.000Z");
  assert.ok(!N.evenementsPassage(v, Date.parse("2026-11-12T16:10:00.000Z")).some((e) => e.type === "preparer" && /CHED/.test(e.titre)), "CHED noté : plus de rappel");
});

test("passages : attente trop longue (repère réglable, puis urgente), inspection au scanner, référence non notée, voyages au port", () => {
  etatPorts(); const v = N.S.voyages[0]; N.S.params = { ...N.S.params };
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-12T09:00:00.000Z" });
  const t = (h) => Date.parse(`2026-11-12T${h}:00.000Z`);
  assert.ok(!N.evenementsPassage(v, t("10:00")).some((e) => e.type === "retard"), "dans le repère (90 min)");
  let r = N.evenementsPassage(v, t("10:40")).find((e) => e.type === "retard"); assert.strictEqual(r.niveau, "warn"); assert.strictEqual(r.etape, "tme_portnet"); assert.ok(/PortNet/.test(r.conseil)); assert.strictEqual(r.id, "v1:tme_portnet:retard:1");
  r = N.evenementsPassage(v, t("12:10")).find((e) => e.type === "retard"); assert.strictEqual(r.niveau, "danger"); assert.strictEqual(r.id, "v1:tme_portnet:retard:2", "nouvelle alerte quand c'est urgent");
  N.S.params.seuilsPassage = { tme_portnet: 240 }; assert.ok(!N.evenementsPassage(v, t("12:10")).some((e) => e.type === "retard"), "repère réglé à 4 h");
  const au = N.voyagesEnPassage(t("12:10")); assert.strictEqual(au.length, 1); assert.strictEqual(au[0].prochaine.e.id, "tme_portnet"); assert.strictEqual(au[0].retard, false);
  delete N.S.params.seuilsPassage;
  N.marquerEtapePort(v, "tme_portnet", { date: "2026-11-12T10:00:00.000Z" }); N.marquerEtapePort(v, "tme_scanner", { date: "2026-11-12T10:30:00.000Z", inspection: true });
  const ev = N.evenementsPassage(v, t("10:35"));
  assert.deepStrictEqual([...N.voyagesEnPassage(t("10:35"))[0].sautees.map((e) => e.id)], ["tme_douane", "tme_sanitaire"], "étapes non notées avant le scanner");
  assert.ok(ev.some((e) => e.type === "inspection" && e.niveau === "warn")); assert.ok(ev.some((e) => e.type === "reference" && /N° DUM/.test(e.titre)), "DUM non notée");
  assert.ok(!ev.some((e) => e.type === "reference" && e.etape === "tme_parc"), "pas de référence exigée au parc");
  assert.ok(N.evenementsPassage(v, t("10:35")).every((e, i, l) => !i || l[i - 1].date >= e.date), "du plus récent au plus ancien");
  assert.strictEqual(N.evenementsPassage({ ...v, statut: "annule" }).length, 0);
  assert.ok(!N.evenementsPassage(v, Date.parse("2026-11-15T10:00:00.000Z")).some((e) => e.type === "retard"), "plus de 48 h : données anciennes, pas d'alerte");
});

test("passages par port : Tanger Med et Algeciras, camions à chaque étape, temps habituels tirés de vos passages (inspections écartées)", () => {
  etatPorts(); const v = N.S.voyages[0], t = (h) => Date.parse(`2026-11-12T${h}:00.000Z`);
  const v0 = JSON.parse(JSON.stringify(v)); v0.id = "v0"; v0.ref = "V-0"; N.S.voyages.push(v0);
  for (const [id, h] of [["tme_parc", "02:00"], ["tme_portnet", "02:30"], ["tme_douane", "03:30"], ["tme_sanitaire", "04:00"], ["tme_scanner", "04:20"], ["tme_police", "04:40"], ["tme_tmpa", "05:00"], ["tme_embarquement", "06:00"]]) N.marquerEtapePort(v0, id, { date: `2026-11-12T${h}:00.000Z` });
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-12T09:00:00.000Z" }); N.marquerEtapePort(v, "tme_portnet", { date: "2026-11-12T09:40:00.000Z" });
  const p = N.vuePort("tmed", { maintenant: t("10:00") });
  assert.strictEqual(p.lib, "Tanger Med"); assert.deepStrictEqual([...p.dedans.map((x) => x.v.id)], ["v1"], "V-0 a embarqué : il est attendu à Algeciras");
  const exp = p.sens.find((s) => s.port === "tmed_export"); assert.strictEqual(exp.mediane, 240, "V-0 : 4 h au port"); assert.strictEqual(exp.etapes.find((x) => x.e.id === "tme_douane").attente.length, 1, "V-1 attend la douane");
  assert.strictEqual(exp.etapes.find((x) => x.e.id === "tme_douane").mediane, 60, "douane : 60 min après PortNet (V-0)"); assert.strictEqual(exp.etapes.find((x) => x.e.id === "tme_portnet").mediane, 35, "PortNet : médiane de 30 min (V-0) et 40 min (V-1)");
  const alg = N.vuePort("alg", { maintenant: t("10:00") }); assert.deepStrictEqual([...alg.dedans.map((x) => [x.v.id, x.enMer])].map(String), ["v0,true"], "en traversée vers Algeciras");
  assert.ok(alg.evenements.some((e) => e.type === "preparer" && /ENS/.test(e.titre)), "l'ENS se range dans Algeciras");
  N.S.voyages[1].scanRouge = { tmed_export: true }; assert.strictEqual(N.vuePort("tmed", { maintenant: t("10:00") }).sens[0].mediane, null, "inspection : écartée des temps habituels");
});

const etatFiche = () => { N.S.params = { ...N.S.params, tauxEUR: 10 }; delete N.S.params.seuilsPassage; N.S.factures = []; N.S.trajets = []; N.S.interventions = []; N.S.chargesGenerales = []; N.S.traces = []; N.S.pleins = []; N.S.autorisations = [];
  N.S.camions = [{ id: "c1", immat: "111-A-1", essieux: 5 }]; N.S.chauffeurs = [{ id: "h1", nom: "Youssef", sejours: [], visa: "2028-12-31", passeport: "2031-01-01", permis: "2030-01-01", carteConducteur: "2030-01-01", visiteMedicale: "2030-01-01" }];
  N.S.clients = [{ id: "k1", nom: "Souss" }, { id: "k2", nom: "Roussillon" }];
  N.S.commandes = [{ id: "o1", ref: "CMD-1", clientId: "k1", marchandise: "Textile", origine: "Agadir", paysOrigine: "Maroc", destination: "Perpignan", paysDest: "France", dateChargement: "2026-11-17", prix: 3000, devise: "EUR", statut: "confirme", jalons: [] }];
  N.S.voyages = [{ id: "v1", ref: "V-1", statut: "prevu", clientId: "k1", commandeId: "o1", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-17", dateRetourPrevue: "2026-11-24", livraisonPrevue: "2026-11-19T10:30", chauffeurId: "h1", camionId: "c1", prix: 3000, devise: "EUR", jalons: [], traversees: [{ sens: "aller", ligne: "tmed-alg", statut: "a_reserver" }, { sens: "retour", ligne: "alg-tmed", statut: "a_reserver" }] }]; };
test("fiche du voyage : la frise dit où en est le camion (prévu, au port depuis…, en mer, livré, retour à trouver, terminé), étapes sautées par le GPS comprises", () => {
  etatFiche(); const v = N.S.voyages[0], T = (h) => Date.parse(`2026-11-17T${h}:00Z`);
  let f = N.friseVoyage(v, T("05:00")); assert.deepStrictEqual([...f.noeuds.map((n) => n.cle)], ["depart", "port_depart", "port_arrivee", "livraison", "retour", "depot"]);
  assert.deepStrictEqual([...f.noeuds.map((n) => n.lib)].slice(1, 3), ["Tanger Med", "Algeciras"]); assert.ok(f.noeuds.every((n) => n.etat === "avenir")); assert.strictEqual(f.courant, -1); assert.strictEqual(f.fraction, 0);
  assert.ok(/^mar\. 17\/11$/.test(f.noeuds[0].sous), f.noeuds[0].sous); assert.strictEqual(f.noeuds[3].sous, "jeu. 10:30", "livraison promise");
  N.poserJalon(v, "depart", "2026-11-17T06:00:00.000Z"); N.marquerEtapePort(v, "tme_parc", { date: "2026-11-17T14:00:00.000Z" });
  f = N.friseVoyage(v, T("15:20")); assert.strictEqual(f.courant, 1); assert.strictEqual(f.noeuds[1].etat, "encours"); assert.strictEqual(f.noeuds[1].sous, "depuis 1 h 20"); assert.strictEqual(f.legende, "Tanger Med · depuis 1 h 20"); assert.strictEqual(f.fraction, 0.2);
  N.poserJalon(v, "embarque_aller", "2026-11-17T19:10:00.000Z"); f = N.friseVoyage(v, T("19:30"));
  assert.strictEqual(f.noeuds[1].sous, "5 h 10", "temps passé au port"); assert.strictEqual(f.noeuds[2].sous, "en mer"); assert.strictEqual(v.traversees[0].statut, "effectuee");
  N.poserJalon(v, "livre", "2026-11-19T09:00:00.000Z"); f = N.friseVoyage(v, Date.parse("2026-11-19T10:00:00Z"));
  assert.deepStrictEqual([...f.noeuds.map((n) => n.etat)], ["fait", "fait", "fait", "fait", "encours", "avenir"], "Algeciras compté fait même si le GPS n'a pas vu la sortie");
  assert.strictEqual(f.noeuds[4].sous, "à trouver"); assert.ok(f.noeuds[4].alerte); v.retourAVide = true; assert.strictEqual(N.friseVoyage(v).noeuds[4].sous, "à vide");
  N.poserJalon(v, "retour", "2026-11-23T18:00:00.000Z"); f = N.friseVoyage(v); assert.ok(f.noeuds.every((n) => n.etat === "fait")); assert.strictEqual(f.fraction, 1); assert.strictEqual(v.statut, "termine");
  assert.strictEqual(N.poserJalon(v, "retour"), false, "pas deux fois"); assert.strictEqual(N.poserJalon(v, "inconnu"), false);
  assert.deepStrictEqual([...N.friseVoyage({ id: "x", statut: "prevu", jalons: [], traversees: [{ sens: "aller", ligne: "tmed-sete" }] }).noeuds.map((n) => n.lib)].slice(1, 3), ["Tanger Med", "Sète"], "ports de la ligne réservée");
});
test("fiche du voyage : la prochaine action suit le voyage — traversée, documents, départ, étape de port, livraison, retour, dépôt, puis facturer, envoyer, relancer, soldé", () => {
  etatFiche(); const v = N.S.voyages[0], o1 = N.S.commandes[0], avant = Date.parse("2026-11-15T09:00:00Z"), a = (m = avant) => N.prochaineAction(v, m);
  assert.strictEqual(N.prochaineAction({ statut: "annule" }), null);
  assert.deepStrictEqual([a().cle, a().act, a().id], ["traversee", "trav", "v1|aller"]);
  v.traversees[0].statut = "reservee"; assert.deepStrictEqual([a().cle, a().act, a().id], ["documents", "docs-voyage", "o1"]); assert.ok(/Facture commerciale, Liste de colisage/.test(a().detail));
  assert.strictEqual(a(Date.parse("2026-11-17T05:00:00Z")).cle, "depart", "le jour du départ, on ne bloque plus sur les documents"); assert.ok(N.pointsAttention(v, Date.parse("2026-11-17T05:00:00Z")).some((p) => p.cle === "documents" && p.act === "docs-voyage"));
  N.noterDocument(o1, "facture", { recu: true }); N.noterDocument(o1, "colisage", { recu: true });
  assert.deepStrictEqual([a().cle, a().act, a().id], ["depart", "jalon", "v1|depart"]);
  v.chauffeurId = ""; assert.strictEqual(a().cle, "equipe"); v.chauffeurId = "h1"; N.S.chauffeurs[0].permis = "2026-11-18"; assert.strictEqual(a().cle, "blocage"); assert.strictEqual(a().act, "fiche-onglet"); N.S.chauffeurs[0].permis = "2030-01-01";
  N.poserJalon(v, "depart", "2026-11-17T06:00:00.000Z"); let x = a(); assert.deepStrictEqual([x.cle, x.act, x.id], ["port:tme_parc", "port-etape", "v1|tme_parc"]); assert.ok(/^Tanger Med — Arrivée au parc/.test(x.titre));
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-17T14:00:00.000Z" }); x = a(); assert.strictEqual(x.cle, "port:tme_portnet"); assert.ok(/À présenter : DUM export/.test(x.detail) && /Habituellement moins de 1 h 30/.test(x.detail), x.detail);
  v.jalons.push({ type: "embarque_aller", date: "2026-11-17T19:00:00.000Z", source: "gps" }); assert.strictEqual(a().cle, "port:alg_debarquement", "le GPS a vu l'embarquement : on ne revient pas sur les étapes non notées");
  for (const id of ["alg_debarquement", "alg_police", "alg_douane", "alg_sortie"]) N.marquerEtapePort(v, id, { date: "2026-11-18T08:00:00.000Z" });
  x = a(); assert.deepStrictEqual([x.cle, x.act, x.id, x.second.act], ["livraison", "jalon", "v1|livre", "preuve"]);
  N.poserJalon(v, "livre", "2026-11-19T09:00:00.000Z"); x = a(); assert.deepStrictEqual([x.cle, x.act, x.second.act], ["retour", "retour-chercher", "retour-avide"]);
  const pts = N.pointsAttention(v, Date.parse("2026-11-19T10:00:00Z")).map((p) => p.cle); assert.ok(pts.includes("traversee_retour") && pts.includes("preuve") && pts.includes("facturer") && !pts.includes("retour"), pts.join());
  N.S.commandes.push({ id: "o2", ref: "CMD-2", clientId: "k2", origine: "Perpignan", paysOrigine: "France", destination: "Agadir", paysDest: "Maroc", prix: 1400, devise: "EUR", statut: "confirme", jalons: [] }); N.lierRetour(v, N.S.commandes[1]);
  x = a(); assert.deepStrictEqual([x.cle, x.act, x.id], ["charge_retour", "jalon", "v1|charge_retour"]); assert.ok(/Roussillon · Perpignan → Agadir/.test(x.detail));
  N.poserJalon(v, "charge_retour", "2026-11-20T08:00:00.000Z"); assert.strictEqual(a().cle, "port:ras_arrivee");
  for (const id of ["ras_arrivee", "ras_douane", "ras_police", "ras_embarquement", "tmi_debarquement", "tmi_police", "tmi_scanner", "tmi_douane", "tmi_mainlevee"]) N.marquerEtapePort(v, id, { date: "2026-11-21T10:00:00.000Z" });
  x = a(); assert.deepStrictEqual([x.cle, x.act, x.id], ["depot", "jalon", "v1|retour"]);
  N.poserJalon(v, "retour", "2026-11-23T18:00:00.000Z"); N.synchroCommandesVoyage(v); x = a(); assert.deepStrictEqual([x.cle, x.act, x.id], ["facturer", "facturer-voyage", "v1"]);
  const f = N.creerFactureVoyages([v]); x = a(); assert.deepStrictEqual([x.cle, x.act, x.id], ["envoyer", "fiche-envoyer-facture", f.id]);
  f.envoi = { date: "2026-11-23T19:00:00Z" }; x = a(); assert.deepStrictEqual([x.cle, x.act], ["facturer_retour", "retour-facturer"]);
  N.S.commandes[1].factureId = "f2"; N.S.factures.push({ id: "f2", numero: "FAC-R", clientId: "k2", commandeIds: ["o2"], date: "2026-11-23", echeance: "2099-01-01", devise: "EUR", tva: 0, statut: "emise", envoi: { date: "x" }, lignes: [{ designation: "Retour", montant: 1400 }] });
  f.echeance = "2099-01-01"; x = a(); assert.deepStrictEqual([x.cle, x.ton, x.act], ["paiement", "attente", "fiche-encaisser"]);
  f.echeance = "2020-01-01"; x = a(); assert.deepStrictEqual([x.cle, x.ton, x.act, x.id], ["relancer", "alerte", "fiche-relancer", f.id]);
  f.statut = "payee"; N.S.factures[1].statut = "payee"; x = a(); assert.deepStrictEqual([x.cle, x.ton, x.bouton], ["solde", "ok", ""]); assert.strictEqual(N.pointsAttention(v).length, 0);
});

// trace simulée : [t (s), lat, lon, vitesse km/h] toutes les minutes ; aux arrêts, le camion bouge de quelques mètres
const traceSimulee = (t0, etapes) => { const pts = []; let t = t0; for (const [lat, lon, min, v] of etapes) for (let i = 0; i < min; i++) { pts.push([t, lat + (v ? i * 0.0006 : (i % 3) * 0.00002), lon, v]); t += 60; } return pts; };
const SCAN = [35.8845, -5.5052], POLICE = [35.8901, -5.4951];
const allerTanger = (t0) => traceSimulee(t0, [[35.70, -5.55, 30, 70], [35.87, -5.51, 10, 15], [SCAN[0], SCAN[1], 15, 0], [35.887, -5.50, 3, 15], [POLICE[0], POLICE[1], 12, 0], [35.893, -5.49, 20, 10], [35.99, -5.47, 60, 30], [36.13, -5.44, 25, 10], [36.30, -5.40, 60, 80]]);
test("étapes de port par le GPS : la position d'un arrêt est apprise quand l'étape est notée pendant cet arrêt ; à 2 passages, l'étape se pose seule, dans l'ordre", () => {
  etatPorts(); N.S.params = { ...N.S.params, zonesEtapes: {} }; const Z = N.ZONES_DEFAUT;
  const voyage = (id, t0) => ({ id, ref: id, chauffeurId: "h1", statut: "en_cours", jalons: [], traversees: [], dateDepart: new Date(t0 * 1000).toISOString().slice(0, 10) });
  const t1 = Date.parse("2026-11-01T06:00:00Z") / 1000, t2 = Date.parse("2026-11-08T06:00:00Z") / 1000, t3 = Date.parse("2026-11-15T06:00:00Z") / 1000;
  for (const [id, t0] of [["V-1", t1], ["V-2", t2]]) {
    const p = allerTanger(t0), an = N.gpsAnalyser(p, Z), v = voyage(id, t0); N.S.voyages.push(v);
    N.marquerEtapePort(v, "tme_scanner", { date: new Date((t0 + 40 * 60 + 8 * 60) * 1000).toISOString() }); // noté au bureau pendant l'arrêt au scanner
    assert.strictEqual(N.apprendreDepuisArrets(v, an, Z, p), 1); assert.ok(v.etapesPort.tme_scanner.appris); assert.strictEqual(N.apprendreDepuisArrets(v, an, Z, p), 0, "pas deux fois");
  }
  const z = N.S.params.zonesEtapes.tme_scanner; assert.strictEqual(z.n, 2); assert.ok(Math.abs(z.lat - SCAN[0]) < 0.0005 && Math.abs(z.lon - SCAN[1]) < 0.0005); assert.ok(z.rayon >= 120 && z.rayon <= 450);
  assert.ok(N.zoneEtapePrete("tme_scanner")); assert.ok(!N.zoneEtapePrete("tme_police"), "jamais noté : rien d'appris");
  const p3 = allerTanger(t3), an3 = N.gpsAnalyser(p3, Z), v3 = voyage("V-3", t3); N.S.voyages.push(v3);
  const prop = N.etapesDepuisGps(v3, an3, Z, p3); assert.deepStrictEqual([...prop.map((x) => x.etape)], ["tme_scanner"]);
  assert.strictEqual(prop[0].date, new Date((t3 + 40 * 60 + 14 * 60) * 1000).toISOString(), "posée au départ de l'arrêt");
  assert.strictEqual(N.appliquerPortsGps(v3, an3, Z, p3), 1); const s = N.etatEtapePort(v3, N.etapePort("tme_scanner")); assert.strictEqual(s.source, "gps"); assert.ok(/arrêt de 1\d min à l'emplacement appris \(2 passages\)/.test(s.note), s.note);
  assert.strictEqual(N.appliquerPortsGps(v3, an3, Z, p3), 0, "déjà posée");
  N.annulerEtapePort(v3, "tme_scanner"); assert.strictEqual(N.appliquerPortsGps(v3, an3, Z, p3), 0, "annulée à la main : le GPS ne la repose plus");
  assert.deepStrictEqual([...N.arretsFinsAuPort(p3, Z).map((a) => a.dureeMin)], [14, 11], "arrêts de 5 min et plus dans le port : scanner et police (le camion qui roule au pas n'est pas arrêté)");
  N.oublierZoneEtape("tme_scanner"); assert.ok(!N.zoneEtapePrete("tme_scanner"));
  const app = N.apprentissagePorts(); assert.ok(app.find((x) => x.port === "tmed_export").etapes.some((e) => e.id === "tme_scanner")); assert.ok(!app.flatMap((x) => x.etapes).some((e) => e.id === "tme_parc"), "les étapes déjà vues par le GPS ne sont pas à apprendre");
});
test("étapes de port par le GPS : au retour, arrivée au port d'Algeciras et mainlevée / sortie de Tanger Med d'après les passages dans les zones", () => {
  etatPorts(); N.S.params = { ...N.S.params, zonesEtapes: {} }; const Z = N.ZONES_DEFAUT, t0 = Date.parse("2026-11-20T08:00:00Z") / 1000;
  const p = traceSimulee(t0, [[36.40, -5.40, 30, 80], [36.13, -5.44, 90, 5], [36.03, -5.47, 50, 30], [35.889, -5.50, 70, 5], [35.70, -5.55, 40, 70]]);
  const an = N.gpsAnalyser(p, Z); assert.ok(an.traversees.some((x) => x.sens === "retour"), "traversée retour vue");
  const v = { id: "R", ref: "R", statut: "en_cours", jalons: [], traversees: [] }; N.S.voyages = [v];
  const prop = N.etapesDepuisGps(v, an, Z, p); const e = Object.fromEntries(prop.map((x) => [x.etape, x.date]));
  assert.ok(e.ras_arrivee && Math.abs(Date.parse(e.ras_arrivee) / 1000 - (t0 + 30 * 60 + 60 * 0)) < 30 * 60, "entrée dans le port d'Algeciras");
  assert.ok(e.tmi_mainlevee && Date.parse(e.tmi_mainlevee) > Date.parse(e.ras_arrivee), "sortie de Tanger Med après le débarquement");
  N.appliquerPortsGps(v, an, Z, p); assert.ok(v.jalons.some((j) => j.type === "douane_import"), "la mainlevée pose l'étape du voyage");
});

test("passages : messages selon le routage (fil, transitaire, chauffeur avec ses documents), une seule fois par événement", () => {
  etatPorts(); const v = N.S.voyages[0]; N.S.entreprise = { audiences: { transitaire: { email: "transit@exemple.ma" }, dispatcher_casa: { ntfy: "https://ntfy.sh/atlas-casa-123" } } }; N.S.chauffeurs[0].tel = "+212 600 000 000";
  N.marquerEtapePort(v, "tme_parc", { date: new Date(Date.now() - 3600000).toISOString() });
  const ev = N.evenementsPassage(v).find((e) => e.type === "fait");
  let m = N.messagesEvenement(ev); assert.deepStrictEqual([...m.messages.map((x) => x.audience)], ["in_app"], "étape ordinaire : fil seulement par défaut");
  m = N.messagesEvenement(ev, { routage: { etape: ["in_app", "transitaire"], chauffeur: ["chauffeur"] } });
  assert.deepStrictEqual([...m.messages.map((x) => [x.audience, x.canal])].map((x) => x.join(":")), ["in_app:in_app", "transitaire:email", "chauffeur:whatsapp"]);
  const ch = m.messages.find((x) => x.audience === "chauffeur"); assert.ok(/étape suivante : Tanger Med — Pré-enregistrement PortNet/.test(ch.texte)); assert.ok(/DUM export/.test(ch.texte), "documents à présenter");
  assert.ok(/Ensuite : Tanger Med — Pré-enregistrement PortNet \(Transitaire\)/.test(m.messages[0].texte));
  const avant = N.passagesANotifier().length; assert.ok(avant >= 1);
  v.notifsPassage = N.passagesANotifier().map((x) => x.ev.id); assert.strictEqual(N.passagesANotifier().length, 0, "déjà notifiés");
  const alerte = { ...ev, id: "x", categorie: "alerte", type: "retard" }; assert.deepStrictEqual([...N.messagesEvenement(alerte).messages.map((x) => x.audience)], ["in_app", "dispatcher_casa", "transitaire"], "alertes : exploitation et transitaire par défaut");
});

test("ports : une étape faite pose l'étape du voyage, la traversée, le scanner, la sortie du port et le séjour Schengen ; annulation propre", () => {
  etatPorts(); const v = N.S.voyages[0], h = N.S.chauffeurs[0];
  let fx = N.marquerEtapePort(v, "tme_parc", { date: "2026-11-12T09:00:00.000Z", ref: "DFDS-778" }); assert.ok(v.jalons.some((j) => j.type === "port_tmed" && j.source === "port")); assert.ok(fx[0].includes("Entrée port Tanger Med"));
  N.marquerEtapePort(v, "tme_douane", { date: "2026-11-12T10:00:00.000Z", ref: "TIR XK 1234" });
  N.marquerEtapePort(v, "tme_scanner", { date: "2026-11-12T10:40:00.000Z", inspection: true }); assert.strictEqual(v.scanRouge.tmed_export, true);
  let r = N.resumePort(v, "tmed_export", Date.parse("2026-11-12T11:00:00.000Z")); assert.strictEqual(r.faites, 3); assert.strictEqual(r.enCours, true); assert.strictEqual(r.dureeMs, 2 * 3600000); assert.strictEqual(r.prochaine.id, "tme_portnet");
  for (const id of ["tme_portnet", "tme_sanitaire", "tme_police", "tme_tmpa"]) N.marquerEtapePort(v, id, { date: "2026-11-12T11:00:00.000Z" });
  fx = N.marquerEtapePort(v, "tme_embarquement", { date: "2026-11-12T12:15:00.000Z", ref: "Ciudad de Tanger" });
  assert.ok(v.jalons.some((j) => j.type === "embarque_aller")); assert.strictEqual(v.traversees[0].statut, "effectuee"); assert.strictEqual(v.traversees[0].date, "2026-11-12"); assert.ok(fx.includes("traversée effectuée"));
  r = N.resumePort(v, "tmed_export"); assert.strictEqual(r.fini, true); assert.strictEqual(r.dureeMs, 3.25 * 3600000);
  assert.strictEqual(N.attentesVoyage(v).find((a) => a.portId === "tmed_export").dureeMs, 3.25 * 3600000, "l'attente mesurée au port vient des étapes"); assert.strictEqual(N.attentesVoyage(v)[0].scanRouge, true);
  // Algeciras : débarquement (étape du voyage), police (séjour Schengen ouvert), sortie (attente d'Algeciras mesurée)
  N.marquerEtapePort(v, "alg_debarquement", { date: "2026-11-12T14:00:00.000Z" }); fx = N.marquerEtapePort(v, "alg_police", { date: "2026-11-12T14:20:00.000Z" });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.sejours)), [{ entree: "2026-11-12", voyageId: "v1" }]); assert.ok(fx.some((x) => /séjour Schengen de Youssef ouvert/.test(x)));
  N.marquerEtapePort(v, "alg_sortie", { date: "2026-11-12T19:30:00.000Z" }); assert.strictEqual(v.sortiesPort.alg_entry, "2026-11-12T19:30:00.000Z"); assert.strictEqual(N.attentesVoyage(v).find((a) => a.portId === "alg_entry").dureeMs, 5.5 * 3600000);
  // retour : police d'Algeciras ferme le séjour
  N.marquerEtapePort(v, "ras_police", { date: "2026-11-20T08:00:00.000Z" }); assert.strictEqual(h.sejours[0].sortie, "2026-11-20");
  // annuler : les effets posés par l'étape disparaissent, pas ceux qui venaient d'ailleurs
  assert.strictEqual(N.annulerEtapePort(v, "ras_police"), true); assert.ok(!("sortie" in h.sejours[0]));
  assert.strictEqual(N.annulerEtapePort(v, "alg_police"), true); assert.strictEqual(h.sejours.length, 0);
  assert.strictEqual(N.annulerEtapePort(v, "tme_scanner"), true); assert.ok(!v.scanRouge.tmed_export);
  assert.strictEqual(N.annulerEtapePort(v, "tme_parc"), true); assert.ok(!v.jalons.some((j) => j.type === "port_tmed")); assert.ok(v.jalons.some((j) => j.type === "depart"), "le départ (posé ailleurs) reste");
  assert.strictEqual(N.annulerEtapePort(v, "tmi_police"), false); assert.throws(() => N.marquerEtapePort(v, "inconnue"), /inconnue/);
});
test("ports : une étape déjà posée par le GPS compte comme faite ; références notées réunies pour le dossier", () => {
  etatPorts(); const v = N.S.voyages[0]; v.jalons.push({ type: "port_tmed", date: "2026-11-12T09:05:00.000Z", source: "gps" });
  const s = N.etatEtapePort(v, N.etapePort("tme_parc")); assert.strictEqual(s.fait, true); assert.strictEqual(s.source, "gps");
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-12T09:05:00.000Z", ref: "DFDS-1" }); assert.strictEqual(v.jalons.filter((j) => j.type === "port_tmed").length, 1, "pas de doublon");
  N.marquerEtapePort(v, "tme_portnet", { ref: "DUM 301-2026-000123" }); N.marquerEtapePort(v, "tmi_douane", { ref: "DUM import 45" });
  assert.deepStrictEqual([...N.referencesPortuaires(v).map((x) => `${x.lib}=${x.ref}`)], ["N° de réservation=DFDS-1", "N° DUM=DUM 301-2026-000123", "N° DUM import=DUM import 45"]);
});
test("papiers : pourquoi la case est rouge — chaque document, expiré, bientôt, manquant, valable ; les bloquants d'abord", () => {
  N.S.params.alerteJours = 30;
  const ch = { nom: "Karim", permis: "2026-11-20", visa: "2026-11-25", passeport: "2030-01-01", carteConducteur: "2026-12-10" };
  const l = N.etatPapiers("chauffeur", ch, "2026-11-22");
  assert.deepStrictEqual([...l.map((p) => [p.cle, p.statut, p.bloquant])], [["permis", "expire", true], ["carteConducteur", "bientot", true], ["visa", "bientot", false], ["visiteMedicale", "manquant", true], ["passeport", "ok", false]]);
  assert.strictEqual(l[0].texte, "expiré depuis le 20/11/2026 (2 j) — bloque tout voyage"); assert.strictEqual(l[1].texte, "expire le 10/12/2026 (dans 18 j)");
  assert.strictEqual(N.occupation("chauffeur", { id: "x", ...ch }, "2026-11-22").libelle, "Permis expiré", "même règle que la case du planning");
  const cam = N.etatPapiers("camion", { immat: "A", assurance: "2026-11-01", visite: "2027-05-01" }, "2026-11-22");
  assert.strictEqual(cam[0].cle, "assurance"); assert.strictEqual(cam[0].bloquant, true); assert.ok(cam.find((p) => p.cle === "carteVerte").statut === "manquant" && !cam.find((p) => p.cle === "carteVerte").bloquant);
});

/* ---------- prix du jour : taux EUR → MAD, gazole, voyages figés ---------- */
const etatPrix = () => {
  N.S.params.tauxEUR = 10.8; N.S.params.prixGasoil = 11; N.S.params.consoDefaut = 33; delete N.S.params.prixGasoilJour; delete N.S.params.tauxEURInfo;
  N.S.camions = [{ id: "c1", immat: "A" }]; N.S.factures = []; N.S.commandes = [];
  N.S.pleins = [{ id: "p1", camionId: "c1", date: "2026-11-10", litres: 400, prix: 12.1 }, { id: "p2", camionId: "c1", date: "2026-11-05", litres: 300, prix: 11.9 }, { id: "p3", camionId: "c1", date: "2026-10-01", litres: 300, prix: 10.5 }];
  N.S.voyages = [{ id: "v1", ref: "V-1", camionId: "c1", statut: "prevu", origine: "Agadir", destination: "Perpignan", dateDepart: "2026-11-20", dateRetourPrevue: "2026-11-28", prix: 4000, devise: "EUR", kmAller: 2000, kmRetourVide: 2000, lignesCout: [] },
    { id: "v2", ref: "V-2", camionId: "c1", statut: "termine", dateDepart: "2026-10-20", dateRetourPrevue: "2026-10-30", prix: 3000, devise: "EUR", kmAller: 1000, lignesCout: [{ id: "l", type: "carburant", montant: 806, devise: "EUR", litres: 520, pays: "ES", source: "fuel_card_csv", date: "2026-11-08" }] }];
};
const MARCHES = { taux: { eurMad: 10.9124, date: "2026-11-12", source: "Bank Al-Maghrib (cours de référence)", officiel: true }, carburant: { ES: { prix: 1.869, algeciras: 1.877, date: "2026-11-12", source: "Ministère espagnol" }, FR: { prix: 2.149, poidsLourds: 2.149, pyreneesOrientales: 2.109, date: "2026-11-12", source: "prix-carburants.gouv.fr" } } };

test("prix du jour : taux de Bank Al-Maghrib appliqué, gazole marocain d'après vos pleins, Espagne et France officiels", () => {
  etatPrix();
  const r = N.prixGasoilReels("2026-11-13"); assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { MA: { prix: 12, n: 2, dernier: "2026-11-10" }, ES: { prix: 1.55, n: 1, dernier: "2026-11-08" } }, "14 derniers jours seulement ; carte : 806 € pour 520 L");
  const c = N.appliquerPrixDuJour(MARCHES, "2026-11-13");
  assert.strictEqual(N.S.params.tauxEUR, 10.9124); assert.strictEqual(N.S.params.tauxEURInfo.source, "Bank Al-Maghrib (cours de référence)"); assert.strictEqual(N.S.params.tauxEURInfo.officiel, true);
  assert.strictEqual(N.S.params.prixGasoil, 12, "utilisé par les calculs de trajets"); assert.ok(c.some((x) => /taux EUR → MAD/.test(x)) && c.some((x) => /gazole Maroc/.test(x)));
  const j = N.S.params.prixGasoilJour; assert.strictEqual(j.ES.prix, 1.869); assert.strictEqual(j.ES.algeciras, 1.877); assert.strictEqual(j.ES.paye, 1.55, "à côté : ce que vous avez payé"); assert.strictEqual(j.FR.pyreneesOrientales, 2.109); assert.strictEqual(j.MA.source, "vos pleins et cartes carburant");
  N.S.params.tauxEUR = 10.8; N.appliquerPrixDuJour({ ...MARCHES, taux: { ...MARCHES.taux, date: "2026-10-01" } }, "2026-11-13"); assert.strictEqual(N.S.params.tauxEUR, 10.8, "taux de plus de 7 jours : pas appliqué");
  N.appliquerPrixDuJour({ taux: { eurMad: 1000 } }, "2026-11-13"); assert.strictEqual(N.S.params.tauxEUR, 10.8, "valeur absurde refusée");
  N.S.pleins = []; N.S.voyages = []; N.appliquerPrixDuJour(null, "2026-11-13"); assert.strictEqual(N.S.params.prixGasoil, 12, "sans pleins récents : le prix précédent reste");
});

test("accès par service : niveaux par défaut, droits effectifs, « propre » conservé, chef jamais restreint", () => {
  N.appliquerDroitsPersonnalises({});
  assert.strictEqual(N.niveauDroit("dispatcher", "voyages"), "tout_sans_prix"); assert.strictEqual(N.niveauDroit("exploitant", "voyages"), "tout"); assert.strictEqual(N.niveauDroit("commercial", "factures"), "modification"); assert.strictEqual(N.niveauDroit("dispatcher", "factures"), "aucun"); assert.strictEqual(N.niveauDroit("comptable", "clients"), "lecture"); assert.strictEqual(N.niveauDroit("chauffeur", "voyages"), "modif_sans_prix");
  const r = N.appliquerDroitsPersonnalises({ dispatcher: { factures: "lecture", voyages: "aucun" }, chauffeur: { voyages: "lecture_sans_prix" }, chef_entreprise: { factures: "aucun" }, comptable: { reglages: "aucun" }, pirate: { factures: "tout" } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { dispatcher: { factures: "lecture", voyages: "aucun" }, chauffeur: { voyages: "lecture_sans_prix" } });
  const d = N.droitsEffectifs("dispatcher"); assert.deepStrictEqual({ ...d.factures }, { lecture: "tout", finances: true, ecriture: false, suppression: false }); assert.strictEqual(d.voyages, null); assert.strictEqual(d.traces, null); assert.ok(d.camions.ecriture, "autres groupes inchangés");
  assert.strictEqual(N.droitsEffectifs("chauffeur").voyages.lecture, "propre", "un chauffeur ne voit toujours que ses voyages");
  assert.strictEqual(N.droitsEffectifs("chef_entreprise").factures.suppression, true);
  assert.strictEqual(N.droitsSur({ role: "dispatcher" }, "factures").lecture, "tout"); assert.strictEqual(N.groupeDe("pleins"), "flotte");
  N.appliquerDroitsPersonnalises({}); assert.strictEqual(N.droitsSur({ role: "dispatcher" }, "factures"), null);
});

test("taux par voyage : un voyage terminé ou facturé garde le taux de son jour ; les autres suivent le taux du jour", () => {
  etatPrix(); const [v1, v2] = N.S.voyages;
  assert.strictEqual(N.figerTauxVoyages(), 1); assert.strictEqual(v2.tauxEUR, 10.8); assert.ok(!v1.tauxEUR);
  N.S.params.tauxEUR = 11.2; assert.strictEqual(N.coutVoyage(v2).prix, 3000 * 10.8, "voyage terminé : taux figé"); proche(N.coutVoyage(v2).parts.carburant, 806 * 10.8);
  assert.strictEqual(N.coutVoyage(v1).prix, 4000 * 11.2, "voyage prévu : taux du jour");
  v1.clientId = "k"; N.S.clients = [{ id: "k", nom: "K" }]; N.creerFactureVoyages([v1]); assert.strictEqual(N.figerTauxVoyages(), 1); assert.strictEqual(v1.tauxEUR, 11.2, "figé à la facture"); assert.strictEqual(N.figerTauxVoyages(), 0);
});

test("carburant d'un voyage prévu estimé au prix du jour (Maroc d'après vos pleins, Europe officiel), remplacé dès qu'une dépense réelle arrive", () => {
  etatPrix(); const v = N.S.voyages[0];
  assert.strictEqual(N.estimationCarburantJour(v), null, "pas encore de prix du jour");
  N.appliquerPrixDuJour(MARCHES, "2026-11-13"); N.S.pleins = []; // sans pleins pendant le voyage
  const e = N.estimationCarburantJour(v), attendu = Math.round((700 * 0.33) * 12 + (3300 * 0.33) * ((1.877 + 2.149) / 2) * 10.9124);
  assert.strictEqual(e.mad, attendu); assert.ok(/^4.000 km × 33,0 L\/100 · Maroc 12,00 MAD\/L · Europe 2,013 €\/L$/.test(e.detail), e.detail);
  const c = N.carburantVoyage(v); assert.strictEqual(c.mad, attendu); assert.strictEqual(c.source, "prix_jour");
  assert.ok(N.margeVoyage(v).couts_directs.some((l) => /Estimé au prix du jour/.test(l.libelle)));
  v.kmPays = "MA:500"; assert.ok(N.estimationCarburantJour(v).mad !== attendu, "kilomètres au Maroc saisis : pris en compte");
  N.ajouterLigneCout(v, { type: "carburant", montant: 9000, source: "fuel_card_csv" }); assert.strictEqual(N.carburantVoyage(v).mad, 9000); assert.strictEqual(N.carburantVoyage(v).estime, false);
  assert.strictEqual(N.estimationCarburantJour({ ...v, statut: "termine" }), null);
});

/* ---------- boîte des demandes (boite.js) ---------- */
const MAIL_KARIM = { id: "m7-41", messageId: "abc123@primeurs-souss.ma", de: { nom: "Karim Bené", email: "achats@primeurs-souss.ma" }, sujet: "Demande de transport — clémentines", date: "2026-11-16T07:14:00.000Z", texte: "Bonjour,\n26 palettes de clémentines, chargement jeudi à Agadir, livraison lundi à Perpignan. Température 4 °C. Quel est votre prix ?", pieces: [{ nom: "liste colisage.pdf", type: "application/pdf" }], recu: 1000 };
test("boîte des demandes : ajout sans doublon (identifiant, Message-ID, même texte le même jour), tri par date, lecture à la date du message, client reconnu par l'expéditeur", () => {
  etatLecture(); N.S.demandes = [];
  const a = N.ajouterDemandes([MAIL_KARIM, { ...MAIL_KARIM, id: "m7-99" }, { ...MAIL_KARIM, id: "autre", messageId: "" }], "email", Date.parse("2026-11-16T09:00:00Z"));
  assert.strictEqual(a.length, 1, "même Message-ID, puis même texte le même jour : écartés"); assert.strictEqual(N.S.demandes[0].statut, "a_trier"); assert.deepStrictEqual([...N.S.demandes[0].pieces.map((x) => x.nom)], ["liste colisage.pdf"]);
  const d = N.S.demandes[0]; assert.ok(N.texteDemande(d).startsWith("De : Karim Bené <achats@primeurs-souss.ma>\nObjet : Demande de transport — clémentines\n\nBonjour"));
  const r = N.lectureDemande(d); assert.deepStrictEqual([r.champs.clientId, r.champs.origine, r.champs.destination, r.champs.dateChargement, r.champs.palettes, r.champs.tempMin], ["k1", "Agadir", "Perpignan", "2026-11-19", 26, 4], "« jeudi » lu à partir du lundi 16, date du message");
  assert.strictEqual(N.suiteDemande(r), "chiffrer"); assert.strictEqual(N.resumeDemande(r), "Agadir → Perpignan · chargement 19/11/2026 · 26 palettes · 4 °C");
  N.ajouterDemandes([{ de: { email: "x@y.es" }, sujet: "Hola", texte: "Murcia → Casablanca, 1 200 €", date: "2026-11-17T08:00:00Z" }], "email");
  assert.deepStrictEqual([...N.S.demandes.map((x) => x.de.email)], ["x@y.es", "achats@primeurs-souss.ma"], "les plus récentes d'abord");
  assert.strictEqual(N.suiteDemande(N.lectureDemande(N.S.demandes[0])), "commande", "prix donné : commande directe");
  assert.strictEqual(N.ajouterDemandes([{ texte: "  ", sujet: "" }]).length, 0, "message vide ignoré");
});
test("boîte des demandes : pertinence (demande de transport d'abord, lettres d'information à part), tri, alerte de l'accueil, partage WhatsApp", () => {
  etatLecture(); N.S.demandes = [];
  N.ajouterDemandes([MAIL_KARIM, { id: "n1", de: { email: "news@promo.com" }, sujet: "Soldes d'hiver", texte: "-50 % sur tout le magasin", masse: true, date: "2026-11-16T08:00:00Z" }, { id: "n2", de: { email: "ami@gmail.com" }, sujet: "Dîner", texte: "On se voit samedi ?", date: "2026-11-16T08:30:00Z" }], "email");
  const p = (id) => N.pertinenceDemande(N.S.demandes.find((d) => d.id === id));
  assert.ok(p("m7-41") >= 6 && p("n2") < 3 && p("n1") < 0, `${p("m7-41")} ${p("n2")} ${p("n1")}`);
  assert.deepStrictEqual([...N.demandesATrier().map((d) => d.id)].sort(), ["m7-41", "n2"], "les lettres d'information ne sont pas à trier");
  let al = N.alertesDemandes(Date.parse("2026-11-16T10:00:00Z")); assert.strictEqual(al[0].niveau, "warn"); assert.ok(/2 demandes de transport à trier/.test(al[0].texte));
  al = N.alertesDemandes(Date.parse("2026-11-17T10:00:00Z")); assert.strictEqual(al[0].niveau, "danger", "sans réponse depuis plus de 24 h");
  assert.ok(N.classerDemande(N.S.demandes.find((d) => d.id === "m7-41"), "devis", { commandeId: "o9" }, Date.parse("2026-11-16T10:00:00Z")));
  const k = N.S.demandes.find((d) => d.id === "m7-41"); assert.deepStrictEqual([k.statut, k.commandeId, k.traiteLe], ["devis", "o9", "2026-11-16T10:00:00.000Z"]);
  N.classerDemande(k, "a_trier"); assert.ok(!k.commandeId && !k.traiteLe); assert.strictEqual(N.classerDemande(k, "inconnu"), false);
  N.classerDemande(N.S.demandes.find((d) => d.id === "n2"), "ignoree"); N.classerDemande(k, "commande"); assert.strictEqual(N.alertesDemandes().length, 0);
  const w = N.demandeDepuisPartage({ texte: "[16/11/2026, 09:12] Hassan Transit: camion frigo Tanger → Lyon jeudi, 33 palettes" }, Date.parse("2026-11-16T09:15:00Z"));
  assert.strictEqual(w.de.nom, "Hassan Transit"); const [ajoutee] = N.ajouterDemandes([w], "whatsapp"); assert.strictEqual(ajoutee.source, "whatsapp");
  assert.strictEqual(N.ajouterDemandes([w], "whatsapp").length, 0, "le même partage deux fois : une seule demande"); assert.strictEqual(N.demandeDepuisPartage({ titre: "", texte: "", lien: "" }), null);
  assert.strictEqual(N.demandeDepuisPartage({ titre: "Karim", texte: "Agadir Paris", lien: "https://x.y/z" }).texte, "Agadir Paris\nhttps://x.y/z");
});
test("boîte des demandes : au-delà de 500, les plus anciennes déjà triées sont oubliées, jamais celles à trier", () => {
  N.S.demandes = []; const base = Date.parse("2026-01-01T00:00:00Z");
  N.ajouterDemandes(Array.from({ length: 498 }, (_, i) => ({ id: `t${i}`, texte: `message ${i}`, date: new Date(base + i * 3600000).toISOString() })), "email");
  N.S.demandes.forEach((d) => { if (Number(d.id.slice(1)) < 300) d.statut = "ignoree"; });
  N.ajouterDemandes(Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, texte: `nouveau ${i}`, date: new Date(base + (600 + i) * 3600000).toISOString() })), "email");
  assert.strictEqual(N.S.demandes.length, 500); assert.ok(N.S.demandes.some((d) => d.id === "n9") && N.S.demandes.some((d) => d.id === "t300"), "toutes les demandes à trier restent");
  assert.ok(!N.S.demandes.some((d) => d.id === "t0") && N.S.demandes.some((d) => d.id === "t299"), "les 8 plus anciennes triées sont oubliées");
});

/* ---------- liens sans compte (liens.js) ---------- */
test("lien de dépôt : documents attendus dans la langue du client (non requis écartés, reçus marqués), fichiers reçus qui marquent les documents, message", () => {
  etatFiche(); const c = N.S.commandes[0]; N.S.clients[0].langueNotif = "es"; N.S.entreprise = { nom: "Atlas Fret" };
  N.noterDocument(c, "colisage", { nonRequis: true }); N.noterDocument(c, "facture", { recu: "2026-11-14T10:00:00.000Z" });
  const b = N.corpsLienDepot(c, { jours: 21 });
  assert.deepStrictEqual([b.type, b.langue, b.jours, b.entreprise, b.titre], ["depot", "es", 21, "Atlas Fret", "CMD-1 · Agadir → Perpignan"]);
  assert.ok(!b.docs.some((d) => d.id === "colisage"), "document non requis : pas demandé"); assert.deepStrictEqual({ ...b.docs.find((d) => d.id === "facture") }, { id: "facture", lib: "Factura comercial", recu: true });
  const avant = N.etatDocuments(c).recus, nouveaux = N.documentsRecusParLien(c, [{ doc: "eur1", t: Date.parse("2026-11-16T09:00:00Z") }, { doc: "eur1", t: 1 }, { doc: "autre" }, { doc: "facture" }]);
  assert.deepStrictEqual([...nouveaux], ["Certificat d'origine EUR.1 / EUR-MED"], "un seul nouveau document ; « autre » et un déjà reçu ne changent rien"); assert.strictEqual(N.etatDocuments(c).recus, avant + 1);
  assert.strictEqual(c.documents.eur1.recu, "2026-11-16T09:00:00.000Z", "reçu à la date d'envoi par le client");
  const m = N.messageLienDepot(c, "https://relais.example/depot/abc"); assert.ok(m.startsWith("Buenos días") && m.includes("https://relais.example/depot/abc") && m.endsWith("Atlas Fret"));
  assert.strictEqual(N.lienActif({ id: "x", expire: Date.now() / 1000 + 3 * 86400 }), true); assert.strictEqual(N.lienActif({ id: "x", expire: Date.now() / 1000 + 3600 }), false, "moins d'une journée : on en crée un nouveau"); assert.strictEqual(N.lienActif(null), false);
});
test("lien transitaire : étapes des deux sens avec ce qui est fait ; les étapes du transitaire s'appliquent (effets compris) sans écraser une étape notée autrement ; annulation limitée aux siennes", () => {
  etatFiche(); const v = N.S.voyages[0]; v.statut = "en_cours"; v.remorque = "R-44"; N.S.entreprise = { nom: "Atlas Fret" };
  N.marquerEtapePort(v, "tme_parc", { date: "2026-11-17T08:00:00.000Z" });
  const b = N.corpsLienTransit(v); assert.strictEqual(b.titre, "V-1 · 111-A-1 · R-44");
  const ids = b.etapes.map((e) => e.id); assert.ok(ids.includes("tme_douane") && ids.includes("alg_douane") && ids.some((x) => /^alg/.test(x)) && ids.some((x) => /^tmi|tm_import|tme/.test(x)), ids.join());
  assert.deepStrictEqual([b.etapes[0].id, b.etapes[0].fait, b.etapes[0].port], ["tme_parc", true, N.PORTS_PASSAGE.tmed_export.lib]); assert.ok(b.etapes.find((e) => e.id === "tme_douane").docs.length > 0);
  v.lienTransit = { id: "L1", vus: 0 }; N.marquerEtapePort(v, "alg_police", { date: "2026-11-17T15:00:00.000Z", note: "noté à la main" });
  const evs = [{ n: 1, etape: "tme_douane", date: "2026-11-17T09:30:00.000Z", ref: "DUM 309-1", note: "" }, { n: 2, etape: "alg_police", date: "2026-11-17T15:05:00.000Z" }, { n: 3, etape: "alg_sortie", date: "2026-11-17T17:00:00.000Z", note: "sorti sans inspection" }, { n: 4, etape: "inconnue", date: "x" }];
  const f = N.appliquerEvenementsTransit(v, evs);
  assert.deepStrictEqual([...f.map((x) => x.etape)], ["tme_douane", "alg_sortie"], "l'étape notée à la main n'est pas écrasée"); assert.strictEqual(v.lienTransit.vus, 4);
  assert.deepStrictEqual([v.etapesPort.tme_douane.ref, v.etapesPort.tme_douane.par, v.etapesPort.tme_douane.note], ["DUM 309-1", "transitaire", "Noté par le transitaire"]);
  assert.strictEqual(v.etapesPort.alg_sortie.note, "Transitaire : sorti sans inspection"); assert.strictEqual(v.sortiesPort.alg_entry, "2026-11-17T17:00:00.000Z", "effets de l'étape : sortie du port enregistrée");
  assert.strictEqual(v.etapesPort.alg_police.note, "noté à la main");
  assert.strictEqual(N.appliquerEvenementsTransit(v, evs).length, 0, "déjà lus : rien de nouveau");
  const g = N.appliquerEvenementsTransit(v, [{ n: 5, etape: "alg_police", annule: true, date: "x" }, { n: 6, etape: "tme_douane", annule: true, date: "x" }]);
  assert.deepStrictEqual([...g.map((x) => [x.etape, x.annule])], [["tme_douane", true]], "une annulation n'efface que ce que le transitaire avait noté"); assert.ok(!v.etapesPort.tme_douane && v.etapesPort.alg_police);
  assert.ok(N.messageLienTransit(v, "https://r/transit/x").includes("V-1 (camion 111-A-1, remorque R-44)"));
});

/* ---------- itinéraire poids lourd (itineraire.js) ---------- */
test("itinéraire : tronçons routiers (détroit à part, sens import, même rive, ville inconnue, autre ligne), somme, application sans écraser une saisie, plein et devis repris", () => {
  etatFiche(); const v = N.S.voyages[0];
  let t = N.tronconsRoute(v); assert.deepStrictEqual([...t.map((x) => x.lib)], ["Agadir → Tanger Med", "Algeciras → Perpignan"]); assert.deepStrictEqual([...t[0].points[1]], [...N.PORT_TMED]); assert.deepStrictEqual([...t[1].points[0]], [...N.PORT_ALG]);
  t = N.tronconsRoute({ origine: "Perpignan", destination: "Agadir" }); assert.deepStrictEqual([...t.map((x) => x.lib)], ["Perpignan → Algeciras", "Tanger Med → Agadir"]);
  assert.strictEqual(N.tronconsRoute({ origine: "Perpignan", destination: "Lyon" }).length, 1); assert.ok(/Ville inconnue : Trifouilly/.test(N.tronconsRoute({ origine: "Trifouilly", destination: "Lyon" }).erreur));
  assert.ok(/seul le détroit/.test(N.tronconsRoute({ ...v, traversees: [{ sens: "aller", ligne: "tmed-sete" }] }).erreur));
  assert.strictEqual(N.lienGoogleMaps([[30.42, -9.6], [35.889, -5.5]]), "https://www.google.com/maps/dir/?api=1&origin=30.42,-9.6&destination=35.889,-5.5&travelmode=driving");
  const it = N.sommeTroncons(N.tronconsRoute(v), [{ km: 812, heures: 10.2, kmPays: { MA: 812 }, kmPeage: 700, source: "openrouteservice (service public)", calcule: "2026-11-17T10:00:00.000Z" }, { km: 1012, heures: 11.6, kmPays: { ES: 984, FR: 28 }, kmPeage: 900 }]);
  assert.deepStrictEqual([it.km, it.heures, { ...it.kmPays }, it.kmPeage], [1824, 21.8, { MA: 812, ES: 984, FR: 28 }, 1600]); assert.strictEqual(N.texteKmPays(it.kmPays), "ES 984, FR 28");
  let a = N.appliquerItineraire(v, it); assert.deepStrictEqual([a.kmAller, a.kmPays, v.kmAller, v.kmPays], ["rempli", "rempli", 1824, "ES 984, FR 28"]);
  const avant = { kmAller: v.kmAller, kmPays: v.kmPays }; v.kmPays = "ES 1000, FR 30"; N.noterSaisieKm(v, avant); assert.ok(!v.kmPaysAuto && v.kmAllerAuto, "le champ modifié à la main n'est plus automatique");
  a = N.appliquerItineraire(v, { ...it, km: 1830 }); assert.deepStrictEqual([a.kmAller, a.kmPays, v.kmAller, v.kmPays], ["rempli", "garde", 1830, "ES 1000, FR 30"], "une saisie n'est jamais écrasée");
  N.S.commandes[0].paysDest = "France"; const p = N.trajetParPays(v); assert.deepStrictEqual([p.kmMA, p.kmES, p.kmFR, p.source, p.paysDest], [812, 984, 28, "itineraire", "France"], "la consigne de plein suit les km réels");
  const c = { origine: "Agadir", destination: "Perpignan", paysOrigine: "Maroc", paysDest: "France" }; assert.ok(N.kmEstimes(c).km > 1500 && !N.kmEstimes(c).source, "sans itinéraire : estimation");
  c.itineraire = it; assert.deepStrictEqual([N.kmEstimes(c).km, N.kmEstimes(c).source], [1824, "itineraire"]);
});

/* ---------- coupures planifiées (coupures.js) ---------- */
// points GPS simulés : [t, lat, lon, v] toutes les 5 minutes, roulage à 80 km/h ou arrêt
const roulage = (debut, minutes, v = 80, lat0 = 35, pas = 0.005) => Array.from({ length: Math.floor(minutes / 5) + 1 }, (_, i) => [debut + i * 300, lat0 + i * pas, -5, v]);
test("coupures : prochaine pause (4 h 30), fin de journée (9 h, 10 h si possible), arrêt en cours, dépassement, lieu estimé", () => {
  const t0 = Date.parse("2026-11-17T05:00:00") / 1000;
  let pts = roulage(t0, 180), c = N.prochainesCoupures(pts, t0 + 180 * 60, { vitesseKmH: 80 });
  assert.ok(Math.abs(c.serieH - 3) < 0.1, c.serieH); assert.strictEqual(c.pause.dansMin, 90); assert.strictEqual(c.pause.km, 120); assert.strictEqual(c.finJour.dansMin, 360); assert.strictEqual(c.finJour.limiteH, 9); assert.strictEqual(c.enArret, false);
  pts = [...pts, [t0 + 200 * 60, 35.9, -5, 0], [t0 + 210 * 60, 35.9, -5, 0]]; c = N.prochainesCoupures(pts, t0 + 210 * 60, { vitesseKmH: 80 }); assert.ok(c.enArret && c.arretMin >= 20 && c.arretMin < 45, `${c.arretMin}`);
  const apresPause = roulage(t0 + 240 * 60, 60, 80, 35.9); c = N.prochainesCoupures([...pts, [t0 + 239 * 60, 35.9, -5, 0], ...apresPause], t0 + 300 * 60, { vitesseKmH: 80 });
  assert.ok(c.serieH < 1.1, `pause de 45 min passée : la série repart (${c.serieH})`); assert.ok(c.jourH > 3.9, `la journée continue (${c.jourH})`);
  c = N.prochainesCoupures(roulage(t0, 300), t0 + 300 * 60, { vitesseKmH: 80 }); assert.strictEqual(c.pause.depasse, true); assert.strictEqual(c.pause.dansMin, 0);
  const long = [...roulage(t0, 270), ...roulage(t0 + 320 * 60, 270, 80, 36.5), ...roulage(t0 + 640 * 60, 60, 80, 37.9)]; // 9 h 30 de conduite dans la journée
  assert.strictEqual(N.prochainesCoupures(long, t0 + 700 * 60, { etendusSemaine: 0, vitesseKmH: 80 }).finJour.limiteH, 10, "au-delà de 9 h : 10 h possibles");
  assert.strictEqual(N.prochainesCoupures(long, t0 + 700 * 60, { etendusSemaine: 2, vitesseKmH: 80 }).finJour.depasse, true, "déjà deux journées de 10 h cette semaine");
  const p = N.pointEstime([36.14, -5.45], [42.69, 2.89], 120); assert.ok(p[0] > 36.14 && p[0] < 37.2 && p[1] > -5.45, JSON.stringify(p)); assert.deepStrictEqual([...N.pointEstime([36, -5], [36.5, -4.5], 500)], [36.5, -4.5]);
  assert.strictEqual(N.lienAiresPL([36.7, -4.4]), "https://www.google.com/maps/search/aire+poids+lourds/@36.7,-4.4,11z");
});
test("coupures : journal par jour (jamais diminué, 21 jours gardés), compteurs de la semaine et des deux semaines, jours sans données ; aires OpenStreetMap ; message au chauffeur", () => {
  const t = (d, h) => Date.parse(`${d}T${h}:00`) / 1000;
  let j = N.noterConduite({}, roulage(t("2026-11-16", "06:00"), 360), t("2026-11-16", "20:00")); assert.ok(Math.abs(j["2026-11-16"] - 6) < 0.1, JSON.stringify(j));
  j = N.noterConduite({ ...j, "2026-11-16": 7.5, "2026-10-01": 5 }, roulage(t("2026-11-16", "06:00"), 60), t("2026-11-17", "10:00")); assert.strictEqual(j["2026-11-16"], 7.5, "jamais diminué"); assert.ok(!("2026-10-01" in j), "plus de 21 jours : oublié");
  j = { "2026-11-09": 9.5, "2026-11-10": 8, "2026-11-13": 9, "2026-11-16": 10, "2026-11-17": 4 };
  const s = N.compteursSemaine(j, "2026-11-18"); // mercredi
  assert.deepStrictEqual([s.semaineH, s.deuxSemainesH, s.joursEtendus, s.resteSemaineH, s.joursSansDonnees], [14, 40.5, 1, 42, 0]);
  assert.strictEqual(N.compteursSemaine({ "2026-11-16": 9 }, "2026-11-19").joursSansDonnees, 2, "mardi et mercredi sans conduite vue");
  const aires = N.lireAiresPL({ elements: [{ type: "node", lat: 36.2, lon: -5.4, tags: { amenity: "parking", hgv: "designated", name: "Parking PL Los Barrios", fee: "yes", "capacity:hgv": "80", supervised: "yes" } }, { type: "way", center: { lat: 36.6, lon: -5.0 }, tags: { highway: "services", name: "Área de servicio", toilets: "yes", shower: "yes" } }, { type: "node", lat: 36.15, lon: -5.44, tags: { highway: "rest_area" } }, { type: "node", tags: {} }] }, [36.14, -5.45]);
  assert.deepStrictEqual([...aires.map((a) => a.nom)], ["Parking PL Los Barrios", "Área de servicio", "Aire de repos"], "poids lourds d'abord, puis par distance");
  assert.deepStrictEqual([aires[0].places, aires[0].payant, aires[0].gardee, aires[1].douches], [80, true, true, true]); assert.ok(N.requeteAiresPL([36.14, -5.45]).includes('(around:25000,36.14,-5.45)'));
  const m = N.messageCoupure("pause", 30, t("2026-11-17", "15:40"), "fr", "https://maps/x"); assert.ok(/^Pause de 45 min à prévoir dans 30 min \(vers 15:40\)\. Aires poids lourds : https:\/\/maps\/x$/.test(m), m);
  assert.ok(N.messageCoupure("finJour", 20, t("2026-11-17", "18:00"), "ar").includes("نهاية السياقة"));
});

/* ---------- meilleur créneau au port (creneaux.js) ---------- */
const mesurePort = (portId, jour, heure, heures, plus = {}) => ({ id: N.uid(), portId, jourSemaine: jour, heureEntree: heure, dureeMs: heures * 3600000, saison: "haute", avecSPS: false, scanRouge: false, ...plus });
test("créneau au port : grille jour × tranche (scanner écarté), meilleur et pire créneau du jour, repli sur la semaine, rien sans assez de passages", () => {
  N.S.attentesPort = [];
  for (const h of [1.2, 1.5, 1.4]) N.S.attentesPort.push(mesurePort("tmed_export", 2, 7, h)); // mardi 06-09 : rapide
  for (const h of [4, 4.5, 3.8, 5]) N.S.attentesPort.push(mesurePort("tmed_export", 2, 16, h)); // mardi 15-18 : lent
  for (const h of [2.5, 2.2, 2.4]) N.S.attentesPort.push(mesurePort("tmed_export", 2, 11, h));
  N.S.attentesPort.push(mesurePort("tmed_export", 2, 7, 9, { scanRouge: true }), mesurePort("alg_entry", 2, 7, 6, { avecSPS: true }));
  const g = N.grilleAttentes("tmed_export"); assert.strictEqual(g.total, 10); assert.deepStrictEqual([g.grille[2][6].n, g.grille[2][6].scans, g.grille[2][6].p50], [3, 1, 1.4 * 3600000], "le passage au scanner ne compte pas dans la médiane");
  const c = N.meilleurCreneau("tmed_export", 2);
  assert.deepStrictEqual([c.portee, c.meilleur.lib, c.pire.lib, c.gainMs], ["jour", "06:00–09:00", "15:00–18:00", (4.25 - 1.4) * 3600000]);
  assert.strictEqual(N.meilleurCreneau("tmed_export", 4).portee, "semaine", "jeudi sans passages : toute la semaine");
  assert.strictEqual(N.meilleurCreneau("tmed_import", 2), null, "aucun passage : aucun conseil");
  assert.strictEqual(N.meilleurCreneau("alg_entry", 2, { avecSPS: false }), null, "frais et non frais jamais mélangés");
  assert.strictEqual(N.libTranche(21), "21:00–00:00"); assert.strictEqual(N.trancheDe(23), 21); assert.strictEqual(N.trancheDe(-1), 21);
});
test("créneau au port : conseil pour un voyage — prochain port, arrivée estimée au port d'export (départ à 6 h, pauses), écart avec le meilleur créneau", () => {
  etatFiche(); const v = N.S.voyages[0]; N.S.attentesPort = [];
  // départ mardi 17/11 à 6 h d'Agadir : ≈ 12 h 50 de route estimée → 9 h (pause comprise), repos de 11 h, puis le reste : arrivée mercredi vers 6 h 30 (heure du Maroc)
  for (const h of [1.2, 1.5, 1.4]) N.S.attentesPort.push(mesurePort("tmed_export", 3, 13, h));
  for (const h of [4, 4.5, 3.8]) N.S.attentesPort.push(mesurePort("tmed_export", 3, 7, h));
  const a = N.arriveePortEstimee(v), hm = N.heureMaroc(a); assert.ok(hm >= 6 && hm < 9, `arrivée vers ${hm} h`); assert.strictEqual(N.jourMaroc(a), 3, "le lendemain : repos de nuit compté");
  v.itineraire = { troncons: [{ heures: 8.5 }] }; assert.strictEqual(N.jourMaroc(N.arriveePortEstimee(v)), 2, "itinéraire calculé de 8 h 30 : arrivée le jour même"); delete v.itineraire;
  const k = N.conseilCreneau(v); assert.strictEqual(k.port.portId, "tmed_export");
  assert.ok(/le mercredi : arrivée conseillée 12:00–15:00 \(attente habituelle 1 h 24, 3 passages\) ; à éviter 06:00–09:00 \(4 h 00\)\. Arrivée prévue vers 0\d:\d\d : 4 h 00 d'attente habituelle, 2 h 36 de plus qu'au meilleur créneau\./.test(k.conseil), k.conseil);
  N.poserJalon(v, "depart", "2026-11-17T06:00:00.000Z"); N.poserJalon(v, "port_tmed", "2026-11-17T15:00:00.000Z"); N.poserJalon(v, "embarque_aller", "2026-11-17T18:00:00.000Z");
  assert.strictEqual(N.conseilCreneau(v).port.portId, "alg_entry"); assert.ok(/pas encore assez de passages mesurés \(0\)/.test(N.conseilCreneau(v).conseil));
  N.poserJalon(v, "debarque_alg", "2026-11-17T19:30:00.000Z"); assert.strictEqual(N.conseilCreneau(v), null, "après Algeciras, au retour seulement si un chargement est prévu");
  N.poserJalon(v, "charge_retour", "2026-11-20T10:00:00.000Z"); assert.strictEqual(N.conseilCreneau(v).port.portId, "tmed_import");
});

/* ---------- PDF (pdf.js, facture_pdf.js) ---------- */
const lirePdf = (o) => Buffer.from(o).toString("latin1");
test("PDF : structure valide (table des renvois exacte), accents et € en WinAnsi, largeurs, coupure des lignes, signes remplacés, écritures non latines signalées", () => {
  const d = N.creerPdf({ titre: "Essai" }); d.texte(50, 60, "Échéance : 17/11 · 1 200,00 € — « réf. »", { taille: 12, gras: true }); d.texte(500, 80, "Total", { align: "droite" }); d.ligne(50, 90, 545, 90); d.rect(50, 100, 100, 20, { remplir: "#eef2f8", rayon: 4 }); d.nouvellePage(); d.texte(50, 60, "Page 2 (suite) \\ ok");
  const t = lirePdf(d.octets());
  assert.ok(t.startsWith("%PDF-1.4\n") && t.trimEnd().endsWith("%%EOF"));
  const xref = Number(t.match(/startxref\n(\d+)/)[1]); assert.ok(t.slice(xref).startsWith("xref\n"));
  const lignes = t.slice(xref).split("\n"), n = Number(lignes[1].split(" ")[1]);
  for (let i = 1; i < n; i++) { const off = Number(lignes[2 + i].slice(0, 10)); assert.ok(t.slice(off).startsWith(`${i} 0 obj`), `objet ${i} à ${off}`); }
  assert.ok(/\/Count 2/.test(t), "deux pages"); assert.ok(t.includes("(\\311ch\\351ance : 17/11 \\267 1 200,00 \\200 \\227 \\253 r\\351f. \\273) Tj"), "É é · € — « » codés en WinAnsi");
  assert.ok(t.includes("(Page 2 \\(suite\\) \\\\ ok) Tj"), "parenthèses et barre oblique inverse échappées");
  for (const m of t.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.strictEqual(t.slice(m.index + m[0].length).indexOf("\nendstream"), Number(m[1]), "longueur exacte de chaque flux");
  assert.ok(Math.abs(N.largeurTexte("Total", 10) - 22.23) < 0.01, "T 611 + o 556 + t 278 + a 556 + l 222"); assert.ok(N.largeurTexte("é", 10) === N.largeurTexte("e", 10)); assert.ok(N.largeurTexte("Total", 10, true) > N.largeurTexte("Total", 10));
  assert.ok(Math.abs(N.largeurTexte("1 200", 10) - N.largeurTexte("1 200", 10)) < 0.001, "espace fine insécable du format français = espace");
  const c = N.couperTexte("Transport international Agadir → Perpignan, tomates cerises, 26 palettes", 150, 10); assert.ok(c.length >= 2 && c.every((l) => N.largeurTexte(l, 10) <= 150), c.join(" | "));
  assert.deepStrictEqual([...N.couperTexte("abcdefghijklmnopqrstuvwxyz", 40, 10)].join(""), "abcdefghijklmnopqrstuvwxyz", "mot trop long coupé sans perte");
  assert.deepStrictEqual([...N.pertesPdf("Agadir → Perpignan ≈ 2 000 km, 4 °C, « ok »")], [], "→ et ≈ remplacés, rien de perdu"); assert.deepStrictEqual([...N.pertesPdf("الزبون Souss")].length, 6, "l'arabe ne passe pas : signalé");
});
test("facture en PDF : contenu (numéro, client, lignes, totaux, somme en lettres, payée, pied), pages en plus quand les lignes débordent", () => {
  N.S.entreprise = { nom: "Atlas Fret SARL", ville: "Agadir", ice: "001234567000089", rib: "011 780 0000123456789012 34", banque: "Banque Populaire", mentionsFacture: "Pénalités de retard : 1,5 % par mois." };
  N.S.clients = [{ id: "k1", nom: "Primeurs du Souss", ville: "Agadir", pays: "Maroc", ice: "002345678000012" }];
  const f = { id: "f1", numero: "FAC-2026-0112", clientId: "k1", date: "2026-11-17", echeance: "2026-12-17", devise: "EUR", tva: 20, statut: "payee", datePaiement: "2026-11-20", lignes: [{ designation: "Transport Agadir → Perpignan", montant: 3200 }, { designation: "Attente au quai", montant: 87.5 }] };
  let t = lirePdf(N.pdfFacture(f));
  for (const x of ["(FACTURE) Tj", "(N\\260 FAC-2026-0112) Tj", "(Primeurs du Souss) Tj", "(ICE / TVA : 002345678000012) Tj", "(Transport Agadir \\226 Perpignan) Tj", "(3 200,00) Tj", "(Total HT) Tj", "(3 287,50 \\200) Tj", "(TVA 20 %) Tj", "(657,50 \\200) Tj", "(3 945,00 \\200) Tj", "(PAY\\311E LE 20/11/2026) Tj", "RIB 011 780 0000123456789012 34", "(Facture FAC-2026-0112)"]) assert.ok(t.includes(x), x);
  assert.ok(/trois mille neuf cent quarante-cinq euros/.test(t), "somme en lettres"); assert.ok(/\/Count 1/.test(t));
  f.lignes = Array.from({ length: 45 }, (_, i) => ({ designation: `Transport Agadir → Lyon, voyage V-2026-${String(i).padStart(4, "0")}`, montant: 3000 })); f.statut = "emise";
  t = lirePdf(N.pdfFacture(f)); const pages = Number(t.match(/\/Count (\d+)/)[1]); assert.ok(pages >= 2, `${pages} pages`);
  assert.ok(t.includes("(Facture FAC-2026-0112 \\(suite\\)) Tj")); assert.ok(t.includes(`(1/${pages}) Tj`) && t.includes(`(${pages}/${pages}) Tj`), "numéros de page"); assert.ok(!t.includes("PAY\\311E"));
  assert.ok(N.pertesPdf(N.texteFacturePdf(f)).length === 0); N.S.clients[0].nom = "شركة سوس"; assert.ok(N.pertesPdf(N.texteFacturePdf(f)).length > 0, "nom du client en arabe : la version HTML sera jointe");
  // lecture par un vrai lecteur PDF quand il est installé (pdftotext)
  const { spawnSync } = require("child_process"); N.S.clients[0].nom = "Primeurs du Souss";
  const essai = spawnSync("pdftotext", ["-layout", "-", "-"], { input: Buffer.from(N.pdfFacture({ ...f, lignes: f.lignes.slice(0, 2) })) });
  if (!essai.error && essai.status === 0) { const txt = essai.stdout.toString("utf8"); assert.ok(/FAC-2026-0112/.test(txt) && /Échéance : 17\/12\/2026/.test(txt) && /Agadir – Lyon/.test(txt) && /7 200,00 €/.test(txt), txt.slice(0, 400)); }
});

test("preuve de livraison en PDF : livré le / à qui / où, réserves, signature, rappel du CMR, pied ; longue réserve sur deux pages ; écritures non latines signalées", () => {
  N.S.entreprise = { nom: "Atlas Fret SARL", ville: "Agadir", ice: "001234567000089", rc: "12345" };
  N.S.clients = [{ id: "k1", nom: "Roussillon Emballages" }]; N.S.camions = [{ id: "c1", immat: "111-A-1" }]; N.S.chauffeurs = [{ id: "h1", nom: "Youssef El Amrani" }];
  N.S.commandes = [{ id: "o1", ref: "CMD-2026-0087", marchandise: "Tomates cerises" }];
  const v = { id: "v1", ref: "V-2026-0041", clientId: "k1", camionId: "c1", chauffeurId: "h1", commandeId: "o1", origine: "Agadir", destination: "Perpignan", cmrNumero: "MA-778812",
    pod: { date: "2026-11-17T13:32:00.000Z", signataire: "Mme Durand", reserves: "", signature: "data:image/png;base64,xx", lat: 42.67521, lon: 2.86483, precision: 12 } };
  assert.strictEqual(N.pdfPreuve({ ...v, pod: null }), null, "sans preuve, pas de PDF");
  const sig = { octets: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), largeurPx: 600, hauteurPx: 220 };
  let t = lirePdf(N.pdfPreuve(v, { signature: sig }));
  for (const x of ["(PREUVE DE LIVRAISON) Tj", "(Voyage V-2026-0041) Tj", "(SANS R\\311SERVE) Tj", "(Agadir \\226 Perpignan) Tj", "(Roussillon Emballages) Tj", "(Tomates cerises) Tj", "(CMD-2026-0087) Tj", "(MA-778812) Tj",
    "(Re\\347u par) Tj", "(Mme Durand) Tj", "(42.67521, 2.86483 \\(\\261 12 m\\)) Tj", "(Youssef El Amrani) Tj", "(111-A-1) Tj", "(Aucune r\\351serve formul\\351e \\340 la livraison.) Tj", "Conservez le CMR papier sign\\351.) Tj", "(Atlas Fret SARL \\267 ICE 001234567000089 \\267 RC 12345) Tj"])
    assert.ok(t.includes(x), x);
  assert.ok(/LIVR\\311 LE [^)]* \\300 MME DURAND\) Tj/.test(t), "bandeau : livré le … à MME DURAND");
  assert.ok(/\/Subtype \/Image/.test(t) && / Do Q/.test(t) && !t.includes("(Non sign\\351e)"), "signature dessinée"); assert.ok(/\/Count 1/.test(t));
  t = lirePdf(N.pdfPreuve({ ...v, pod: { ...v.pod, signature: "", lat: undefined, reserves: "Deux palettes abîmées\nFilm déchiré" } }));
  assert.ok(t.includes("(AVEC R\\311SERVES) Tj") && t.includes("(Deux palettes ab\\356m\\351es) Tj") && t.includes("(Film d\\351chir\\351) Tj") && t.includes("(Non sign\\351e) Tj") && t.includes("(non disponible) Tj"));
  t = lirePdf(N.pdfPreuve({ ...v, pod: { ...v.pod, reserves: Array.from({ length: 70 }, (_, i) => `Colis ${i + 1} : carton enfoncé, contenu à vérifier par le destinataire.`).join("\n") } }));
  const pages = Number(t.match(/\/Count (\d+)/)[1]); assert.ok(pages >= 2, `${pages} pages`); assert.ok(t.includes("(Preuve de livraison V-2026-0041 \\(suite\\)) Tj") && t.includes(`(${pages}/${pages}) Tj`));
  assert.strictEqual(N.pertesPdf(N.textePreuvePdf(v)).length, 0); assert.ok(N.pertesPdf(N.textePreuvePdf({ ...v, pod: { ...v.pod, signataire: "محمد" } })).length > 0, "nom en arabe : la page web sera jointe en plus");
  const { spawnSync } = require("child_process"), essai = spawnSync("pdftotext", ["-layout", "-", "-"], { input: Buffer.from(N.pdfPreuve(v)) });
  if (!essai.error && essai.status === 0) { const txt = essai.stdout.toString("utf8"); assert.ok(/PREUVE DE LIVRAISON/.test(txt) && /Reçu par/.test(txt) && /Agadir – Perpignan/.test(txt) && /Non signée/.test(txt), txt.slice(0, 500)); }
});

/* ---------- arrivée et départ des quais par le GPS (quais_gps.js) ---------- */
// positions toutes les 5 min : approche, 2 h 40 sur le site (Perpignan, Saint-Charles), puis départ
const SITE_PERP = [42.6750, 2.8650];
const trajetQuai = (t0) => [...Array.from({ length: 6 }, (_, i) => [t0 + i * 300, 42.60 + i * 0.012, 2.80 + i * 0.011, 70]), ...Array.from({ length: 33 }, (_, i) => [t0 + 1800 + i * 300, SITE_PERP[0] + 0.0004, SITE_PERP[1] - 0.0003, 0]), ...Array.from({ length: 4 }, (_, i) => [t0 + 1800 + 33 * 300 + i * 300, 42.69 + i * 0.01, 2.88 + i * 0.01, 60])];
test("quais par le GPS : site (voyage, client appris), passage sur le site, arrivée et départ posés sans écraser une heure notée à la main", () => {
  etatFiche(); const v = N.S.voyages[0], c = N.S.commandes[0], t0 = Date.parse("2026-11-19T07:00:00Z") / 1000;
  assert.strictEqual(N.siteQuai(c, "livraison", v), null, "aucun endroit connu"); assert.deepStrictEqual(N.appliquerQuaiGps(c, "livraison", trajetQuai(t0), { v }).length, 0);
  v.destLat = SITE_PERP[0]; v.destLon = SITE_PERP[1]; assert.strictEqual(N.siteQuai(c, "livraison", v).source, "voyage");
  const p = N.passageSite(trajetQuai(t0), N.siteQuai(c, "livraison", v)); assert.strictEqual(p.arrivee, t0 + 1800); assert.strictEqual(p.depart, t0 + 1800 + 33 * 300, "la première position hors du site, confirmée par la suivante");
  const e = N.appliquerQuaiGps(c, "livraison", trajetQuai(t0), { v }); assert.deepStrictEqual([...e], ["arrivée à la livraison", "départ à la livraison"]);
  assert.deepStrictEqual([c.quais.livraison.arrivee, c.quais.livraison.sourceArrivee, c.quais.livraison.sourceDepart], ["2026-11-19T07:30:00.000Z", "gps", "gps"]);
  assert.strictEqual(N.attenteQuai(c, "livraison").minutes, 165); assert.strictEqual(N.appliquerQuaiGps(c, "livraison", trajetQuai(t0), { v }).length, 0, "déjà fait : rien de plus");
  // arrivée notée à la main : gardée ; le GPS ajoute le départ
  c.quais = { livraison: { arrivee: "2026-11-19T07:20:00.000Z" } };
  assert.deepStrictEqual([...N.appliquerQuaiGps(c, "livraison", trajetQuai(t0), { v })], ["départ à la livraison"]); assert.strictEqual(c.quais.livraison.arrivee, "2026-11-19T07:20:00.000Z"); assert.ok(!c.quais.livraison.sourceArrivee);
});
test("quais par le GPS : site appris pour le client et la ville (moyenne des passages), position d'arrêt récente", () => {
  etatFiche(); const c = N.S.commandes[0], v = N.S.voyages[0], cl = N.S.clients[0];
  const s1 = N.apprendreSiteQuai(c, "chargement", [30.4201, -9.5502]); assert.deepStrictEqual([s1.ville, s1.n], ["Agadir", 1]);
  const s2 = N.apprendreSiteQuai(c, "chargement", [30.4203, -9.5504]); assert.strictEqual(cl.sites.length, 1, "même endroit à moins de 600 m : un seul site"); assert.strictEqual(s2.n, 2); assert.strictEqual(s2.lat, 30.4202);
  N.apprendreSiteQuai(c, "chargement", [30.50, -9.60]); assert.strictEqual(cl.sites.length, 2, "un autre entrepôt du client");
  assert.strictEqual(N.siteQuai(c, "chargement", v).source, "client"); assert.strictEqual(N.siteQuai(c, "chargement", v).lat, 30.4202, "le site le plus fréquenté");
  assert.strictEqual(N.siteQuai({ ...c, origine: "Casablanca" }, "chargement", v), null, "pas pour une autre ville");
  const t = 1800000000; assert.deepStrictEqual([...N.positionArret([[t - 900, 30.42, -9.55, 0], [t - 300, 30.4201, -9.5501, 0], [t - 60, 30.4201, -9.5502, 1]], t)], [30.4201, -9.5502]);
  assert.strictEqual(N.positionArret([[t - 300, 30.40, -9.55, 60], [t - 60, 30.42, -9.55, 65]], t), null, "en roulage"); assert.strictEqual(N.positionArret([[t - 3600, 30.42, -9.55, 0]], t), null, "trop ancien");
});

/* ---------- garde-fou : deux fichiers de la page ne déclarent jamais le même nom global (sinon la page s'arrête au second) ---------- */
test("chargement : aucun nom global déclaré deux fois dans les scripts de index.html", () => {
  const html = fs.readFileSync(path.join(racine, "index.html"), "utf8"), fichiers = [...html.matchAll(/<script src="([^"]+\.js)"/g)].map((m) => m[1]).filter((f) => !f.startsWith("vendor/"));
  assert.ok(fichiers.length > 60, `${fichiers.length} scripts`); const vus = new Map(), doublons = [];
  for (const f of fichiers) for (const l of fs.readFileSync(path.join(racine, f), "utf8").split("\n")) {
    const m = l.match(/^(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/); if (!m) continue;
    if (vus.has(m[1]) && vus.get(m[1]) !== f) doublons.push(`${m[1]} : ${vus.get(m[1])} et ${f}`); else vus.set(m[1], f);
  }
  assert.deepStrictEqual(doublons, []);
});

/** État de charge : 500 voyages, 500 commandes, 380 factures — le volume d'un transporteur sur plusieurs années. */
function etat500() {
  const j = (n) => N.dateISO(Date.now() + n * 864e5), villes = ["Perpignan", "Lyon", "Madrid", "Barcelone", "Paris", "Marseille", "Valence", "Murcie"], e = N.etatVide();
  e.clients = Array.from({ length: 40 }, (_, i) => ({ id: "k" + i, nom: "Client " + i, delai: 30 }));
  e.camions = Array.from({ length: 25 }, (_, i) => ({ id: "c" + i, immat: `${100 + i}-A-1`, km: 300000, essieux: 5 }));
  e.chauffeurs = Array.from({ length: 25 }, (_, i) => ({ id: "h" + i, nom: "Chauffeur " + i, camionId: "c" + i, sejours: [] }));
  for (let i = 0; i < 500; i++) {
    const d = -400 + Math.floor(i * 0.82), st = d < -10 ? "termine" : d < 0 ? "en_cours" : "prevu", cl = "k" + (i % 40);
    e.commandes.push({ id: "o" + i, ref: `CMD-${i}`, clientId: cl, origine: "Agadir", destination: villes[i % 8], dateChargement: j(d), prix: 3000 + (i % 7) * 100, devise: "EUR", statut: "confirme", jalons: [] });
    e.voyages.push({ id: "v" + i, ref: `V-${i}`, statut: st, clientId: cl, commandeId: "o" + i, origine: "Agadir", destination: villes[i % 8], dateDepart: j(d), dateRetourPrevue: j(d + 8), chauffeurId: "h" + (i % 25), camionId: "c" + (i % 25), prix: 3000 + (i % 7) * 100, devise: "EUR", kmAller: 2000, kmRetourVide: 2000, carburantMad: 14000, lignesCout: [{ id: "l" + i, type: "carburant", montant: 9000, devise: "MAD", source: "saisie", date: j(d) }], coches: {}, jalons: [], traversees: [] });
    if (st === "termine" && i % 5) e.factures.push({ id: "f" + i, numero: `FAC-${i}`, clientId: cl, voyageIds: ["v" + i], date: j(d + 4), echeance: j(d + 34), devise: "EUR", tva: 0, statut: "emise", lignes: [{ designation: "Transport", montant: 3000 }] });
  }
  return e;
}

test("budget de rendu, 500 voyages : coût et marge calculés une seule fois par affichage, mêmes résultats qu'à froid, facture de chaque voyage par index, sous le budget", () => {
  N.S = etat500();
  const froid = N.S.voyages.map((v) => N.margeVoyage(v).marge_nette), facturesFroid = N.S.voyages.map((v) => N.factureDuVoyage(v)?.id ?? null);
  const orig = N.coutVoyageCalcul; let appels = 0;
  N.coutVoyageCalcul = (v) => { appels++; return orig(v); };
  try {
    const t = Date.now();
    const r = N.avecMemo(() => { const m = N.S.voyages.map((v) => N.margeVoyage(v).marge_nette); for (const v of N.S.voyages) { N.coutVoyage(v); N.margeVoyage(v.id); } return { m, f: N.S.voyages.map((v) => N.factureDuVoyage(v)?.id ?? null) }; });
    const ms = Date.now() - t;
    assert.deepStrictEqual([...r.m], [...froid]); assert.deepStrictEqual([...r.f], [...facturesFroid]);
    assert.strictEqual(appels, 500, "un calcul de coût par voyage et par affichage");
    assert.ok(ms < 1000, `500 marges en ${ms} ms (budget 1 s)`);
    appels = 0; for (const v of N.S.voyages) { N.coutVoyage(v); N.coutVoyage(v); }
    assert.strictEqual(appels, 1000, "hors affichage, aucune mémoire : l'état peut avoir changé");
  } finally { N.coutVoyageCalcul = orig; }
  assert.strictEqual(N._memoCalcul, null);
});

test("contraste : textes, couleurs d'état et pastilles à 4,5:1 au moins sur chaque fond, thèmes clair et sombre ; texte blanc seulement sur les fonds « pleins »", () => {
  const css = fs.readFileSync(path.join(racine, "style.css"), "utf8");
  const bloc = (re) => { const m = css.match(re); assert.ok(m, String(re)); return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()])); };
  const clair = bloc(/:root \{([^}]*)\}/), sombre = bloc(/:root\[data-theme="dark"\] \{([^}]*)\}/);
  assert.deepStrictEqual(bloc(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/), sombre, "les deux blocs du thème sombre doivent rester identiques");
  const rgba = (c) => { if (c.startsWith("#")) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1); const p = c.match(/rgba?\(([^)]+)\)/)[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const sur = (c, fond) => { const a = rgba(c), f = rgba(fond); return [0, 1, 2].map((i) => a[i] * a[3] + f[i] * (1 - a[3])); };
  const lum = (c) => c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const faibles = [], note = (texte, r) => { if (r < 4.5) faibles.push(`${texte} ${r.toFixed(2)}`); };
  for (const [nom, t] of [["clair", clair], ["sombre", sombre]]) {
    for (const fond of ["surface", "bg", "surface-2"]) {
      for (const k of ["text", "text-2", "muted", "primary", "ok", "warn", "danger", "info"]) note(`${nom} : ${k} sur ${fond}`, ratio(rgba(t[k]), rgba(t[fond])));
      for (const k of ["primary", "ok", "warn", "danger", "info"]) note(`${nom} : ${k} sur ${k}-soft (${fond})`, ratio(rgba(t[k]), sur(t[`${k}-soft`], t[fond])));
    }
    for (const k of ["primary-plein", "danger-plein", "ok-plein"]) note(`${nom} : blanc sur ${k}`, ratio(rgba(t["on-primary"]), rgba(t[k])));
  }
  assert.deepStrictEqual(faibles, []);
  const blancSurTexte = css.split("}").filter((r) => /background:\s*var\(--(primary|danger|ok)\)/.test(r) && /(^|[;{\s])color:\s*(var\(--on-primary\)|#fff\b)/.test(r));
  assert.deepStrictEqual(blancSurTexte.map((r) => r.trim().slice(0, 90)), []);
});

(async () => {
  let ok = 0;
  for (const [nom, fn] of tests) {
    N.S = N.etatVide();
    try { await fn(); ok++; console.log("✓", nom); } catch (e) { console.error("✗", nom, "\n ", e.message); process.exitCode = 1; }
  }
  console.log(`\n${ok}/${tests.length} test(s) réussi(s)`);
})();
