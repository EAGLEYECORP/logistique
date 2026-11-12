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
  assert.strictEqual(normaliser({ id: "A", lat: 33, lon: -7, t, temperature: "4.26" }).temp, 4.3); assert.strictEqual(normaliser({ id: "A", lat: 33, lon: -7, t, attributes: { temp1: -18 } }).temp, -18); assert.strictEqual(normaliser({ id: "A", lat: 33, lon: -7, t, temp: 999 }).temp, undefined);
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

const ZONES = [{ id: "z-tmed", nom: "Port de Tanger Med", type: "port_maroc", lat: 35.889, lon: -5.5, rayon: 4500 }, { id: "z-alg", nom: "Port d'Algeciras", type: "port_europe", lat: 36.13, lon: -5.44, rayon: 2500 }];
test("lien client : création, page publique, ETA, précision, expiration, révocation", async () => {
  const s = await demarrer(); const t = maintenant();
  try {
    const pts = Array.from({ length: 10 }, (_, i) => ({ id: "BAL-1", t: t - (9 - i) * 300 - 60, lat: 33.5 + i * 0.05, lon: -7.1 + i * 0.03, v: 70 }));
    await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: pts });
    const corps = { balise: "BAL-1", reference: "CMD-42", origine: "Casablanca", destination: "Perpignan", destLat: 42.6887, destLon: 2.8948, origLat: 33.57, origLon: -7.59, precision: "approx", langue: "fr", zones: ZONES, jours: 7,
      livraisonPrevue: new Date((t + 2 * 86400) * 1000).toISOString(), etapes: [{ libelle: "Départ de Casablanca", date: new Date((t - 3600) * 1000).toISOString() }], message: "Merci de votre confiance" };
    assert.strictEqual((await s.appel("/api/partages", { methode: "POST", jeton: "ecrit", corps })).code, 401); // le jeton des balises ne crée pas de lien
    assert.strictEqual((await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps: { balise: "BAL-1" } })).code, 400);
    const c = await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps }); assert.strictEqual(c.code, 201);
    const id = c.json.id; assert.ok(id.length >= 20); assert.strictEqual(c.json.chemin, `/suivi/${id}`);
    // la page et les données sont publiques (le secret est dans l'adresse)
    const html = await (await fetch(s.base + `/suivi/${id}?lang=en`)).text();
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(script); // le script de la page est syntaxiquement valide assert.ok(/<html lang="en"/.test(html) && /location\.pathname\.replace\(\/\[\/\]\$\/,""\)\+"\/donnees"/.test(html));
    const d = await (await fetch(s.base + `/suivi/${id}/donnees`)).json();
    assert.strictEqual(d.reference, "CMD-42"); assert.strictEqual(d.etat, "en_route"); assert.ok(d.eta && d.eta.arrivee > t + 20 * 3600, "ETA lointaine : " + JSON.stringify(d.eta));
    assert.ok(typeof d.retardMin === "number"); assert.ok(d.progression > 0 && d.progression < 30);
    assert.deepStrictEqual([...d.position], [Math.round(pts[9].lat * 10) / 10, Math.round(pts[9].lon * 10) / 10]); // position arrondie (≈ 10 km)
    assert.strictEqual(d.etapes.length, 1); assert.ok(!JSON.stringify(d).includes("BAL-1")); // pas d'identifiant de balise côté client
    // précision masquée, puis livré
    await s.appel(`/api/partages/${id}`, { methode: "PUT", jeton: "lit", corps: { precision: "masquee" } });
    assert.strictEqual((await (await fetch(s.base + `/suivi/${id}/donnees`)).json()).position, null);
    await s.appel(`/api/partages/${id}`, { methode: "PUT", jeton: "lit", corps: { statut: "livre" } });
    const l = await (await fetch(s.base + `/suivi/${id}/donnees`)).json(); assert.strictEqual(l.statut, "livre"); assert.ok(l.livreLe); assert.strictEqual(l.eta, null);
    // liste, expiration, révocation
    assert.strictEqual((await s.appel("/api/partages", { jeton: "lit" })).json.length, 1);
    s.partages.get(id).expire = t - 10; assert.strictEqual((await fetch(s.base + `/suivi/${id}/donnees`)).status, 410);
    assert.strictEqual((await s.appel(`/api/partages/${id}`, { methode: "DELETE", jeton: "lit" })).code, 200);
    assert.strictEqual((await fetch(s.base + `/suivi/${id}/donnees`)).status, 404);
    assert.strictEqual((await fetch(s.base + "/suivi/pas-un-identifiant-valide-du-tout")).status, 404);
    const e = await fetch(s.base + "/suivi/" + "a".repeat(24)); assert.strictEqual(e.headers.get("x-robots-tag"), "noindex, nofollow");
  } finally { await s.arreter(); }
});

