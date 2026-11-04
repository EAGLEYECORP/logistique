// Tests des calculs métier : node tests/noyau.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const racine = path.join(__dirname, "..");
const ctx = vm.createContext({ console });
vm.runInContext(["data.js", "noyau.js"].map((f) => fs.readFileSync(path.join(racine, f), "utf8")).join("\n") +
  "\n;globalThis.__ = { get S() { return S; }, set S(v) { S = v; }, etatVide, consommations, consoMoyenne, etatCamion, etatChauffeur, calculTrajet, alertes, depensesHebdo, num, joursAvant, today, dateISO };", ctx);
const N = ctx.__;

let ok = 0;
const test = (nom, fn) => { N.S = N.etatVide(); try { fn(); ok++; console.log("✓", nom); } catch (e) { console.error("✗", nom, "\n ", e.message); process.exitCode = 1; } };
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

console.log(`\n${ok} test(s) réussi(s)`);
