// Tests du relais de positions : node tests/relais.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { creer, normaliser } = require("../serveur/relais.js");

const tests = [];
const test = (n, f) => tests.push([n, f]);
const maintenant = () => Math.floor(Date.now() / 1000);

test("normaliser : formes variées, unités, bornes", () => {
  const t = maintenant();
  assert.deepStrictEqual(normaliser({ id: "A", lat: "33.5", lng: "-7.6", t, speed: 50 }), { id: "A", t, lat: 33.5, lon: -7.6, v: 50, cap: null });
  assert.strictEqual(normaliser({ id: "A", lat: 33, lon: -7, t: t * 1000, speed: 10 }, { unite: "noeuds" }).v, 18.5);
  assert.strictEqual(normaliser({ deviceId: 5, latitude: 33, longitude: -7, timestamp: new Date(t * 1000).toISOString(), vitesse: 70, course: 90.4 }).cap, 90);
  for (const m of [{ id: "", lat: 1, lon: 1 }, { id: "A", lat: 91, lon: 1 }, { id: "A", lat: 0, lon: 0 }, { id: "A", lat: 1, lon: 1, t: t + 3600 }, { id: "A", lat: 1, lon: 1, t: t - 9 * 86400 }, null, "x"]) assert.strictEqual(normaliser(m), null);
});

async function demarrer(dossier = null) {
  const r = creer({ jetonEcriture: "ecrit", jetonLecture: "lit", dossier });
  await new Promise((ok) => r.serveur.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${r.serveur.address().port}`;
  const appel = async (chemin, { jeton = "", methode = "GET", corps } = {}) => { const res = await fetch(base + chemin, { method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), "content-type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) }); return { code: res.status, json: await res.json().catch(() => null), cors: res.headers.get("access-control-allow-origin") }; };
  return { ...r, base, appel, arreter: () => new Promise((ok) => r.serveur.close(ok)) };
}

test("relais : jetons séparés, réception JSON, lecture, historique", async () => {
  const s = await demarrer(); const t = maintenant();
  try {
    assert.strictEqual((await s.appel("/sante")).json.ok, true);
    assert.strictEqual((await s.appel("/api/positions", { methode: "POST", corps: { id: "A", lat: 33, lon: -7, t } })).code, 401);
    assert.strictEqual((await s.appel("/api/positions", { methode: "POST", jeton: "lit", corps: { id: "A", lat: 33, lon: -7, t } })).code, 401); // le jeton de lecture n'écrit pas
    const r = await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: [{ id: "A", lat: 33, lon: -7, t: t - 120, v: 80 }, { id: "A", lat: 33.1, lon: -7, t: t - 60, v: 82 }, { id: "A", lat: 33.1, lon: -7, t: t - 60 }, { id: "B", lat: 99, lon: 0 }] });
    assert.deepStrictEqual({ ...r.json }, { ok: true, recues: 4, valides: 3, ajoutees: 2 }); // doublon et latitude absurde écartés
    assert.strictEqual((await s.appel("/api/derniere")).code, 401);
    const d = await s.appel("/api/derniere", { jeton: "lit" });
    assert.strictEqual(d.json.length, 1); assert.strictEqual(d.json[0].t, t - 60); assert.strictEqual(d.cors, "*");
    const tr = await s.appel(`/api/trace?id=A&depuis=${t - 100}`, { jeton: "lit" }); assert.strictEqual(tr.json.length, 1);
    assert.strictEqual((await s.appel("/api/trace?id=A", { jeton: "lit" })).json.length, 2);
    assert.strictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.appareils, 1);
    assert.strictEqual((await s.appel("/inconnu")).code, 404);
  } finally { await s.arreter(); }
});

test("relais : protocole OsmAnd (GET) et renvoi Traccar (POST)", async () => {
  const s = await demarrer(); const t = maintenant();
  try {
    const o = await s.appel(`/osmand?token=ecrit&id=PHONE-1&lat=35.9&lon=-5.5&timestamp=${t - 30}&speed=60&bearing=45`);
    assert.strictEqual(o.json.ajoutees, 1);
    const n = await s.appel("/traccar?unite=noeuds", { methode: "POST", jeton: "ecrit", corps: { position: { deviceId: 3, fixTime: new Date((t - 10) * 1000).toISOString(), latitude: 36.1, longitude: -5.4, speed: 10, course: 180 }, device: { uniqueId: "IMEI-9", name: "Volvo FH" } } });
    assert.strictEqual(n.json.ajoutees, 1);
    const d = (await s.appel("/api/derniere", { jeton: "lit" })).json;
    const traccar = d.find((x) => x.id === "IMEI-9"); assert.strictEqual(traccar.v, 18.5); assert.strictEqual(traccar.nom, "Volvo FH");
    assert.strictEqual(d.find((x) => x.id === "PHONE-1").cap, 45);
  } finally { await s.arreter(); }
});

test("relais : persistance sur disque, rechargement, nettoyage des vieux fichiers", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-")); const t = maintenant();
  fs.writeFileSync(path.join(dossier, "positions-2020-01-01.jsonl"), JSON.stringify({ id: "VIEUX", t: 1577836800, lat: 1, lon: 1 }) + "\n");
  let s = await demarrer(dossier);
  try { await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: { id: "A", lat: 33, lon: -7, t: t - 5 } }); } finally { await s.arreter(); }
  assert.ok(!fs.existsSync(path.join(dossier, "positions-2020-01-01.jsonl")));
  s = await demarrer(dossier);
  try { assert.strictEqual((await s.appel("/api/derniere", { jeton: "lit" })).json[0].id, "A"); } finally { await s.arreter(); }
  fs.rmSync(dossier, { recursive: true });
});

test("relais : corps trop gros et JSON invalide refusés", async () => {
  const s = await demarrer();
  try {
    const r = await fetch(s.base + "/api/positions", { method: "POST", headers: { authorization: "Bearer ecrit" }, body: "pas du json" }); assert.strictEqual(r.status, 400);
    assert.throws(() => creer({}), /JETON/);
  } finally { await s.arreter(); }
});

(async () => {
  let ok = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log("✓", n); } catch (e) { console.error("✗", n, "\n ", e.message); process.exitCode = 1; } }
  console.log(`\n${ok}/${tests.length} test(s) du relais réussi(s)`);
})();