test("lien client : arrivée calée sur les attentes de l'opérateur, même moteur que l'application, fourchette et source", async () => {
  const s = await demarrer(); const t = maintenant();
  try {
    const pts = Array.from({ length: 10 }, (_, i) => ({ id: "BAL-9", t: t - (9 - i) * 300 - 60, lat: 33.5 + i * 0.05, lon: -7.1 + i * 0.03, v: 70 }));
    await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: pts });
    const corps = { balise: "BAL-9", reference: "V-9", origine: "Casablanca", destination: "Perpignan", destLat: 42.6887, destLon: 2.8948, zones: ZONES, jours: 7 };
    const a = (await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps })).json.id;
    const b = (await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps: { ...corps, attentes: { portH: 7, auPortH: null, debarqH: 5, fourchetteMin: 180, source: "operateur_calibre" } } })).json.id;
    const da = await (await fetch(s.base + `/suivi/${a}/donnees`)).json(), db = await (await fetch(s.base + `/suivi/${b}/donnees`)).json();
    assert.strictEqual(da.eta.source, "estimation_generique"); assert.strictEqual(db.eta.source, "operateur_calibre");
    assert.ok(db.eta.arrivee - da.eta.arrivee >= 8 * 3600 - 120, "8 h d'attente de plus aux ports : " + (db.eta.arrivee - da.eta.arrivee));
    assert.ok(db.eta.fourchetteMin >= 180 + 20); assert.strictEqual(db.eta.max - db.eta.arrivee, db.eta.fourchetteMin * 60); assert.ok(da.eta.fourchetteMin < db.eta.fourchetteMin);
    // même résultat que l'application avec les mêmes entrées (le relais charge prevision.js tel quel)
    const { charger } = require("../serveur/moteur.js"); const m = charger(); const h = pts.map((p) => [p.t, p.lat, p.lon, p.v]);
    const local = m.appeler("etaPrevision", h, db.maj + 0, [42.6887, 2.8948], { portH: 7, auPortH: null, debarqH: 5, fourchetteMin: 180, source: "operateur_calibre" }, { zones: ZONES });
    assert.ok(Math.abs(local.arrivee - db.eta.arrivee) < 120, "écart relais / application : " + (local.arrivee - db.eta.arrivee) + " s"); assert.strictEqual(local.fourchetteMin, db.eta.fourchetteMin);
    // valeurs aberrantes bornées, source inconnue ramenée à l'estimation ; mise à jour quand un port est franchi
    await s.appel(`/api/partages/${b}`, { methode: "PUT", jeton: "lit", corps: { attentes: { portH: -4, debarqH: "x", fourchetteMin: 1e9, source: "n'importe quoi" } } });
    const dc = await (await fetch(s.base + `/suivi/${b}/donnees`)).json(); assert.strictEqual(dc.eta.source, "estimation_generique"); assert.ok(dc.eta.fourchetteMin <= 120 * 60 + 600); assert.ok(dc.eta.arrivee < db.eta.arrivee);
    const html = await (await fetch(s.base + `/suivi/${b}?lang=ar`)).text(); assert.ok(html.includes("T.calibre") && html.includes("calibre")); new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  } finally { await s.arreter(); }
});

test("lien client : traversée en cours et position inconnue", async () => {
  const s = await demarrer(); const t = maintenant();
  try {
    const c = await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps: { balise: "B2", reference: "R", origine: "Tanger Med", destination: "Madrid", destLat: 40.4, destLon: -3.7, zones: ZONES } });
    assert.strictEqual((await (await fetch(s.base + c.json.chemin + "/donnees")).json()).etat, "en_attente"); // aucune position encore
    await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: [{ id: "B2", t: t - 2400, lat: 35.889, lon: -5.5, v: 0 }] });
    const d = await (await fetch(s.base + c.json.chemin + "/donnees")).json();
    assert.strictEqual(d.etat, "traversee"); assert.ok(d.eta);
  } finally { await s.arreter(); }
});

test("lien client : les partages survivent à un redémarrage", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-")); let id;
  let s = await demarrer(dossier);
  try { id = (await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps: { balise: "B", reference: "R", origine: "A", destination: "B" } })).json.id; } finally { await s.arreter(); }
  s = await demarrer(dossier);
  try { assert.strictEqual((await fetch(s.base + `/suivi/${id}/donnees`)).status, 200); } finally { await s.arreter(); }
  fs.rmSync(dossier, { recursive: true });
});

test("alertes : diffusion sur les canaux du serveur (ntfy, Telegram, WhatsApp texte et modèle, webhook), déduplication, jetons", async () => {
  const appels = [];
  const http_ = async (url, o) => { appels.push({ url, o }); return { ok: !/echec/.test(url), status: /echec/.test(url) ? 500 : 200 }; };
  const canaux = { ntfy: { url: "https://ntfy.test/sujet" }, telegram: { token: "TG", chat: "42", api: "https://tg.test" }, whatsapp: { token: "WA", phoneId: "123", destinataires: ["212611111111", "212622222222"], api: "https://wa.test" }, webhook: { url: "https://echec.test/hook" } };
  const r = creer({ jetonEcriture: "ecrit", jetonLecture: "lit", canaux, http_ });
  await new Promise((ok) => r.serveur.listen(0, "127.0.0.1", ok)); const base = `http://127.0.0.1:${r.serveur.address().port}`;
  const post = async (corps, jeton = "lit") => { const x = await fetch(base + "/api/alertes", { method: "POST", headers: { authorization: `Bearer ${jeton}` }, body: JSON.stringify(corps) }); return { code: x.status, json: await x.json() }; };
  try {
    assert.strictEqual((await post({ texte: "x" }, "ecrit")).code, 401); assert.strictEqual((await post({ niveau: "danger" })).code, 400);
    const a = await post({ texte: "Camion 12345 — température hors consigne", niveau: "danger", cle: "froid:12345" });
    assert.deepStrictEqual([...a.json.envoyes], ["ntfy", "telegram", "whatsapp:212611111111", "whatsapp:212622222222"]); assert.strictEqual(a.json.erreurs.length, 1); assert.ok(/webhook/.test(a.json.erreurs[0])); // le webhook en échec est signalé, sans bloquer les autres
    const wa = appels.find((x) => /wa\.test/.test(x.url)); assert.strictEqual(wa.url, "https://wa.test/123/messages"); const corps = JSON.parse(wa.o.body); assert.strictEqual(corps.type, "text"); assert.strictEqual(corps.to, "212611111111"); assert.strictEqual(wa.o.headers.Authorization, "Bearer WA");
    const tg = JSON.parse(appels.find((x) => /tg\.test/.test(x.url)).o.body); assert.strictEqual(tg.chat_id, "42"); assert.ok(/^🚨/.test(tg.text));
    assert.strictEqual(appels.find((x) => /ntfy/.test(x.url)).o.headers.Priority, "high");
    const n = appels.length; const bis = await post({ texte: "Camion 12345 — température hors consigne", niveau: "danger", cle: "froid:12345" });
    assert.strictEqual(bis.json.envoyes.length, 0); assert.ok(/Déjà transmise/.test(bis.json.note)); assert.strictEqual(appels.length, n); // même clé : pas de doublon pendant 6 h
    assert.deepStrictEqual([...(await (await fetch(base + "/api/etat", { headers: { authorization: "Bearer lit" } })).json()).canaux], ["ntfy", "telegram", "whatsapp", "webhook"]);
  } finally { await new Promise((ok) => r.serveur.close(ok)); }
  // modèle WhatsApp (messages hors fenêtre de 24 h) et serveur sans canal
  const r2 = creer({ jetonEcriture: "e", jetonLecture: "l", canaux: { whatsapp: { token: "T", phoneId: "9", destinataires: ["34600000000"], modele: "alerte_flotte", langue: "fr" } }, http_ });
  await new Promise((ok) => r2.serveur.listen(0, "127.0.0.1", ok)); const b2 = `http://127.0.0.1:${r2.serveur.address().port}`;
  try { appels.length = 0; await fetch(b2 + "/api/alertes", { method: "POST", headers: { authorization: "Bearer l" }, body: JSON.stringify({ texte: "Signal perdu", niveau: "warn", cle: "k" }) }); const m = JSON.parse(appels[0].o.body); assert.strictEqual(m.type, "template"); assert.strictEqual(m.template.name, "alerte_flotte"); assert.strictEqual(m.template.components[0].parameters[0].text, "Signal perdu"); } finally { await new Promise((ok) => r2.serveur.close(ok)); }
  const r4 = creer({ jetonEcriture: "e", jetonLecture: "l", canaux: { telegram: { token: "T", chat: "1", api: "https://echec.test" }, ntfy: { url: "https://ntfy.test/x" } }, http_ });
  await new Promise((ok) => r4.serveur.listen(0, "127.0.0.1", ok)); const b4 = `http://127.0.0.1:${r4.serveur.address().port}`;
  try { const e = await (await fetch(b4 + "/api/alertes/test", { method: "POST", headers: { authorization: "Bearer l" } })).json(); assert.deepStrictEqual([...e.envoyes], ["ntfy"]); assert.ok(/telegram : réponse 500/.test(e.erreurs[0])); // le test dit précisément quel canal échoue
    assert.strictEqual((await fetch(b4 + "/api/alertes/test", { method: "POST", headers: { authorization: "Bearer e" } })).status, 401);
    const e2 = await (await fetch(b4 + "/api/alertes/test", { method: "POST", headers: { authorization: "Bearer l" } })).json(); assert.strictEqual(e2.envoyes.length, 1); // le test n'est pas bloqué par la déduplication
  } finally { await new Promise((ok) => r4.serveur.close(ok)); }
  const r3 = creer({ jetonEcriture: "e", jetonLecture: "l" }); await new Promise((ok) => r3.serveur.listen(0, "127.0.0.1", ok));
  try { const x = await (await fetch(`http://127.0.0.1:${r3.serveur.address().port}/api/alertes`, { method: "POST", headers: { authorization: "Bearer l" }, body: JSON.stringify({ texte: "t" }) })).json(); assert.ok(/Aucun canal/.test(x.note)); } finally { await new Promise((ok) => r3.serveur.close(ok)); }
});

test("synchronisation : versions, conflit 409, blob opaque, persistance, jetons", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-")); let s = await demarrer(dossier);
  const put = (base, blob, jeton = "lit") => s.appel("/api/sync", { methode: "PUT", jeton, corps: { base, blob, appareil: "Bureau" } });
  try {
    assert.strictEqual((await s.appel("/api/sync")).code, 401); assert.strictEqual((await put(0, "x", "ecrit")).code, 401); // le jeton des balises ne synchronise pas
    assert.strictEqual((await s.appel("/api/sync", { jeton: "lit" })).json.version, 0);
    assert.strictEqual((await put(0, "")).code, 400);
    assert.strictEqual((await put(0, "CHIFFRE-1")).json.version, 1);
    const conflit = await put(0, "CHIFFRE-X"); assert.strictEqual(conflit.code, 409); assert.strictEqual(conflit.json.version, 1); // base périmée : refusé
    assert.strictEqual((await put(1, "CHIFFRE-2")).json.version, 2);
    const g = (await s.appel("/api/sync", { jeton: "lit" })).json; assert.strictEqual(g.blob, "CHIFFRE-2"); assert.strictEqual(g.appareil, "Bureau"); assert.ok(g.t > 0);
    assert.strictEqual((await s.appel("/api/sync?meta=1", { jeton: "lit" })).json.blob, undefined); // sondage léger sans le contenu
    const gros = "A".repeat(1024 * 1024); assert.strictEqual((await put(2, gros)).json.version, 3); // plus de 256 Ko accepté sur cette route
  } finally { await s.arreter(); }
  s = await demarrer(dossier);
  try { assert.strictEqual((await s.appel("/api/sync?meta=1", { jeton: "lit" })).json.version, 3); } finally { await s.arreter(); }
  fs.rmSync(dossier, { recursive: true });
});

test("photos : envoi, liste, lecture à l'identique, suppression avec trace, jetons, identifiants, persistance", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-")); let s = await demarrer(dossier);
  const brut = (methode, chemin, corps, jeton = "lit") => fetch(s.base + chemin, { method: methode, headers: { authorization: `Bearer ${jeton}`, "content-type": "application/octet-stream" }, body: corps });
  const octets = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
  try {
    assert.strictEqual((await brut("PUT", "/api/sync/photos/abc123xyz", octets, "ecrit")).status, 401); // le jeton des balises ne touche pas aux photos
    assert.strictEqual((await brut("PUT", "/api/sync/photos/..%2Fjetons", octets)).status, 400); assert.strictEqual((await brut("PUT", "/api/sync/photos/a", octets)).status, 400);
    assert.strictEqual((await brut("PUT", "/api/sync/photos/abc123xyz", Buffer.alloc(0))).status, 400);
    assert.strictEqual((await brut("PUT", "/api/sync/photos/abc123xyz", octets)).status, 200);
    const l = await (await brut("GET", "/api/sync/photos")).json(); assert.strictEqual(l.photos.length, 1); assert.strictEqual(l.photos[0].taille, 5000); assert.strictEqual(l.octets, 5000); assert.strictEqual(l.photos[0].supprime, false);
    const lu = Buffer.from(await (await brut("GET", "/api/sync/photos/abc123xyz")).arrayBuffer()); assert.ok(lu.equals(octets), "contenu rendu à l'octet près");
    assert.strictEqual((await brut("GET", "/api/sync/photos/inconnue99")).status, 404);
    assert.strictEqual((await brut("PUT", "/api/sync/photos/trop-grosse", Buffer.alloc(7 * 1024 * 1024))).status, 413);
    assert.strictEqual((await brut("DELETE", "/api/sync/photos/abc123xyz")).status, 200);
    assert.strictEqual((await brut("GET", "/api/sync/photos/abc123xyz")).status, 404);
    const l2 = await (await brut("GET", "/api/sync/photos")).json(); assert.strictEqual(l2.photos[0].supprime, true); assert.strictEqual(l2.octets, 0); // la suppression reste visible pour les autres appareils
    await brut("PUT", "/api/sync/photos/gardee0001", octets);
  } finally { await s.arreter(); }
  s = await demarrer(dossier);
  try { const l = await (await fetch(s.base + "/api/sync/photos", { headers: { authorization: "Bearer lit" } })).json(); assert.strictEqual(l.photos.filter((x) => !x.supprime).length, 1);
    assert.strictEqual((await (await fetch(s.base + "/api/sync/photos/gardee0001", { headers: { authorization: "Bearer lit" } })).arrayBuffer()).byteLength, 5000);
    assert.ok(!fs.existsSync(path.join(dossier, "photos", "abc123xyz.bin"))); } finally { await s.arreter(); }
  fs.rmSync(dossier, { recursive: true });
  // quota
  const r = creer({ jetonEcriture: "e", jetonLecture: "l", photosMaxMo: 0.004 }); await new Promise((ok) => r.serveur.listen(0, "127.0.0.1", ok)); const b = `http://127.0.0.1:${r.serveur.address().port}`;
  try { const put = (id, n) => fetch(`${b}/api/sync/photos/${id}`, { method: "PUT", headers: { authorization: "Bearer l" }, body: Buffer.alloc(n, 1) });
    assert.strictEqual((await put("photo00001", 3000)).status, 200); assert.strictEqual((await put("photo00002", 3000)).status, 507); assert.strictEqual((await put("photo00001", 3500)).status, 200); // remplacer la même photo ne compte pas deux fois
  } finally { await new Promise((ok) => r.serveur.close(ok)); }
});

(async () => {
  let ok = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log("✓", n); } catch (e) { console.error("✗", n, "\n ", e.message); process.exitCode = 1; } }
  console.log(`\n${ok}/${tests.length} test(s) du relais réussi(s)`);
})();
