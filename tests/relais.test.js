// Tests du relais de positions : node tests/relais.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { creer, normaliser } = require("../serveur/relais.js");
const { creerCoffre, chargerCoffre, estChiffre } = require("../serveur/coffre.js");
const { planPurge } = require("../serveur/purge-photos.js");
const A = require("../serveur/auth.js");
const { creerMulti } = require("../serveur/multi.js");
const M = require("../serveur/marches.js");

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

async function demarrer(dossier = null, options = {}) {
  const r = creer({ jetonEcriture: "ecrit", jetonLecture: "lit", dossier, ...options });
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

/** Faux serveur SMTP local : enregistre le dialogue et le message reçu. */
async function fauxSmtp({ refuserRcpt = false } = {}) {
  const net = require("net"), recu = { commandes: [], donnees: "" };
  const serveur = net.createServer((c) => {
    let tampon = "", enDonnees = false; c.write("220 faux.smtp ESMTP\r\n");
    c.on("data", (b) => {
      tampon += b.toString("utf8");
      if (enDonnees) { const i = tampon.indexOf("\r\n.\r\n"); if (i < 0) return; recu.donnees = tampon.slice(0, i); tampon = tampon.slice(i + 5); enDonnees = false; c.write("250 2.0.0 accepte\r\n"); }
      let i; while (!enDonnees && (i = tampon.indexOf("\r\n")) >= 0) {
        const l = tampon.slice(0, i); tampon = tampon.slice(i + 2); recu.commandes.push(l);
        if (/^EHLO/.test(l)) c.write("250-faux.smtp\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n"); else if (l === "AUTH LOGIN") c.write("334 VXNlcm5hbWU6\r\n");
        else if (recu.commandes[recu.commandes.length - 2] === "AUTH LOGIN") c.write("334 UGFzc3dvcmQ6\r\n"); else if (recu.commandes[recu.commandes.length - 3] === "AUTH LOGIN") c.write("235 ok\r\n");
        else if (/^MAIL FROM/.test(l)) c.write("250 ok\r\n"); else if (/^RCPT TO/.test(l)) c.write(refuserRcpt ? "550 boite inconnue\r\n" : "250 ok\r\n");
        else if (l === "DATA") { c.write("354 allez-y\r\n"); enDonnees = true; } else if (l === "QUIT") { c.write("221 au revoir\r\n"); c.end(); }
      }
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { recu, port: serveur.address().port, fermer: () => new Promise((ok) => serveur.close(ok)) };
}
const decoderParties = (d) => [...d.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));

test("e-mail : dialogue SMTP complet (authentification, sujet accentué, texte et HTML), refus et adresses piégées", async () => {
  const { envoyerCourriel, composer } = require("../serveur/courriel.js"), f = await fauxSmtp();
  try {
    const cfg = { hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "compta@atlas.example", motDePasse: "s3cret", de: "compta@atlas.example" };
    const r = await envoyerCourriel(cfg, { a: "achats@primeurs.example", sujet: "V-26-001 — Livré · تم التسليم", texte: "Votre marchandise a été livrée.\n.ligne qui commence par un point\nSuivi : https://exemple.org/suivi/abc" });
    assert.strictEqual(r.ok, true);
    const c = f.recu.commandes; assert.ok(c[0].startsWith("EHLO ")); assert.strictEqual(c[1], "AUTH LOGIN"); assert.strictEqual(Buffer.from(c[2], "base64").toString(), "compta@atlas.example"); assert.strictEqual(Buffer.from(c[3], "base64").toString(), "s3cret");
    assert.ok(c.includes("MAIL FROM:<compta@atlas.example>") && c.includes("RCPT TO:<achats@primeurs.example>") && c.includes("DATA") && c.includes("QUIT"));
    const d = f.recu.donnees, sujet = d.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m); assert.ok(sujet, "sujet encodé"); assert.strictEqual(Buffer.from(sujet[1], "base64").toString(), "V-26-001 — Livré · تم التسليم");
    const [texte, html] = decoderParties(d); assert.ok(texte.includes(".ligne qui commence par un point")); assert.ok(html.includes('<a href="https://exemple.org/suivi/abc">') && html.includes("<br>"));
    assert.ok(/multipart\/alternative/.test(d) && /^From: compta@atlas\.example$/m.test(d) && /^To: achats@primeurs\.example$/m.test(d));
    const f2 = await fauxSmtp({ refuserRcpt: true }); await assert.rejects(() => envoyerCourriel({ ...cfg, port: f2.port }, { a: "x@y.example", sujet: "s", texte: "t" }), /RCPT refusé.*550/); await f2.fermer();
    assert.throws(() => composer({ de: "a@b.example", a: "x@y.example\r\nBcc: espion@z.example", sujet: "s", texte: "t" }), /invalide/);
    assert.ok(!composer({ de: "a@b.example", a: "x@y.example", sujet: "s\r\nBcc: espion@z.example", texte: "t" }).includes("\r\nBcc:"), "pas d'en-tête injecté par le sujet");
    await assert.rejects(() => envoyerCourriel({ ...cfg, port: 1 }, { a: "x@y.example", sujet: "s", texte: "t" }, { delai: 3000 }), /SMTP/);
  } finally { await f.fermer(); }
});

test("e-mail avec pièces jointes : facture (HTML) et photo du CMR en multipart/mixed, noms de fichiers sûrs ; route du relais (types, taille, adresse, sans SMTP)", async () => {
  const { composer } = require("../serveur/courriel.js"), f = await fauxSmtp();
  try {
    const d0 = composer({ de: "compta@atlas.example", a: "achats@primeurs.example", sujet: "Facture", texte: "Ci-joint.", pieces: [{ nom: "Facture FAC-2026-0001.html", type: "text/html", base64: Buffer.from("<h1>Facture</h1>").toString("base64") }, { nom: "CMR signé.jpg", type: "image/jpeg", base64: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") }] });
    assert.ok(/^Content-Type: multipart\/mixed; boundary=/m.test(d0) && /multipart\/alternative/.test(d0));
    assert.ok(d0.includes('Content-Disposition: attachment; filename="Facture FAC-2026-0001.html"') && d0.includes('filename="CMR signe.jpg"'), "nom sans accent");
    assert.ok(d0.includes(Buffer.from("<h1>Facture</h1>").toString("base64")));
    assert.throws(() => composer({ de: "a@b.example", a: "x@y.example", sujet: "s", texte: "t", pieces: [{ nom: "x.exe", type: "application/x-msdownload", base64: "AA==" }] }), /refusé/);
    const smtp = { hote: "127.0.0.1", port: f.port, securite: "aucune", de: "compta@atlas.example" };
    const s1 = await demarrer(null, { smtp });
    try {
      const envoi = (corps, jeton = "lit") => fetch(`${s1.base}/api/notifications/document?token=${jeton}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      let r = await envoi({ a: "achats@primeurs.example", sujet: "Facture FAC-2026-0001", texte: "Bonjour, ci-joint.", pieces: [{ nom: "FAC-2026-0001.html", type: "text/html", base64: Buffer.from("<p>ok</p>").toString("base64") }] });
      assert.strictEqual(r.status, 200, await r.clone().text()); assert.ok(f.recu.donnees.includes('filename="FAC-2026-0001.html"'));
      assert.strictEqual((await envoi({ a: "pas-une-adresse", pieces: [] })).status, 400);
      assert.strictEqual((await envoi({ a: "x@y.example", pieces: [{ nom: "a.js", type: "text/javascript", base64: "AA==" }] })).status, 400);
      assert.strictEqual((await envoi({ a: "x@y.example", pieces: Array.from({ length: 9 }, () => ({ nom: "a.png", type: "image/png", base64: "AA==" })) })).status, 400);
      assert.strictEqual((await envoi({ a: "x@y.example", pieces: [] }, "mauvais")).status, 401);
    } finally { await s1.arreter(); }
    const s2 = await demarrer(null, {});
    try { assert.strictEqual((await fetch(`${s2.base}/api/notifications/document?token=lit`, { method: "POST", body: JSON.stringify({ a: "x@y.example" }) })).status, 503, "sans SMTP"); } finally { await s2.arreter(); }
  } finally { await f.fermer(); }
});

test("notifications programmées : plan, envoi à l'heure (ntfy, e-mail), périmées, annulation, persistance après redémarrage", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-notif-")), appels = [], mails = [];
  const http_ = async (url, o) => { appels.push({ url, corps: o.body, titre: o.headers?.Title }); return { ok: true, status: 200 }; };
  const courriel_ = async (cfg, m) => { mails.push(m); return { ok: true }; };
  const opts = { http_, courriel_, smtp: { hote: "smtp.exemple.org", de: "relais@atlas.example" } };
  let s = await demarrer(dossier, opts); const T = Date.now();
  try {
    const plan = { messages: [
      { id: "v1:depart:pre:0", quand: T + 3600000, canal: "ntfy", destination: "https://ntfy.sh/atlas-casa-7f3k", sujet: "V-1 — Départ du dépôt", texte: "Récap : voyage V-1 demain 05:30" },
      { id: "v1:livre:post:0", quand: T + 7200000, canal: "email", destination: "compta@atlas.example", sujet: "V-1 — Livré", texte: "Facture à émettre" },
      { id: "vieux", quand: T - 7 * 3600000, canal: "ntfy", destination: "https://ntfy.sh/atlas-casa-7f3k", texte: "trop tard" },
      { id: "pirate", quand: T, canal: "ntfy", destination: "https://evil.example/atlas-casa-7f3k", texte: "x" },
      { id: "sms", quand: T, canal: "sms", destination: "33600000000", texte: "x" },
      { id: "court", quand: T, canal: "ntfy", destination: "https://ntfy.sh/abc", texte: "x" },
    ] };
    assert.strictEqual((await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "ecrit", corps: plan })).code, 401, "le jeton des balises ne programme rien");
    const r = await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: plan });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.json.programmes, 3); assert.deepStrictEqual(r.json.refus.map((x) => x.id), ["pirate", "sms", "court"]);
    assert.ok(/non autorisé \(evil\.example\)/.test(r.json.refus[0].raison));
    let f = await s.tick(T); assert.deepStrictEqual(f.map((x) => [x.id, x.statut]), [["vieux", "perime"]]); assert.strictEqual(appels.length, 0);
    f = await s.tick(T + 3600000 + 1000); assert.deepStrictEqual(f.map((x) => [x.id, x.statut]), [["v1:depart:pre:0", "envoye"]]);
    assert.strictEqual(appels[0].url, "https://ntfy.sh/atlas-casa-7f3k"); assert.strictEqual(appels[0].corps, "Récap : voyage V-1 demain 05:30"); assert.ok(appels[0].titre.startsWith("=?UTF-8?B?"), "titre accentué encodé pour l'en-tête");
    assert.strictEqual((await s.tick(T + 3600000 + 2000)).length, 0, "pas envoyé deux fois");
    // annulation, puis redémarrage du relais : l'état est conservé
    assert.strictEqual((await s.appel(`/api/notifications/scheduler/${encodeURIComponent("v1:livre:post:0")}`, { methode: "DELETE", jeton: "lit" })).code, 200);
    await s.arreter(); s = await demarrer(dossier, opts);
    const l = await s.appel(`/api/notifications/scheduler?debut=${T - 86400000}&fin=${T + 86400000}`, { jeton: "lit" });
    assert.deepStrictEqual(l.json.messages.map((m) => [m.id, m.statut]), [["vieux", "perime"], ["v1:depart:pre:0", "envoye"], ["v1:livre:post:0", "annule"]]); assert.deepStrictEqual(l.json.canaux, ["ntfy", "email"]);
    assert.strictEqual((await s.tick(T + 9 * 3600000)).length, 0); assert.strictEqual(mails.length, 0, "annulé : rien n'est parti");
    // un nouveau plan (voyage décalé) ne renvoie pas ce qui est déjà parti, et programme ce qui est nouveau
    const r2 = await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: { messages: [{ ...plan.messages[0], quand: T + 26 * 3600000 }, { id: "v1:livre:post:1", quand: T + 10 * 3600000, canal: "email", destination: "compta@atlas.example", texte: "Rappel" }] } });
    assert.strictEqual(r2.json.programmes, 1); f = await s.tick(T + 10 * 3600000 + 1000); assert.deepStrictEqual(f.map((x) => x.id), ["v1:livre:post:1"]); assert.strictEqual(mails[0].a, "compta@atlas.example"); assert.strictEqual(mails[0].texte, "Rappel");
    assert.strictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.notifications.join(), "ntfy,email");
  } finally { await s.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); }
});

test("notifications immédiates : envoi, doublon d'un autre appareil écarté, WhatsApp avec repli e-mail, essai des canaux", async () => {
  const appels = [], mails = []; let whatsappEnPanne = true;
  const http_ = async (url, o) => { appels.push(url); return { ok: !(whatsappEnPanne && /graph/.test(url)), status: whatsappEnPanne && /graph/.test(url) ? 400 : 200 }; };
  const courriel_ = async (cfg, m) => { if (/refus/.test(m.a)) throw new Error("boîte inconnue"); mails.push(m); return { ok: true }; };
  const s = await demarrer(null, { http_, courriel_, smtp: { hote: "smtp.exemple.org", de: "relais@atlas.example" }, canaux: { whatsapp: { token: "t", phoneId: "123", destinataires: [] }, ntfy: { url: "https://ntfy.monserveur.example/equipe" } } });
  try {
    const m = { id: "v1:livre:jalon:client_externe:whatsapp", canal: "whatsapp", destination: "33468000000", repli: { canal: "email", destination: "achats@primeurs.example" }, sujet: "V-1 — Livré", texte: "Hola, su mercancía fue entregada.", cle: "jalon:v1:livre:client" };
    let r = await s.appel("/api/notifications/manuelle", { methode: "POST", jeton: "lit", corps: { messages: [m] } });
    assert.strictEqual(r.json.journal[0].statut, "envoye"); assert.ok(r.json.journal[0].erreurs[0].startsWith("whatsapp:33468000000 : réponse 400")); assert.deepStrictEqual(r.json.journal[0].envoyes, ["email:achats@primeurs.example"]);
    r = await s.appel("/api/notifications/manuelle", { methode: "POST", jeton: "lit", corps: { messages: [m] } }); assert.strictEqual(r.json.journal[0].statut, "deja_envoye", "l'autre bureau a déjà prévenu le client");
    whatsappEnPanne = false; r = await s.appel("/api/notifications/manuelle", { methode: "POST", jeton: "lit", corps: { forcer: true, messages: [m] } }); assert.deepStrictEqual(r.json.journal[0].envoyes, ["whatsapp:33468000000"]); assert.strictEqual(mails.length, 1, "WhatsApp passe : pas de repli");
    r = await s.appel("/api/notifications/manuelle", { methode: "POST", jeton: "lit", corps: { messages: [{ id: "a", canal: "email", destination: "refus@x.example", texte: "t" }, { id: "b", canal: "ntfy", destination: "https://ntfy.monserveur.example/sujet-equipe-1", texte: "t" }, { id: "c", canal: "in_app", texte: "t" }] } });
    assert.deepStrictEqual(r.json.journal.map((x) => x.statut), ["erreur", "envoye", "refuse"]); assert.ok(/boîte inconnue/.test(r.json.journal[0].erreurs[0]), "hôte ntfy du relais autorisé, canal de l'application refusé");
    const t = await s.appel("/api/notifications/test", { methode: "POST", jeton: "lit", corps: { ntfy: "https://ntfy.sh/essai-atlas-01", email: "moi@atlas.example" } });
    assert.deepStrictEqual(t.json.resultats.map((x) => [x.canal, x.envoyes.length > 0]), [["equipe", true], ["ntfy", true], ["email", true]]); assert.deepStrictEqual(t.json.canaux, ["equipe", "ntfy", "whatsapp", "email"]);
    assert.strictEqual((await s.appel("/api/notifications/test", { methode: "POST" })).code, 401);
  } finally { await s.arreter(); }
});

test("chiffrement au repos : aller-retour, mauvaise clé, fichier en clair relu, lignes, phrase créée une fois (mode 600)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "coffre-"));
  try {
    const a = chargerCoffre(d, { CHIFFRER_DONNEES: "true" }); assert.strictEqual(a.nouvelle, true); assert.strictEqual(a.coffre.actif, true);
    assert.strictEqual(fs.statSync(path.join(d, "cle.env")).mode & 0o777, 0o600); assert.ok(/^CLE=.{20,}$/m.test(fs.readFileSync(path.join(d, "cle.env"), "utf8")));
    const b = chargerCoffre(d, { CHIFFRER_DONNEES: "true" }); assert.strictEqual(b.nouvelle, false, "la même phrase est relue");
    const f = path.join(d, "x.json"); a.coffre.ecrire(f, JSON.stringify({ secret: "Primeurs du Sud" }));
    const brut = fs.readFileSync(f); assert.ok(estChiffre(brut)); assert.ok(!brut.toString("latin1").includes("Primeurs")); assert.strictEqual(JSON.parse(b.coffre.lireTexte(f)).secret, "Primeurs du Sud");
    const autre = chargerCoffre(d, { CHIFFRER_DONNEES: "true", CLE_DONNEES: "une-tout-autre-phrase" }); assert.throws(() => autre.coffre.lireTexte(f), /mauvaise clé/);
    assert.throws(() => creerCoffre(null).lireTexte(f), /CHIFFRER_DONNEES/);
    fs.writeFileSync(path.join(d, "clair.json"), '{"ancien":true}'); assert.strictEqual(JSON.parse(a.coffre.lireTexte(path.join(d, "clair.json"))).ancien, true, "un fichier d'avant le chiffrement se lit encore");
    const l = a.coffre.ligne('{"id":"BAL-1"}'); assert.ok(l.startsWith("~") && !l.includes("BAL-1")); assert.strictEqual(a.coffre.delire(l), '{"id":"BAL-1"}'); assert.strictEqual(a.coffre.delire('{"clair":1}'), '{"clair":1}');
    const sans = chargerCoffre(d, {}); assert.strictEqual(sans.coffre.actif, false); assert.strictEqual(sans.coffre.ligne("x"), "x");
    assert.throws(() => chargerCoffre(d, { CHIFFRER_DONNEES: "true", CLE_DONNEES: "court" }), /12 caractères/);
    assert.ok(!fs.readdirSync(d).some((x) => x.endsWith(".tmp")), "écritures atomiques : aucun fichier temporaire laissé");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("relais chiffré : rien de lisible sur le disque, tout revient au redémarrage, mauvaise clé sans plantage, migration depuis le clair", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "relais-chiffre-")), t = maintenant();
  const env = { CHIFFRER_DONNEES: "true", CLE_DONNEES: "phrase-secrete-de-test-123" };
  try {
    // 1) démarrage en clair (installation existante), puis activation du chiffrement
    let s = await demarrer(d); await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: [{ id: "BAL-ANCIEN", t: t - 600, lat: 33.5, lon: -7.6, v: 10 }] }); await s.arreter();
    s = await demarrer(d, { coffre: chargerCoffre(d, env).coffre });
    assert.strictEqual((await s.appel("/api/derniere", { jeton: "lit" })).json.positions?.length ?? (await s.appel("/api/derniere", { jeton: "lit" })).json.length, 1, "les positions d'avant restent lisibles");
    await s.appel("/api/positions", { methode: "POST", jeton: "ecrit", corps: [{ id: "BAL-SECRET", t: t - 60, lat: 35.7, lon: -5.8, v: 70 }] });
    const c = await s.appel("/api/partages", { methode: "POST", jeton: "lit", corps: { balise: "BAL-SECRET", reference: "CMD-CONFIDENTIEL", origine: "Agadir", destination: "Perpignan", jours: 3 } });
    await s.appel("/api/sync", { methode: "PUT", jeton: "lit", corps: { base: 0, blob: "BLOB-OPAQUE-XYZ", appareil: "Bureau Casablanca" } });
    await fetch(s.base + "/api/sync/photos/photo-123456", { method: "PUT", headers: { authorization: "Bearer lit" }, body: Buffer.from("PHOTO-OCTETS-LISIBLES") });
    await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: { messages: [{ id: "n1", quand: Date.now() + 3600000, canal: "ntfy", destination: "https://ntfy.sh/sujet-tres-secret", texte: "Message confidentiel" }] } });
    await s.appel("/api/alertes", { methode: "POST", jeton: "lit", corps: { texte: "Alerte confidentielle 111-A-1", niveau: "warn", cle: "a1" } });
    await s.arreter();
    // aucun fichier de données ne contient du texte lisible
    const tout = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tout(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of tout(d).filter((x) => !/cle\.env|sel\.bin|positions-.*BAL-ANCIEN/.test(x))) {
      const brut = fs.readFileSync(f).toString("latin1");
      for (const mot of ["BAL-SECRET", "CMD-CONFIDENTIEL", "BLOB-OPAQUE", "Bureau Casablanca", "PHOTO-OCTETS", "sujet-tres-secret", "Message confidentiel", "Alerte confidentielle"]) assert.ok(!brut.includes(mot), `${path.basename(f)} contient « ${mot} » en clair`);
    }
    // redémarrage avec la bonne clé : tout revient
    s = await demarrer(d, { coffre: chargerCoffre(d, env).coffre });
    assert.strictEqual((await s.appel("/api/sync", { jeton: "lit" })).json.blob, "BLOB-OPAQUE-XYZ");
    assert.strictEqual((await (await fetch(s.base + `/suivi/${c.json.id}/donnees`)).json()).reference, "CMD-CONFIDENTIEL");
    assert.strictEqual(Buffer.from(await (await fetch(s.base + "/api/sync/photos/photo-123456", { headers: { authorization: "Bearer lit" } })).arrayBuffer()).toString(), "PHOTO-OCTETS-LISIBLES");
    assert.strictEqual((await s.appel("/api/notifications/scheduler", { jeton: "lit" })).json.messages[0].texte, "Message confidentiel");
    assert.strictEqual((await s.appel("/api/alertes/historique", { jeton: "lit" })).json.alertes[0].texte, "Alerte confidentielle 111-A-1");
    const pos = (await s.appel("/api/trace?id=BAL-SECRET&depuis=" + (t - 3600), { jeton: "lit" })).json; assert.ok(JSON.stringify(pos).includes("35.7"), "positions relues : " + JSON.stringify(pos).slice(0, 120));
    await s.arreter();
    s = await demarrer(d, { coffre: chargerCoffre(d, env).coffre }); assert.strictEqual((await s.appel("/api/alertes/historique", { jeton: "lit" })).json.alertes.length, 1, "deuxième redémarrage : l'historique est toujours lisible"); await s.arreter();
    // mauvaise clé : le relais démarre, ne montre rien, ne plante pas
    s = await demarrer(d, { coffre: chargerCoffre(d, { CHIFFRER_DONNEES: "true", CLE_DONNEES: "mauvaise-phrase-secrete" }).coffre });
    assert.strictEqual((await s.appel("/sante")).code, 200); assert.strictEqual((await s.appel("/api/sync", { jeton: "lit" })).json.blob, ""); assert.strictEqual((await fetch(s.base + `/suivi/${c.json.id}/donnees`)).status, 404);
    await s.arreter();
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("historique des alertes : 7 jours, fenêtre, conservé au redémarrage ; journal d'accès sans jeton, adresse tronquée", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "relais-histo-"));
  try {
    const vieille = JSON.stringify({ t: Date.now() - 8 * 86400000, texte: "trop ancienne", niveau: "warn", cle: "v" }); fs.writeFileSync(path.join(d, "alertes.jsonl"), vieille + "\n");
    let s = await demarrer(d, { journalAcces: true });
    for (const [i, texte] of ["111-A-1 — aucun signal depuis 45 min", "222-B-2 — arrêt long"].entries()) await s.appel("/api/alertes", { methode: "POST", jeton: "lit", corps: { texte, niveau: i ? "warn" : "danger", cle: "k" + i } });
    await s.appel("/api/alertes", { methode: "POST", jeton: "lit", corps: { texte: "111-A-1 — aucun signal depuis 45 min", cle: "k0" } }); // doublon de moins de 6 h : pas deux fois
    let h = (await s.appel("/api/alertes/historique", { jeton: "lit" })).json.alertes; assert.deepStrictEqual(h.map((a) => a.cle), ["k0", "k1"]); assert.strictEqual(h[0].niveau, "danger");
    assert.strictEqual((await s.appel("/api/alertes/historique", { jeton: "ecrit" })).code, 401);
    assert.strictEqual((await s.appel(`/api/alertes/historique?debut=${Date.now() + 1000}`, { jeton: "lit" })).json.alertes.length, 0);
    await s.arreter(); s = await demarrer(d, { journalAcces: true });
    h = (await s.appel(`/api/alertes/historique?debut=${Math.floor(Date.now() / 1000) - 3600}`, { jeton: "lit" })).json.alertes; assert.strictEqual(h.length, 2, "conservé ; la plus ancienne (8 jours) écartée et retirée du fichier");
    assert.ok(!fs.readFileSync(path.join(d, "alertes.jsonl"), "utf8").includes("trop ancienne"));
    await s.appel("/api/derniere", { jeton: "lit" }); await s.appel("/api/derniere?token=mauvais"); await s.arreter();
    const f = fs.readdirSync(d).find((x) => /^acces-/.test(x)), lignes = fs.readFileSync(path.join(d, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lignes.some((l) => l.p === "/api/derniere" && l.jeton === "lecture" && l.code === 200)); assert.ok(lignes.some((l) => l.jeton === "aucun" && l.code === 401));
    assert.ok(lignes.every((l) => /\.0$|::$/.test(l.ip)), "adresse tronquée : " + lignes[0].ip); assert.ok(!fs.readFileSync(path.join(d, f), "utf8").includes("mauvais") && !fs.readFileSync(path.join(d, f), "utf8").includes("lit\""), "aucun jeton dans le journal");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("purge des photos : marquées après N mois, supprimées après le délai de grâce, gardées si renvoyées, journal", async () => {
  const J = 86400000, now = Date.parse("2028-06-01T00:00:00Z"), s2 = (ms) => Math.floor(ms / 1000);
  const plan = planPurge(new Map([["vieille", { t: s2(now - 600 * J), taille: 1 }], ["recente", { t: s2(now - 30 * J), taille: 1 }], ["marquee", { t: s2(now - 600 * J), taille: 1, aPurger: now - 31 * J }], ["grace", { t: s2(now - 600 * J), taille: 1, aPurger: now - 5 * J }], ["renvoyee", { t: s2(now - 2 * J), taille: 1, aPurger: now - 40 * J }], ["morte", { t: 1, taille: 0, supprime: true }]]), now, { mois: 18, graceJours: 30 });
  assert.deepStrictEqual(plan.map((x) => [x.id, x.action]), [["vieille", "marquer"], ["marquee", "supprimer"], ["renvoyee", "demarquer"]]); assert.strictEqual(plan[0].ageJours, 600);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "relais-purge-"));
  try {
    const s = await demarrer(d, { purgePhotosMois: 18 });
    await fetch(s.base + "/api/sync/photos/photo-ancienne", { method: "PUT", headers: { authorization: "Bearer lit" }, body: Buffer.from("x") });
    await fetch(s.base + "/api/sync/photos/photo-recente", { method: "PUT", headers: { authorization: "Bearer lit" }, body: Buffer.from("y") });
    s.photos.get("photo-ancienne").t = s2(Date.now() - 20 * 30.4375 * J);
    let b = s.purgerPhotos(Date.now()); assert.deepStrictEqual(b, { marquees: 1, supprimees: 0, demarquees: 0 });
    assert.strictEqual((await fetch(s.base + "/api/sync/photos/photo-ancienne", { headers: { authorization: "Bearer lit" } })).status, 200, "pendant le délai de grâce, la photo est encore là");
    assert.deepStrictEqual(s.purgerPhotos(Date.now() + 10 * J), { marquees: 0, supprimees: 0, demarquees: 0 });
    b = s.purgerPhotos(Date.now() + 31 * J); assert.strictEqual(b.supprimees, 1);
    assert.strictEqual((await fetch(s.base + "/api/sync/photos/photo-ancienne", { headers: { authorization: "Bearer lit" } })).status, 404); assert.ok(!fs.existsSync(path.join(d, "photos", "photo-ancienne.bin")));
    const l = (await s.appel("/api/sync/photos", { jeton: "lit" })).json.photos; assert.ok(l.find((x) => x.id === "photo-ancienne").supprime, "trace laissée : les appareils suppriment aussi leur copie"); assert.ok(!l.find((x) => x.id === "photo-recente").supprime);
    const journal = fs.readFileSync(path.join(d, "purge.log"), "utf8").trim().split("\n").map((x) => JSON.parse(x)); assert.deepStrictEqual(journal.map((x) => [x.id, x.action]), [["photo-ancienne", "marquer"], ["photo-ancienne", "supprimer"]]);
    await s.arreter();
    assert.strictEqual(creer({ jetonEcriture: "a", jetonLecture: "b" }).purgerPhotos(), null, "sans PURGE_PHOTOS_MOIS : rien");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("authentification : mots de passe, TOTP (vecteurs RFC 6238), rotation des sessions et vol de jeton, blocages", () => {
  const h = A.hacherMotDePasse("un mot de passe solide"); assert.ok(h.startsWith("scrypt$15$8$1$")); assert.strictEqual(A.verifierMotDePasse("un mot de passe solide", h), true); assert.strictEqual(A.verifierMotDePasse("autre chose", h), false); assert.strictEqual(A.verifierMotDePasse("x", null), false);
  assert.notStrictEqual(A.hacherMotDePasse("même"), A.hacherMotDePasse("même"), "sel aléatoire");
  const secret = A.base32(Buffer.from("12345678901234567890")); assert.strictEqual(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.strictEqual(A.totp(secret, 59000), "287082"); assert.strictEqual(A.totp(secret, 1111111109000), "081804"); assert.strictEqual(A.totp(secret, 1234567890000), "005924");
  assert.strictEqual(A.verifierTotp(secret, "287082", 59000), 1); assert.strictEqual(A.verifierTotp(secret, "287082", 59000 + 30000), 1, "un pas de tolérance"); assert.strictEqual(A.verifierTotp(secret, "287082", 59000 + 90000), null);
  assert.strictEqual(A.verifierTotp(secret, "287082", 59000, 1), null, "code déjà utilisé refusé"); assert.strictEqual(A.verifierTotp(secret, "abc", 59000), null); assert.ok(A.uriTotp(secret, "a@b.example").startsWith("otpauth://totp/Logistique%20Fret:a%40b.example?secret=GEZ"));
  let t = 1e12; const table = {}, S = A.creerSessions(table, { maintenant: () => t });
  const s1 = S.ouvrir("u1"); assert.strictEqual(S.lire(s1.acces).u, "u1"); assert.strictEqual(S.lire(s1.renouvellement), null, "un jeton de renouvellement n'ouvre pas l'accès"); assert.ok(Object.keys(table).every((k) => /^[0-9a-f]{64}$/.test(k)), "seules les empreintes sont gardées");
  const r = S.renouveler(s1.renouvellement); assert.strictEqual(r.u, "u1"); assert.strictEqual(S.lire(s1.acces), null, "l'ancien accès cesse"); assert.ok(S.lire(r.acces));
  assert.strictEqual(S.renouveler(s1.renouvellement).erreur, "reutilise"); assert.strictEqual(S.lire(r.acces), null, "réutilisation d'un jeton déjà consommé : toute la famille est révoquée");
  const s2 = S.ouvrir("u2"), s3 = S.ouvrir("u2"); S.revoquerCompte("u2", s3.famille); assert.strictEqual(S.lire(s2.acces), null); assert.ok(S.lire(s3.acces));
  t += 13 * 3600000; assert.strictEqual(S.lire(s3.acces), null, "accès expiré après 12 h"); const r3 = S.renouveler(s3.renouvellement); assert.ok(r3.acces, "renouvellement valable 30 jours");
  t += 31 * 86400000; assert.ok(["expire", "inconnu"].includes(S.renouveler(r3.renouvellement).erreur), "renouvellement expiré après 30 jours");
  const L = A.creerLimites({ maintenant: () => t }), c = {};
  for (let i = 0; i < 4; i++) L.echec(c); assert.strictEqual(L.bloqueJusqua(c), 0); L.echec(c); assert.strictEqual(L.bloqueJusqua(c), t + 15 * 60000);
  t += 16 * 60000; for (let i = 0; i < 5; i++) L.echec(c); t += 16 * 60000; for (let i = 0; i < 5; i++) L.echec(c); assert.strictEqual(L.bloqueJusqua(c), t + 3600000, "3e blocage : 1 h");
  L.succes(c); assert.strictEqual(L.bloqueJusqua(c), 0); for (let i = 0; i < 10; i++) assert.ok(L.essaiIp("1.2.3.4")); assert.strictEqual(L.essaiIp("1.2.3.4"), false, "11e essai de la minute refusé"); assert.ok(L.essaiIp("5.6.7.8"));
  assert.strictEqual(A.prefixeReseau("::ffff:41.250.12.7"), "41.250"); assert.strictEqual(A.prefixeReseau("2a01:cb00:1:2::1"), "2a01:cb00");
});

/** Relais multi-utilisateur de test, horloge réglable. */
async function demarrerMulti(dossier = null, opts = {}) {
  const horloge = { t: Date.now() }, alertes = [], mails = [];
  const multi = creerMulti({ dossier, version: "test", jetonLecture: "lit", maintenant: () => horloge.t, cookieSecurise: false, noterAlerte: (a) => alertes.push(a), smtp: opts.smtp || null, courriel_: async (cfg, m) => { mails.push(m); return { ok: true }; }, ...opts });
  const s = await demarrer(dossier, { multi, ...(opts.coffre ? { coffre: opts.coffre } : {}) }); let n = 0;
  const appel = async (chemin, { jeton = "", methode = "GET", corps, entetes = {}, ip } = {}) => { const r = await fetch(s.base + chemin, { method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), "content-type": "application/json", "x-forwarded-for": ip || `10.0.${Math.floor(n / 200)}.${(n++ % 200) + 1}`, ...entetes }, body: corps === undefined ? undefined : JSON.stringify(corps) }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* texte */ } return { code: r.status, json, texte: t, entetes: r.headers }; };
  const connexion = async (email, motDePasse, code, ip) => (await appel("/api/auth/login", { methode: "POST", corps: { email, motDePasse, code }, ip })).json;
  return { ...s, multi, horloge, alertes, mails, appel, connexion };
}
const SEMENCE = () => ({ params: { tauxEUR: 10.8, fraisGenerauxMois: 5000 }, entreprise: { nom: "Atlas Fret", tresorerie: { solde: 60000 } },
  camions: [{ id: "c1", immat: "111-A-1", fixeMensuel: 9000 }, { id: "c2", immat: "222-B-2" }], chauffeurs: [{ id: "h1", nom: "Youssef", perDiemJournalier: 30 }, { id: "h2", nom: "Karim" }],
  clients: [{ id: "k1", nom: "Primeurs du Sud", delai: 30 }], factures: [{ id: "f1", numero: "F-1", clientId: "k1", lignes: [{ montant: 1000 }] }], dossiers: [{ id: "d1", ref: "DUM-1", transitaireId: "COMPTE-TR" }, { id: "d2", ref: "DUM-2" }],
  voyages: [{ id: "v1", ref: "V-1", chauffeurId: "h1", camionId: "c1", statut: "en_cours", origine: "Agadir", destination: "Perpignan", prix: 4000, devise: "EUR", lignesCout: [{ id: "l1", type: "carburant", montant: 9000 }], traversees: [{ sens: "aller", fret: 320, ref: "DFDS-1" }], jalons: [] },
    { id: "v2", ref: "V-2", chauffeurId: "h2", camionId: "c2", statut: "prevu", origine: "Casablanca", destination: "Lyon", prix: 3500, devise: "EUR", lignesCout: [], jalons: [] }] });

test("multi-utilisateur : premier compte (jeton du relais), double authentification obligatoire du chef, connexion, session, données importées", async () => {
  const s = await demarrerMulti();
  try {
    assert.deepStrictEqual((await s.appel("/api/auth/etat")).json, { multi: true, initialise: false, version: "test", reinitialisationParEmail: false });
    const ini = { nom: "Hassan", email: "Direction@Atlas.example", motDePasse: "mot de passe du chef", donnees: SEMENCE() };
    assert.strictEqual((await s.appel("/api/auth/initialiser", { methode: "POST", corps: ini })).code, 401, "n'importe qui ne peut pas s'approprier un relais neuf");
    const r = await s.appel("/api/auth/initialiser", { methode: "POST", corps: ini, jeton: "lit" }); assert.strictEqual(r.code, 201); assert.strictEqual(r.json.importes, 12); assert.ok(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/.test(r.json.codeRecuperation));
    assert.strictEqual((await s.appel("/api/auth/initialiser", { methode: "POST", corps: ini, jeton: "lit" })).code, 409);
    assert.strictEqual((await s.appel("/api/donnees")).code, 401, "sans session : rien");
    let c = await s.connexion("direction@atlas.example", "mot de passe du chef"); assert.ok(c.acces); assert.strictEqual(c.exige2FA, true); assert.strictEqual(c.utilisateur.role, "chef_entreprise");
    assert.strictEqual((await s.appel("/api/donnees", { jeton: c.acces })).json.code, "2fa_requise", "chef sans double authentification : seulement le réglage de son compte");
    const i = (await s.appel("/api/auth/2fa/initier", { methode: "POST", jeton: c.acces, corps: {} })).json; assert.ok(i.uri.includes(i.secret));
    assert.strictEqual((await s.appel("/api/auth/2fa/activer", { methode: "POST", jeton: c.acces, corps: { code: "000000" } })).code, 400);
    assert.strictEqual((await s.appel("/api/auth/2fa/activer", { methode: "POST", jeton: c.acces, corps: { code: A.totp(i.secret, s.horloge.t) } })).code, 200);
    assert.strictEqual((await s.appel("/api/auth/login", { methode: "POST", corps: { email: "direction@atlas.example", motDePasse: "mot de passe du chef" } })).json.exige, "code");
    s.horloge.t += 31000; const code = A.totp(i.secret, s.horloge.t);
    c = await s.connexion("direction@atlas.example", "mot de passe du chef", code); assert.ok(c.acces); assert.strictEqual(c.exige2FA, false);
    assert.strictEqual((await s.appel("/api/auth/login", { methode: "POST", corps: { email: "direction@atlas.example", motDePasse: "mot de passe du chef", code } })).code, 401, "le même code ne sert pas deux fois");
    const d = (await s.appel("/api/donnees", { jeton: c.acces })).json; assert.strictEqual(d.collections.voyages.length, 2); assert.strictEqual(d.collections.voyages[0].prix, 4000); assert.strictEqual(d.collections.reglages.find((x) => x.id === "entreprise").tresorerie.solde, 60000); assert.strictEqual(d.collections.voyages[0]._v, 1);
    assert.ok((await s.appel("/api/journal", { jeton: c.acces })).json.journal.some((x) => x.action === "initialisation"));
    assert.strictEqual((await s.appel("/api/auth/me", { jeton: c.acces })).json.utilisateur.deuxFA, true);
  } finally { await s.arreter(); }
});

/** Relais prêt : chef connecté (2FA), comptes de chaque rôle créés. */
async function equipe(dossier = null, opts = {}) {
  const s = await demarrerMulti(dossier, opts);
  await s.appel("/api/auth/initialiser", { methode: "POST", jeton: "lit", corps: { nom: "Hassan", email: "chef@atlas.example", motDePasse: "mot de passe du chef", donnees: SEMENCE() } });
  let chef = await s.connexion("chef@atlas.example", "mot de passe du chef"); const i = (await s.appel("/api/auth/2fa/initier", { methode: "POST", jeton: chef.acces, corps: {} })).json;
  await s.appel("/api/auth/2fa/activer", { methode: "POST", jeton: chef.acces, corps: { code: A.totp(i.secret, s.horloge.t) } }); s.horloge.t += 31000;
  chef = await s.connexion("chef@atlas.example", "mot de passe du chef", A.totp(i.secret, s.horloge.t));
  const comptes = {};
  for (const [role, plus] of [["exploitant", { office: "allemagne" }], ["dispatcher", { office: "maroc" }], ["commercial", {}], ["comptable", {}], ["chauffeur", { chauffeurId: "h1" }], ["transitaire", {}]]) {
    const r = await s.appel("/api/utilisateurs", { methode: "POST", jeton: chef.acces, corps: { nom: role, email: `${role}@atlas.example`, role, motDePasse: `mot de passe ${role}`, ...plus } });
    assert.strictEqual(r.code, 201, JSON.stringify(r.json)); comptes[role] = r.json.utilisateur;
  }
  // le dossier d1 est confié au transitaire (son identifiant n'est connu qu'après la création du compte)
  const d1 = (await s.appel("/api/records/dossiers/d1", { jeton: chef.acces })).json.enregistrement;
  await s.appel("/api/records/dossiers/d1", { methode: "PUT", jeton: chef.acces, corps: { ...d1, transitaireId: comptes.transitaire.id }, entetes: { "if-match": String(d1._v) } });
  const jetons = { chef: chef.acces }; for (const role of Object.keys(comptes)) jetons[role] = (await s.connexion(`${role}@atlas.example`, `mot de passe ${role}`)).acces;
  return { ...s, comptes, jetons, secretChef: i.secret };
}

test("multi-utilisateur : droits appliqués par le serveur, appel direct à l'API (pas un menu caché)", async () => {
  const s = await equipe();
  try {
    const J = s.jetons, get = (q, j) => s.appel(q, { jeton: j });
    assert.strictEqual((await get("/api/records/factures", J.dispatcher)).code, 403, "répartiteur → factures : 403");
    const vd = (await get("/api/records/voyages", J.dispatcher)).json.enregistrements; assert.strictEqual(vd.length, 2); assert.ok(vd.every((v) => !("prix" in v) && !("lignesCout" in v) && !("fret" in (v.traversees?.[0] || {}))));
    const vc = (await get("/api/records/voyages", J.commercial)).json.enregistrements; assert.ok(vc.every((v) => !("lignesCout" in v)), "commercial : voyages sans dépenses ni marges");
    const vch = (await get("/api/records/voyages", J.chauffeur)).json.enregistrements; assert.deepStrictEqual(vch.map((v) => v.id), ["v1"], "chauffeur : ses voyages seulement");
    assert.strictEqual((await get("/api/records/voyages/v2", J.chauffeur)).code, 404); assert.deepStrictEqual((await get("/api/records/camions", J.chauffeur)).json.enregistrements.map((c) => c.id), ["c1"]);
    assert.deepStrictEqual((await get("/api/records/dossiers", J.transitaire)).json.enregistrements.map((d) => d.ref), ["DUM-1"], "transitaire : ses dossiers seulement"); assert.strictEqual((await get("/api/records/clients", J.transitaire)).code, 403);
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { methode: "DELETE", jeton: J.comptable, entetes: { "if-match": "1" } })).code, 403, "comptable → suppression d'un voyage : 403");
    const reg = (await get("/api/donnees", J.dispatcher)).json.collections; assert.ok(!("factures" in reg)); assert.ok(!("tresorerie" in reg.reglages.find((x) => x.id === "entreprise")));
    assert.strictEqual((await get("/api/utilisateurs", J.exploitant)).code, 403); assert.strictEqual((await get("/api/journal", J.dispatcher)).code, 403);
    // le répartiteur modifie un voyage sans voir les prix : les prix restent intacts
    const v1 = (await get("/api/records/voyages/v1", J.dispatcher)).json.enregistrement;
    const w = await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: J.dispatcher, corps: { ...v1, destination: "Lyon" }, entetes: { "if-match": String(v1._v) } }); assert.strictEqual(w.code, 200);
    const vu = (await get("/api/records/voyages/v1", J.chef)).json.enregistrement; assert.strictEqual(vu.destination, "Lyon"); assert.strictEqual(vu.prix, 4000); assert.strictEqual(vu.lignesCout.length, 1); assert.strictEqual(vu.traversees[0].fret, 320);
    // le comptable ajoute une dépense mais ne peut pas changer la destination ; le chauffeur marque une étape de SON voyage
    const w2 = await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: J.comptable, corps: { ...vu, destination: "Paris", lignesCout: [...vu.lignesCout, { id: "l2", type: "amendes", montant: 100 }] }, entetes: { "if-match": String(vu._v) } });
    assert.strictEqual(w2.json.enregistrement.destination, "Lyon"); assert.strictEqual(w2.json.enregistrement.lignesCout.length, 2);
    const vh = (await get("/api/records/voyages/v1", J.chauffeur)).json.enregistrement;
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: J.chauffeur, corps: { ...vh, jalons: [{ type: "depart", date: "2026-11-12T06:00:00Z" }], destination: "Ailleurs" }, entetes: { "if-match": String(vh._v) } })).json.enregistrement.destination, "Lyon");
    const v2 = (await get("/api/records/voyages/v2", J.chef)).json.enregistrement; assert.strictEqual((await s.appel("/api/records/voyages/v2", { methode: "PUT", jeton: J.chauffeur, corps: { ...v2, jalons: [{ type: "depart" }] }, entetes: { "if-match": String(v2._v) } })).code, 403, "voyage d'un autre chauffeur");
    assert.strictEqual((await s.appel("/api/records/factures/f9", { methode: "PUT", jeton: J.dispatcher, corps: { id: "f9" } })).code, 403);
    // suivi en direct : une session d'un rôle de suivi vaut le jeton de lecture ; pas celle d'un chauffeur
    assert.strictEqual((await get("/api/derniere", J.dispatcher)).code, 200); assert.strictEqual((await get("/api/derniere", J.chauffeur)).code, 401); assert.strictEqual((await s.appel("/api/derniere?token=lit")).code, 200, "l'ancien jeton marche toujours (applications installées)");
    // chaque refus est tracé
    const refus = (await get("/api/journal?action=refus", J.chef)).json.journal; assert.ok(refus.length >= 3); assert.ok(refus.some((x) => x.nom === "dispatcher" && x.col === "factures"));
  } finally { await s.arreter(); }
});

test("multi-utilisateur : accès par service réglés par le chef (lecture sans prix, aucun accès), appliqués aussitôt par le serveur, tracés, remis par défaut", async () => {
  const s = await equipe();
  try {
    const J = s.jetons, get = (q, j) => s.appel(q, { jeton: j }), put = (droits, j = J.chef) => s.appel("/api/droits", { methode: "PUT", jeton: j, corps: { droits } });
    assert.strictEqual((await get("/api/droits", J.dispatcher)).code, 403); assert.strictEqual((await put({}, J.exploitant)).code, 403, "réservé au chef");
    const d0 = (await get("/api/droits", J.chef)).json; assert.strictEqual(d0.effectifs.dispatcher.factures, "aucun"); assert.strictEqual(d0.effectifs.commercial.clients, "tout"); assert.strictEqual(d0.effectifs.dispatcher.voyages, "tout_sans_prix");
    const r = await put({ dispatcher: { factures: "lecture_sans_prix", voyages: "lecture_sans_prix" }, commercial: { clients: "aucun" }, chef_entreprise: { factures: "aucun" }, comptable: { reglages: "aucun", inconnu: "tout" } });
    assert.strictEqual(r.code, 200); assert.deepStrictEqual(r.json.droits, { dispatcher: { factures: "lecture_sans_prix", voyages: "lecture_sans_prix" }, commercial: { clients: "aucun" } }, "le chef n'est jamais restreint ; réglages toujours lisibles ; groupes inconnus écartés");
    assert.strictEqual((await get("/api/records/factures", J.dispatcher)).code, 200, "accès accordé : sans reconnexion");
    assert.strictEqual((await get("/api/records/clients", J.commercial)).code, 403, "accès retiré");
    assert.strictEqual((await get("/api/records/factures", J.chef)).code, 200);
    const v1 = (await get("/api/records/voyages/v1", J.dispatcher)).json.enregistrement; assert.ok(!("prix" in v1));
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: J.dispatcher, corps: { ...v1, destination: "Lyon" }, entetes: { "if-match": String(v1._v) } })).code, 403, "lecture seule : modification refusée");
    const don = (await get("/api/donnees", J.dispatcher)).json; assert.deepStrictEqual(don.droitsService, { factures: "lecture_sans_prix", voyages: "lecture_sans_prix" }); assert.ok("factures" in don.collections);
    assert.ok((await get("/api/journal?action=droits_modifies", J.chef)).json.journal.length === 1, "tracé au journal");
    await put({}); assert.strictEqual((await get("/api/records/factures", J.dispatcher)).code, 403, "remis par défaut"); assert.strictEqual((await get("/api/records/clients", J.commercial)).code, 200);
  } finally { await s.arreter(); }
});

test("multi-utilisateur : modifications concurrentes (409 avec l'état actuel), If-Match obligatoire, verrou de 30 s, suppression douce, changements depuis un instant", async () => {
  const s = await equipe();
  try {
    const J = s.jetons, put = (j, rec, v, plus = {}) => s.appel(`/api/records/voyages/${rec.id}`, { methode: "PUT", jeton: j, corps: rec, entetes: { "if-match": String(v), ...plus } });
    const a = (await s.appel("/api/records/voyages/v2", { jeton: J.chef })).json.enregistrement, b = (await s.appel("/api/records/voyages/v2", { jeton: J.exploitant })).json.enregistrement;
    const seq0 = (await s.appel("/api/changes?since=0", { jeton: J.exploitant })).json.seq;
    assert.strictEqual((await put(J.chef, { ...a, destination: "Marseille" }, a._v)).code, 200);
    const c = await put(J.exploitant, { ...b, destination: "Toulouse" }, b._v); assert.strictEqual(c.code, 409); assert.strictEqual(c.json.actuel.destination, "Marseille"); assert.strictEqual(c.json.par, "Hassan");
    assert.strictEqual((await s.appel("/api/records/voyages/v2", { methode: "PUT", jeton: J.exploitant, corps: b })).code, 428, "If-Match obligatoire");
    assert.strictEqual((await put(J.exploitant, { ...c.json.actuel, destination: "Toulouse" }, c.json.actuel._v)).code, 200, "fusion : on repart de l'état actuel");
    assert.strictEqual((await put(J.chef, { ...a, statut: "en_cours" }, "*")).code, 200, "écraser : choix explicite");
    const inchange = await put(J.chef, { ...(await s.appel("/api/records/voyages/v2", { jeton: J.chef })).json.enregistrement }, "*"); assert.strictEqual(inchange.json.inchange, true, "rien de changé : pas de nouvelle version");
    // verrou sur une opération sensible
    assert.strictEqual((await s.appel("/api/verrous", { methode: "POST", jeton: J.dispatcher, corps: { col: "voyages", id: "v2", raison: "livraison" } })).code, 200);
    const cur = (await s.appel("/api/records/voyages/v2", { jeton: J.chef })).json.enregistrement;
    const bloque = await put(J.chef, { ...cur, notes: "x" }, cur._v); assert.strictEqual(bloque.code, 423); assert.ok(/dispatcher est en train de modifier/.test(bloque.json.erreur));
    assert.strictEqual((await s.appel("/api/verrous", { methode: "POST", jeton: J.chef, corps: { col: "voyages", id: "v2" } })).code, 423);
    assert.strictEqual((await put(J.chef, { ...cur, notes: "forcé" }, cur._v, { "x-forcer": "1" })).code, 200, "on peut passer outre, en connaissance de cause");
    s.horloge.t += 31000; const cur2 = (await s.appel("/api/records/voyages/v2", { jeton: J.chef })).json.enregistrement; assert.strictEqual((await put(J.chef, { ...cur2, notes: "après" }, cur2._v)).code, 200, "verrou expiré après 30 s");
    assert.strictEqual((await s.appel("/api/records/voyages/v2", { methode: "DELETE", jeton: J.comptable })).code, 403);
    assert.strictEqual((await s.appel("/api/records/voyages/v2", { methode: "DELETE", jeton: J.exploitant, entetes: { "if-match": "*" } })).code, 200);
    assert.strictEqual((await s.appel("/api/records/voyages/v2", { jeton: J.chef })).code, 404, "supprimé pour tous");
    const ch = (await s.appel(`/api/changes?since=${seq0}`, { jeton: J.dispatcher })).json; assert.ok(ch.changements.some((x) => x.id === "v2" && x.supprime)); assert.ok(ch.seq > seq0);
    assert.strictEqual((await s.appel(`/api/changes?since=${ch.seq}`, { jeton: J.dispatcher })).json.changements.length, 0);
    assert.ok((await s.appel(`/api/changes?since=0`, { jeton: J.dispatcher })).json.changements.filter((x) => x.enregistrement).every((x) => !("prix" in x.enregistrement)), "les changements aussi sont filtrés");
    const j = (await s.appel("/api/journal?collection=voyages", { jeton: J.chef })).json.journal; assert.ok(["creation", "modification", "suppression", "conflit"].every((a) => j.some((x) => x.action === a) || a === "creation"));
    const mod = j.find((x) => x.action === "modification" && x.diff?.destination); assert.ok(Array.isArray(mod.diff.destination) && mod.diff.destination.length === 2, "avant / après");
    const csv = await s.appel("/api/journal?format=csv&collection=voyages", { jeton: J.chef }); assert.ok(/^\ufeff?date;utilisateur;action;collection;enregistrement;details/.test(csv.texte)); assert.ok(/suppression/.test(csv.texte));
  } finally { await s.arreter(); }
});

test("multi-utilisateur : mises à jour en direct (SSE) en moins d'une seconde, aux seuls rôles concernés", async () => {
  const s = await equipe(); const http = require("http");
  try {
    const flux = (jeton) => new Promise((ok) => { const evts = []; const req = http.get(s.base + "/api/sse", { headers: { authorization: `Bearer ${jeton}` } }, (res) => { res.setEncoding("utf8"); let t = ""; res.on("data", (c) => { t += c; let i; while ((i = t.indexOf("\n\n")) >= 0) { const bloc = t.slice(0, i); t = t.slice(i + 2); const ev = bloc.match(/^event: (.*)$/m)?.[1], d = bloc.match(/^data: (.*)$/m)?.[1]; if (ev) evts.push({ ev, d: JSON.parse(d), t: Date.now() }); } }); ok({ evts, fermer: () => req.destroy(), code: res.statusCode }); }); });
    const exp = await flux(s.jetons.exploitant), disp = await flux(s.jetons.dispatcher), tr = await flux(s.jetons.transitaire);
    assert.strictEqual(exp.code, 200); await new Promise((r) => setTimeout(r, 100)); assert.ok(exp.evts.some((e) => e.ev === "bonjour"));
    const v = (await s.appel("/api/records/voyages/v1", { jeton: s.jetons.chef })).json.enregistrement, t0 = Date.now();
    await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: s.jetons.chef, corps: { ...v, notes: "en direct" }, entetes: { "if-match": String(v._v) } });
    await new Promise((r) => setTimeout(r, 300));
    const e = exp.evts.find((x) => x.ev === "change"); assert.ok(e, "changement reçu"); assert.strictEqual(e.d.col, "voyages"); assert.strictEqual(e.d.id, "v1"); assert.strictEqual(e.d.par, "Hassan"); assert.ok(e.t - t0 < 1000, `${e.t - t0} ms`);
    assert.ok(disp.evts.some((x) => x.ev === "change")); assert.ok(tr.evts.some((x) => x.ev === "change"), "le transitaire voit les voyages qui lui sont confiés");
    const f = (await s.appel("/api/records/factures/f1", { jeton: s.jetons.chef })).json.enregistrement; await s.appel("/api/records/factures/f1", { methode: "PUT", jeton: s.jetons.chef, corps: { ...f, numero: "F-1b" }, entetes: { "if-match": String(f._v) } });
    await s.appel("/api/verrous", { methode: "POST", jeton: s.jetons.dispatcher, corps: { col: "voyages", id: "v1", raison: "livraison" } });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(exp.evts.some((x) => x.ev === "change" && x.d.col === "factures")); assert.ok(!disp.evts.some((x) => x.ev === "change" && x.d.col === "factures"), "le répartiteur n'est pas prévenu des factures");
    assert.ok(exp.evts.some((x) => x.ev === "verrou" && x.d.nom === "dispatcher"), "« X est en train de modifier » diffusé");
    exp.fermer(); disp.fermer(); tr.fermer(); await new Promise((r) => setTimeout(r, 100)); assert.strictEqual(s.multi.clientsSse.size, 0, "flux fermés retirés");
    assert.strictEqual((await s.appel("/api/sse")).code, 401);
  } finally { await s.arreter(); }
});

test("multi-utilisateur : comptes (création, rôle, clôture, réouverture), mot de passe changé = autres sessions coupées, blocage, réseau inhabituel, renouvellement", async () => {
  const s = await equipe();
  try {
    const J = s.jetons, liste = (await s.appel("/api/utilisateurs", { jeton: J.chef })).json.utilisateurs; assert.strictEqual(liste.length, 7); assert.ok(liste.every((u) => !("hash" in u) && !("totp" in u)), "aucun secret renvoyé");
    assert.strictEqual((await s.appel("/api/utilisateurs", { methode: "POST", jeton: J.chef, corps: { nom: "x", email: "dispatcher@atlas.example", role: "dispatcher", motDePasse: "douze caracteres" } })).code, 409);
    assert.strictEqual((await s.appel("/api/utilisateurs", { methode: "POST", jeton: J.chef, corps: { nom: "x", email: "y@atlas.example", role: "dispatcher", motDePasse: "court" } })).code, 400);
    const id = s.comptes.dispatcher.id;
    // changement de rôle : sessions coupées, nouveaux droits à la reconnexion
    assert.strictEqual((await s.appel(`/api/utilisateurs/${id}`, { methode: "PUT", jeton: J.chef, corps: { role: "exploitant" } })).json.utilisateur.role, "exploitant");
    assert.strictEqual((await s.appel("/api/donnees", { jeton: J.dispatcher })).code, 401);
    let t = (await s.connexion("dispatcher@atlas.example", "mot de passe dispatcher")).acces; assert.strictEqual((await s.appel("/api/records/voyages/v1", { jeton: t })).json.enregistrement.prix, 4000);
    // clôture puis réouverture
    await s.appel(`/api/utilisateurs/${id}`, { methode: "PUT", jeton: J.chef, corps: { cloture: true } });
    assert.strictEqual((await s.appel("/api/donnees", { jeton: t })).code, 401); assert.strictEqual((await s.appel("/api/auth/login", { methode: "POST", corps: { email: "dispatcher@atlas.example", motDePasse: "mot de passe dispatcher" } })).code, 401);
    await s.appel(`/api/utilisateurs/${id}`, { methode: "PUT", jeton: J.chef, corps: { cloture: false } }); assert.ok((await s.connexion("dispatcher@atlas.example", "mot de passe dispatcher")).acces);
    assert.strictEqual((await s.appel(`/api/utilisateurs/${(await s.appel("/api/auth/me", { jeton: J.chef })).json.utilisateur.id}`, { methode: "PUT", jeton: J.chef, corps: { role: "dispatcher" } })).code, 409, "il reste toujours un chef actif");
    // mot de passe changé : les autres sessions tombent, celle-ci reste
    const autre = (await s.connexion("comptable@atlas.example", "mot de passe comptable")).acces;
    assert.strictEqual((await s.appel("/api/auth/mot-de-passe", { methode: "POST", jeton: J.comptable, corps: { ancien: "faux", nouveau: "nouveau mot de passe" } })).code, 401);
    assert.strictEqual((await s.appel("/api/auth/mot-de-passe", { methode: "POST", jeton: J.comptable, corps: { ancien: "mot de passe comptable", nouveau: "nouveau mot de passe" } })).code, 200);
    assert.strictEqual((await s.appel("/api/auth/me", { jeton: autre })).code, 401); assert.strictEqual((await s.appel("/api/auth/me", { jeton: J.comptable })).code, 200);
    // blocage après 5 échecs
    for (let i = 0; i < 5; i++) assert.strictEqual((await s.appel("/api/auth/login", { methode: "POST", corps: { email: "commercial@atlas.example", motDePasse: "faux faux faux" } })).code, 401);
    const b = await s.appel("/api/auth/login", { methode: "POST", corps: { email: "commercial@atlas.example", motDePasse: "mot de passe commercial" } }); assert.strictEqual(b.code, 423, "bloqué même avec le bon mot de passe");
    s.horloge.t += 16 * 60000; assert.ok((await s.connexion("commercial@atlas.example", "mot de passe commercial")).acces);
    for (let i = 0; i < 10; i++) await s.appel("/api/auth/login", { methode: "POST", ip: "203.0.113.9", corps: { email: "personne@atlas.example", motDePasse: "x" } });
    assert.strictEqual((await s.appel("/api/auth/login", { methode: "POST", ip: "203.0.113.9", corps: { email: "personne@atlas.example", motDePasse: "x" } })).code, 429);
    // réseau inhabituel : le chef est alerté
    const alertesTr = async () => (await s.appel("/api/alertes/historique", { jeton: J.chef })).json.alertes.filter((a) => /transitaire/.test(a.texte)).length;
    await s.connexion("transitaire@atlas.example", "mot de passe transitaire", undefined, "41.250.1.1"); const n1 = await alertesTr(); assert.strictEqual(n1, 1, "premier passage par ce réseau : alerte");
    await s.connexion("transitaire@atlas.example", "mot de passe transitaire", undefined, "41.250.7.7"); assert.strictEqual(await alertesTr(), n1, "même réseau (41.250.x) : pas de nouvelle alerte");
    await s.connexion("transitaire@atlas.example", "mot de passe transitaire", undefined, "185.10.4.4");
    assert.ok((await s.appel("/api/alertes/historique", { jeton: J.chef })).json.alertes.some((a) => /transitaire depuis un réseau inhabituel \(185\.10\.x\)/.test(a.texte)), "alerte dans l'historique du relais (visible sur tous les appareils)");
    // renouvellement de session par l'API, puis déconnexion
    const c = await s.connexion("exploitant@atlas.example", "mot de passe exploitant"); const r = await s.appel("/api/auth/refresh", { methode: "POST", corps: { renouvellement: c.renouvellement } });
    assert.strictEqual(r.code, 200); assert.ok(r.json.acces !== c.acces); assert.strictEqual((await s.appel("/api/auth/me", { jeton: c.acces })).code, 401);
    assert.strictEqual((await s.appel("/api/auth/refresh", { methode: "POST", corps: { renouvellement: c.renouvellement } })).code, 401); assert.strictEqual((await s.appel("/api/auth/me", { jeton: r.json.acces })).code, 401, "jeton réutilisé : la famille est révoquée");
    const c2 = await s.connexion("exploitant@atlas.example", "mot de passe exploitant"); await s.appel("/api/auth/logout", { methode: "POST", jeton: c2.acces, corps: {} }); assert.strictEqual((await s.appel("/api/auth/me", { jeton: c2.acces })).code, 401);
    assert.ok((await s.appel("/api/journal?action=echec_connexion", { jeton: J.chef })).json.journal.length >= 5);
  } finally { await s.arreter(); }
});

test("multi-utilisateur : cookie de session (HttpOnly, SameSite) et protection intersite, application servie par le relais, rien d'autre", async () => {
  const s = await equipe();
  try {
    const r = await s.appel("/api/auth/login", { methode: "POST", corps: { email: "exploitant@atlas.example", motDePasse: "mot de passe exploitant" } });
    const ck = r.entetes.getSetCookie(); assert.ok(ck.some((c) => /^lf_acces=.+HttpOnly; SameSite=Strict/.test(c))); assert.ok(ck.some((c) => /^lf_renouv=.+Path=\/api\/auth/.test(c)));
    const cookie = ck.map((c) => c.split(";")[0]).join("; ");
    assert.strictEqual((await s.appel("/api/donnees", { entetes: { cookie } })).code, 200, "lecture avec le cookie");
    const v = (await s.appel("/api/records/voyages/v1", { entetes: { cookie } })).json.enregistrement;
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { methode: "PUT", corps: v, entetes: { cookie, "if-match": String(v._v) } })).code, 403, "écriture avec cookie sans en-tête X-LF : refusée (requête intersite)");
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { methode: "PUT", corps: { ...v, notes: "ok" }, entetes: { cookie, "if-match": String(v._v), "x-lf": "1" } })).code, 200);
    const page = await s.appel("/"); assert.strictEqual(page.code, 200); assert.ok(page.texte.includes("<html")); assert.ok(page.texte.includes('<meta name="lf-multi" content="1">'), "page marquée : l'application sait qu'elle doit demander une connexion"); assert.ok(/text\/html/.test(page.entetes.get("content-type")));
    assert.strictEqual((await s.appel("/app.js")).code, 200); assert.strictEqual((await s.appel("/vendor/leaflet/leaflet.js")).code, 200);
    const sw = await s.appel("/sw.js"); assert.ok(!sw.texte.includes("__VERSION__") && /relais-test-[0-9a-f]{8}/.test(sw.texte), "version du cache renseignée");
    // préchargement hors ligne servi en entier (polices, module IA compris) ; empreintes = fichiers tels que servis ; « inchangé » sur revalidation
    const emp = JSON.parse(sw.texte.match(/const EMPREINTES = (\{.*?\});/)[1]);
    assert.strictEqual(emp["./"], crypto.createHash("sha256").update(page.texte).digest("hex").slice(0, 16), "empreinte de la page d'accueil telle que servie (avec la marque multi)");
    for (const f of ["vendor/fonts/general-sans-500.woff2", "vendor/fonts/noto-sans-arabic.woff2", "vendor/leaflet/leaflet.css"]) assert.ok(/^[0-9a-f]{16}$/.test(emp[f]), f);
    const police = await s.appel("/vendor/fonts/general-sans-600.woff2"); assert.strictEqual(police.code, 200, "polices servies (sinon le préchargement hors ligne échoue)"); assert.strictEqual(police.entetes.get("content-type"), "font/woff2");
    assert.strictEqual((await s.appel("/vendor/anthropic-sdk.js")).code, 200, "module IA servi");
    const etag = (await s.appel("/app.js")).entetes.get("etag"); assert.ok(etag);
    assert.strictEqual((await s.appel("/app.js", { entetes: { "if-none-match": etag } })).code, 304, "fichier inchangé : rien à renvoyer");
    assert.strictEqual((await s.appel("/vendor/fonts/../../serveur/relais.js")).code === 200, false);
    for (const interdit of ["/serveur/relais.js", "/package.json", "/tests/relais.test.js", "/../etc/passwd", "/.git/config", "/serveur/donnees/comptes.json"]) assert.ok([401, 404].includes((await s.appel(interdit)).code), interdit);
  } finally { await s.arreter(); }
});

test("veille du relais : chauffeur prévenu avant la pause (sa langue, heure du bureau), une seule fois ; bureau alerté si la pause est dépassée ; passages aux quais gardés ; persistance", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "relais-veille-")), appels = [];
  const http_ = async (url, o) => { appels.push({ url, corps: String(o.body || ""), titre: o.headers?.Title }); return { ok: true, status: 200 }; };
  const opts = { http_, canaux: { ntfy: { url: "https://ntfy.sh/atlas-bureau-x9k2" } } };
  let s = await demarrer(dossier, opts); const T = Math.floor(Date.now() / 1000), SITE = [36.0, -5.6];
  // 1 h 55 à l'arrêt sur le site de livraison, puis 4 h 05 de route à 80 km/h (une position toutes les 5 min)
  const pos = []; for (let k = 0; k <= 23; k++) pos.push({ id: "B1", t: T - 6 * 3600 + k * 300, lat: SITE[0] + (k % 2) * 0.0002, lon: SITE[1], v: 0 });
  for (let k = 1; k <= 49; k++) pos.push({ id: "B1", t: T - 6 * 3600 + 23 * 300 + k * 300, lat: SITE[0] + k * 0.06, lon: SITE[1] + k * 0.01, v: 80 });
  s.enregistrer(pos);
  try {
    const liste = { fuseau: "Africa/Casablanca", voyages: [
      { id: "v1", reference: "V-2026-0041", balise: "B1", jusqua: T + 86400, coupures: { chauffeur: "Youssef", langue: "ar", avantMin: 30, canal: "ntfy", destination: "https://ntfy.sh/youssef-camion-1", equipe: true }, quais: [{ cle: "o1:livraison", lat: SITE[0], lon: SITE[1], depuis: T - 86400 }] },
      { id: "v2", reference: "V-2", balise: "B2", coupures: { canal: "ntfy", destination: "https://evil.example/abcdefgh" } },
      { id: "v3", balise: "B3", jusqua: T - 10 },
    ] };
    assert.strictEqual((await s.appel("/api/veille", { methode: "PUT", jeton: "ecrit", corps: liste })).code, 401, "le jeton des balises ne règle rien");
    const r = await s.appel("/api/veille", { methode: "PUT", jeton: "lit", corps: liste });
    assert.strictEqual(r.code, 200); assert.strictEqual(r.json.voyages, 2, "voyage terminé écarté"); assert.strictEqual(r.json.coupures, 1); assert.strictEqual(r.json.quais, 1);
    assert.ok(r.json.refus.some((x) => x.id === "v2" && /non autorisé/.test(x.raison)), "canal du chauffeur refusé, le voyage reste surveillé pour le bureau");
    let j = await s.veille.verifier(T * 1000);
    const pause = j.find((x) => x.type === "pause"); assert.ok(pause && pause.statut === "envoye", JSON.stringify(j));
    const msg = appels.find((a) => a.url === "https://ntfy.sh/youssef-camion-1"); assert.ok(msg && /استراحة 45 دقيقة/.test(msg.corps), "message au chauffeur, en arabe");
    const attendue = new Date((T + 25 * 60) * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca" }); assert.ok(msg.corps.includes(attendue), `heure du bureau ${attendue} : ${msg.corps}`);
    assert.ok(/google\.com\/maps\/search\/aire\+poids\+lourds/.test(msg.corps), "lien des aires poids lourds");
    const quai = j.find((x) => x.quai === "o1:livraison"); assert.strictEqual(quai.arrivee, T - 6 * 3600); assert.strictEqual(quai.depart, T - 6 * 3600 + 24 * 300, "départ : première position hors du site");
    assert.strictEqual((await s.veille.verifier(T * 1000 + 60000)).filter((x) => x.type).length, 0, "pas deux fois le même message");
    assert.strictEqual((await s.veille.verifier((T + 600) * 1000)).filter((x) => x.type).length, 0, "l'heure prévue glisse sans nouvelle position : toujours un seul message");
    const lu = await s.appel("/api/veille", { jeton: "lit" }); assert.strictEqual(lu.json.quais["o1:livraison"].depart, T - 6 * 3600 + 24 * 300); assert.ok(Object.keys(lu.json.envoyes).includes("v1:pause"));
    assert.strictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.veille.voyages, 2);
    // la route continue 50 min sans pause : le bureau est alerté une fois
    const T2 = T + 50 * 60; const suite = []; for (let k = 1; k <= 10; k++) suite.push({ id: "B1", t: T + k * 300, lat: SITE[0] + (49 + k) * 0.06, lon: SITE[1] + (49 + k) * 0.01, v: 80 }); s.enregistrer(suite);
    j = await s.veille.verifier(T2 * 1000);
    const dep = j.find((x) => x.type === "depasse"); assert.ok(dep && dep.statut === "envoye", JSON.stringify(j));
    const bureau = appels.filter((a) => a.url === "https://ntfy.sh/atlas-bureau-x9k2"); assert.strictEqual(bureau.length, 1); assert.ok(/V-2026-0041 · Youssef : 4 h 5\d de conduite sans pause de 45 min \(estimation GPS/.test(bureau[0].corps), bureau[0].corps);
    assert.strictEqual((await s.veille.verifier(T2 * 1000 + 60000)).filter((x) => x.type === "depasse").length, 0, "une seule alerte jusqu'à la pause");
    const hist = await s.appel("/api/alertes", { jeton: "lit" }); if (hist.code === 200) assert.ok(JSON.stringify(hist.json).includes("sans pause de 45 min"), "alerte gardée dans l'historique du relais");
    // pause de 50 min : la prochaine alerte redevient possible
    const arret = []; for (let k = 1; k <= 10; k++) arret.push({ id: "B1", t: T2 + k * 300, lat: SITE[0] + 59 * 0.06, lon: SITE[1] + 59 * 0.01, v: 0 }); s.enregistrer(arret);
    await s.veille.verifier((T2 + 3000) * 1000); assert.ok(!Object.keys(s.veille.lire().envoyes).includes("v1:depasse")); assert.ok(!Object.keys(s.veille.lire().envoyes).includes("v1:pause"), "pause faite : le prochain message de pause redevient possible");
    // redémarrage : la liste et les messages déjà envoyés sont repris
    const envoyesAvant = JSON.stringify(s.veille.lire().envoyes);
    await s.arreter(); s = await demarrer(dossier, opts); s.enregistrer(pos);
    assert.strictEqual(JSON.stringify(s.veille.lire().envoyes), envoyesAvant, "messages déjà envoyés repris (rien ne repart)");
    assert.strictEqual(s.veille.lire().voyages.length, 2); assert.deepStrictEqual(s.veille.lire().quais["o1:livraison"].depart, T - 6 * 3600 + 24 * 300, "passages repris");
  } finally { await s.arreter(); }
});

test("hors ligne : la liste préchargée couvre chaque script de la page et la carte ; empreintes de chaque fichier posées à la publication", () => {
  const { fichiersPrecharges, preparerSw, empreinte } = require("../serveur/empreintes.js"), racine = path.join(__dirname, "..");
  const sw = fs.readFileSync(path.join(racine, "sw.js"), "utf8"), liste = fichiersPrecharges(sw), html = fs.readFileSync(path.join(racine, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...scripts, ...styles].filter((f) => !liste.includes(f)), [], "un script de la page manque au hors ligne");
  for (const f of ["vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/fonts/noto-sans-arabic.woff2", "./", "index.html"]) assert.ok(liste.includes(f), f);
  assert.ok(!scripts.includes("vendor/leaflet/leaflet.js"), "la carte se charge à la demande, pas au démarrage");
  assert.ok(!liste.includes("vendor/anthropic-sdk.js"), "module IA : gardé à la première utilisation (il demande internet de toute façon)");
  assert.deepStrictEqual(liste.filter((f) => !fs.existsSync(path.join(racine, f === "./" ? "index.html" : f))), [], "fichier préchargé absent du dépôt");
  const pret = preparerSw(sw, "abc1234567", (f) => fs.readFileSync(path.join(racine, f)));
  assert.ok(pret.includes('const VERSION = "abc1234567"'));
  const emp = JSON.parse(pret.match(/const EMPREINTES = (\{.*?\});/)[1]);
  assert.deepStrictEqual(Object.keys(emp), liste);
  assert.strictEqual(emp["app.js"], empreinte(fs.readFileSync(path.join(racine, "app.js")))); assert.strictEqual(emp["./"], emp["index.html"]);
  assert.throws(() => preparerSw(sw, "v", (f) => (f === "style.css" ? null : Buffer.from("x"))), /style\.css/);
});

test("multi-utilisateur : tout survit à un redémarrage (chiffré au repos), réinitialisation par e-mail, clé de récupération du chef", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "relais-multi-")), coffre = chargerCoffre(d, { CHIFFRER_DONNEES: "true", CLE_DONNEES: "phrase secrete du relais multi" }).coffre, smtp = { hote: "smtp.exemple.org", de: "relais@atlas.example" };
  try {
    let s = await demarrerMulti(d, { coffre, smtp });
    const code = (await s.appel("/api/auth/initialiser", { methode: "POST", jeton: "lit", corps: { nom: "Hassan", email: "chef@atlas.example", motDePasse: "mot de passe du chef", donnees: SEMENCE() } })).json.codeRecuperation;
    let chef = await s.connexion("chef@atlas.example", "mot de passe du chef"); const sec = (await s.appel("/api/auth/2fa/initier", { methode: "POST", jeton: chef.acces, corps: {} })).json.secret;
    await s.appel("/api/auth/2fa/activer", { methode: "POST", jeton: chef.acces, corps: { code: A.totp(sec, s.horloge.t) } });
    await s.appel("/api/utilisateurs", { methode: "POST", jeton: chef.acces, corps: { nom: "Samira", email: "samira@atlas.example", role: "exploitant", office: "allemagne", motDePasse: "mot de passe samira" } });
    const sam = await s.connexion("samira@atlas.example", "mot de passe samira"); const v = (await s.appel("/api/records/voyages/v1", { jeton: sam.acces })).json.enregistrement;
    await s.appel("/api/records/voyages/v1", { methode: "PUT", jeton: sam.acces, corps: { ...v, notes: "note confidentielle Francfort" }, entetes: { "if-match": String(v._v) } });
    await new Promise((r) => setTimeout(r, 300)); await s.arreter();
    for (const f of ["comptes.json", "sessions.json", "audit.jsonl", "base/voyages.json"]) { const b = fs.readFileSync(path.join(d, f)).toString("latin1"); for (const mot of ["samira@atlas", "Francfort", "Primeurs", "scrypt$"]) assert.ok(!b.includes(mot), `${f} : « ${mot} » en clair`); }
    s = await demarrerMulti(d, { coffre, smtp });
    assert.strictEqual((await s.appel("/api/records/voyages/v1", { jeton: sam.acces })).json.enregistrement.notes, "note confidentielle Francfort", "session, compte et données conservés");
    // mot de passe oublié : e-mail avec un lien d'une heure, à usage unique
    assert.strictEqual((await s.appel("/api/auth/reinitialiser", { methode: "POST", corps: { email: "inconnu@atlas.example" } })).code, 200, "même réponse pour une adresse inconnue");
    await s.appel("/api/auth/reinitialiser", { methode: "POST", corps: { email: "samira@atlas.example" } }); assert.strictEqual(s.mails.length, 1); const lien = s.mails[0].texte.match(/#reinitialiser=([\w-]+)/)[1];
    assert.strictEqual((await s.appel("/api/auth/reinitialiser/confirmer", { methode: "POST", corps: { jeton: lien, motDePasse: "nouveau mot de passe samira" } })).code, 200);
    assert.strictEqual((await s.appel("/api/auth/reinitialiser/confirmer", { methode: "POST", corps: { jeton: lien, motDePasse: "encore un autre mot" } })).code, 400, "lien à usage unique");
    assert.strictEqual((await s.appel("/api/auth/me", { jeton: sam.acces })).code, 401, "anciennes sessions coupées"); assert.ok((await s.connexion("samira@atlas.example", "nouveau mot de passe samira")).acces);
    // le chef a tout perdu (mot de passe et téléphone) : la clé de récupération
    assert.strictEqual((await s.appel("/api/auth/recuperation", { methode: "POST", corps: { code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", motDePasse: "nouveau mot de passe chef" } })).code, 401);
    const rec = await s.appel("/api/auth/recuperation", { methode: "POST", corps: { code: code.toLowerCase().replace(/-/g, " "), motDePasse: "nouveau mot de passe chef" } }); assert.strictEqual(rec.code, 200); assert.notStrictEqual(rec.json.codeRecuperation, code);
    chef = await s.connexion("chef@atlas.example", "nouveau mot de passe chef"); assert.strictEqual(chef.exige2FA, true, "double authentification à refaire");
    assert.strictEqual((await s.appel("/api/auth/recuperation", { methode: "POST", corps: { code, motDePasse: "encore un autre mot" } })).code, 401, "l'ancienne clé ne sert plus");
    const j = s.multi.lireAudit().map((x) => x.action); for (const a of ["initialisation", "compte_cree", "connexion", "modification", "reinitialisation_demandee", "mot_de_passe_reinitialise", "echec_recuperation", "recuperation"]) assert.ok(j.includes(a), a);
    await s.arreter();
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("prix du jour : taux Bank Al-Maghrib, gazole Espagne (Cadix, Algeciras) et France (poids lourds, Pyrénées-Orientales), archive ZIP", () => {
  const html = '<p>Date : 12/11/2026</p><tr><td><a title="1 EURO (EUR)" href="/graph/currency/eur">1 EURO</a></td><td>10,9124</td></tr><tr><td>1 DOLLAR</td><td>9,1</td></tr>';
  assert.deepStrictEqual(M.lireTauxBam(html), { taux: 10.9124, date: "2026-11-12" }); assert.strictEqual(M.lireTauxBam("<p>rien</p>"), null); assert.strictEqual(M.lireTauxBam('1 EURO (EUR) 999,9'), null, "valeur absurde refusée");
  const es = { Fecha: "12/11/2026 23:45:13", ListaEESSPrecio: [
    { "Precio Gasoleo A": "1,850", IDProvincia: "11", Municipio: "Algeciras" }, { "Precio Gasoleo A": "1,900", IDProvincia: "11", Municipio: "San Roque" }, { "Precio Gasoleo A": "1,800", IDProvincia: "11", Municipio: "Cádiz" },
    { "Precio Gasoleo A": "1,700", IDProvincia: "28", Municipio: "Madrid" }, { "Precio Gasoleo A": "", IDProvincia: "28", Municipio: "Madrid" } ] };
  assert.deepStrictEqual(M.lireGazoleEspagne(es), { prix: 1.825, n: 4, cadix: 1.85, algeciras: 1.875, nAlgeciras: 2, date: "2026-11-12", unite: "EUR/L" });
  const xml = `<pdv_liste><pdv id="1" cp="66160"><services><service>Piste poids lourds</service></services><prix nom="Gazole" id="1" maj="2026-11-12 06:55:20" valeur="2.109"/></pdv>
    <pdv id="2" cp="75001"><prix nom="Gazole" id="1" maj="2026-11-11 08:00:00" valeur="2.199"/><prix nom="SP95" maj="2026-11-11 08:00:00" valeur="1.9"/></pdv>
    <pdv id="3" cp="13001"><services><service>Piste poids lourds</service></services><prix nom="Gazole" id="1" maj="2026-10-01 08:00:00" valeur="1.5"/></pdv></pdv_liste>`;
  const fr = M.lireGazoleFrance(xml, Date.parse("2026-11-13T00:00:00Z"));
  assert.deepStrictEqual(fr, { prix: 2.154, n: 2, poidsLourds: 2.109, nPoidsLourds: 1, pyreneesOrientales: 2.109, date: "2026-11-12", unite: "EUR/L" }, "prix de plus de 8 jours écarté");
  // archive ZIP (deflate) construite à la main, comme celle du site
  const zlib = require("zlib"), nom = Buffer.from("PrixCarburants_instantane.xml"), brut = Buffer.from(xml, "latin1"), comp = zlib.deflateRawSync(brut);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nom.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(brut.length, 24); cd.writeUInt16LE(nom.length, 28); cd.writeUInt32LE(0, 42);
  const debutCd = 30 + nom.length + comp.length, fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + nom.length, 12); fin.writeUInt32LE(debutCd, 16);
  const zip = Buffer.concat([local, nom, comp, cd, nom, fin]);
  assert.strictEqual(M.premierFichierZip(zip).toString("latin1"), xml); assert.throws(() => M.premierFichierZip(Buffer.from("pas un zip")), /ZIP/);
  assert.strictEqual(M.mediane([3, 1, 2]), 2); assert.strictEqual(M.mediane([]), null);
});

test("prix du jour : route du relais, cache de 6 h, actualisation forcée, une source en panne n'efface pas les autres", async () => {
  let appels = 0, panne = false;
  const marches_ = async () => { appels++; return panne ? { maj: Date.now(), taux: null, carburant: { FR: { prix: 2.2 } }, erreurs: ["Bank Al-Maghrib : réponse 503"] } : { maj: Date.now(), taux: { eurMad: 10.9124, date: "2026-11-12", source: "Bank Al-Maghrib (cours de référence)", officiel: true }, carburant: { ES: { prix: 1.869 }, FR: { prix: 2.149 } }, erreurs: [] }; };
  const s = await demarrer(null, { marches_ });
  try {
    assert.strictEqual((await s.appel("/api/marches")).code, 401);
    let r = (await s.appel("/api/marches", { jeton: "lit" })).json; assert.strictEqual(r.taux.eurMad, 10.9124); assert.strictEqual(r.carburant.ES.prix, 1.869);
    await s.appel("/api/marches", { jeton: "lit" }); assert.strictEqual(appels, 1, "en cache");
    panne = true; r = (await s.appel("/api/marches?actualiser=1", { jeton: "lit" })).json; assert.strictEqual(appels, 2);
    assert.strictEqual(r.taux.eurMad, 10.9124, "taux précédent gardé si Bank Al-Maghrib est injoignable"); assert.strictEqual(r.carburant.FR.prix, 2.2); assert.strictEqual(r.carburant.ES.prix, 1.869); assert.ok(r.erreurs[0].includes("503"));
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

/* ---------- boîte des demandes : lecture des e-mails, relève IMAP, routes ---------- */
const CRLF = (t) => t.replace(/\r?\n/g, "\r\n");
const MAIL_QP = CRLF(`From: =?UTF-8?Q?Karim_Ben=C3=A9?= <achats@primeurs-souss.ma>
To: contact@atlas-fret.ma
Subject: =?UTF-8?B?RGVtYW5kZSBkZSB0cmFuc3BvcnQg4oCUIGNsw6ltZW50aW5lcw==?=
Date: Tue, 17 Nov 2026 08:14:00 +0100
Message-ID: <abc123@primeurs-souss.ma>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="ext"

--ext
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Bonjour,=0A26 palettes de cl=C3=A9mentines, chargement jeudi =C3=A0 Agadir, livraison Perpig=
nan lundi. Temp=C3=A9rature 4 =C2=B0C. Quel est votre prix ?

Le lun. 9 nov. 2026 =C3=A0 10:02, Atlas Fret <contact@atlas-fret.ma> a =C3=A9crit :
> Prix : 1 900 =E2=82=AC pour Lyon
--alt
Content-Type: text/html; charset="utf-8"

<p>Bonjour</p>
--alt--
--ext
Content-Type: application/pdf; name="=?UTF-8?Q?liste_colisage_n=C2=B012.pdf?="
Content-Disposition: attachment; filename*=utf-8''liste%20colisage%20n%C2%B012.pdf
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--ext--
`);
const MAIL_HTML = CRLF(`From: "Logistica Iberia" <trafico@logistica-iberia.es>
Subject: =?iso-8859-1?Q?Cotizaci=F3n_cami=F3n_frigor=EDfico?=
Date: Wed, 18 Nov 2026 09:00:00 +0000
Content-Type: text/html; charset=windows-1252
Content-Transfer-Encoding: base64

${Buffer.from("<html><head><style>p{color:red}</style></head><body><p>Hola,</p><p>Necesitamos un cami&oacute;n de Murcia a Casablanca, 33 palets, 20/11.<br>Precio&nbsp;?</p></body></html>", "latin1").toString("base64")}
`);

test("boîte des demandes : lecture d'un e-mail — mots encodés, quoted-printable, HTML seul, windows-1252, historique cité coupé, pièce jointe nommée, réponses automatiques", () => {
  const { lireCourriel, decoderEntete, couperHistorique } = require("../serveur/mime.js");
  const a = lireCourriel(Buffer.from(MAIL_QP, "latin1"));
  assert.deepStrictEqual(a.de, { nom: "Karim Bené", email: "achats@primeurs-souss.ma" }); assert.strictEqual(a.sujet, "Demande de transport — clémentines"); assert.strictEqual(a.messageId, "abc123@primeurs-souss.ma");
  assert.strictEqual(a.date, "2026-11-17T07:14:00.000Z"); assert.ok(/26 palettes de clémentines, chargement jeudi à Agadir, livraison Perpignan lundi\. Température 4 °C/.test(a.texte), a.texte);
  assert.ok(!/1 900/.test(a.texte) && !/a écrit/.test(a.texte), "l'ancien message cité n'est pas repris");
  assert.deepStrictEqual(a.pieces.map((x) => x.nom), ["liste colisage n°12.pdf"]); assert.strictEqual(a.masse, false); assert.strictEqual(a.auto, false);
  const b = lireCourriel(MAIL_HTML);
  assert.strictEqual(b.sujet, "Cotización camión frigorífico"); assert.strictEqual(b.de.email, "trafico@logistica-iberia.es"); assert.ok(/Necesitamos un camión de Murcia a Casablanca, 33 palets, 20\/11\.\nPrecio \?/.test(b.texte), b.texte); assert.ok(!/color/.test(b.texte));
  assert.strictEqual(decoderEntete("=?utf-8?B?w6k=?= =?utf-8?B?w6k=?= suite"), "éé suite", "mots encodés voisins collés");
  assert.strictEqual(couperHistorique("Merci\n\nDe : X\nEnvoyé : lundi\nObjet : ancien"), "Merci"); assert.strictEqual(couperHistorique("> cité\nNouveau"), "> cité\nNouveau", "une citation en tête est gardée");
  const auto = lireCourriel(CRLF("From: a@b.ma\nSubject: Réponse automatique : absent\nAuto-Submitted: auto-replied\n\nJe suis absent.")); assert.strictEqual(auto.auto, true);
  assert.strictEqual(lireCourriel(CRLF("From: news@x.com\nList-Unsubscribe: <mailto:u@x.com>\n\nPromo")).masse, true);
});

/** Faux serveur IMAP local : une boîte de messages { uid, brut } ; enregistre les commandes reçues. */
async function fauxImap({ messages, uidValidite = 7, motDePasse = "app-pass" }) {
  const net = require("net"), commandes = [];
  const serveur = net.createServer((c) => {
    let tampon = ""; c.write("* OK [CAPABILITY IMAP4rev1] faux.imap pret\r\n");
    c.on("data", (b) => {
      tampon += b.toString("latin1"); let i;
      while ((i = tampon.indexOf("\r\n")) >= 0) {
        const l = tampon.slice(0, i); tampon = tampon.slice(i + 2); commandes.push(l); const [tag, cmd, ...reste] = l.split(" ");
        if (cmd === "LOGIN") c.write(reste[1] === `"${motDePasse}"` ? `${tag} OK connecte\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        else if (cmd === "EXAMINE") c.write(`* ${messages.length} EXISTS\r\n* OK [UIDVALIDITY ${uidValidite}] UIDs valid\r\n${tag} OK [READ-ONLY] EXAMINE fait\r\n`);
        else if (cmd === "UID" && reste[0] === "SEARCH") { const m = l.match(/UID (\d+):\*$/); const l2 = m ? messages.filter((x) => x.uid >= Number(m[1])) : messages; c.write(`* SEARCH ${(l2.length ? l2 : m ? [messages[messages.length - 1]] : []).map((x) => x.uid).join(" ")}\r\n${tag} OK recherche\r\n`); }
        else if (cmd === "UID" && reste[0] === "FETCH") {
          const partiel = l.match(/BODY\.PEEK\[\]<0\.(\d+)>/); // lecture partielle (<0.N>) ou message entier
          for (const u of reste[1].split(",").map(Number)) { const m = messages.find((x) => x.uid === u), tout = Buffer.from(m.brut, "latin1"), o = partiel ? tout.subarray(0, Number(partiel[1])) : tout; c.write(Buffer.concat([Buffer.from(`* ${u} FETCH (RFC822.SIZE ${tout.length} BODY[]${partiel ? "<0>" : ""} {${o.length}}\r\n`, "latin1"), o, Buffer.from(` UID ${u})\r\n`)])); }
          c.write(`${tag} OK fetch\r\n`);
        } else if (cmd === "LOGOUT") { c.write(`* BYE\r\n${tag} OK au revoir\r\n`); c.end(); }
        else c.write(`${tag} BAD inconnu\r\n`);
      }
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { commandes, port: serveur.address().port, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("boîte des demandes : relève IMAP en lecture seule — EXAMINE et BODY.PEEK, première relève sur 3 jours puis seulement les nouveaux, mauvais mot de passe expliqué", async () => {
  const { releverBoite } = require("../serveur/imap.js");
  const msgs = [{ uid: 41, brut: MAIL_QP }, { uid: 42, brut: MAIL_HTML }], f = await fauxImap({ messages: msgs });
  const cfg = { hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "contact@atlas-fret.ma", motDePasse: "app-pass", maintenant: Date.parse("2026-11-17T10:00:00Z") };
  try {
    const r = await releverBoite(cfg);
    assert.deepStrictEqual([r.uidValidite, r.dernierUid, r.messages.map((m) => m.uid)], [7, 42, [41, 42]]); assert.ok(r.messages[0].brut.toString("latin1").includes("Message-ID: <abc123@"));
    assert.ok(f.commandes.some((c) => / EXAMINE "INBOX"$/.test(c)) && !f.commandes.some((c) => / SELECT /.test(c)), "dossier ouvert en lecture seule");
    assert.ok(f.commandes.some((c) => /UID SEARCH SINCE 14-Nov-2026$/.test(c))); assert.ok(f.commandes.some((c) => /UID FETCH 41,42 \(UID RFC822\.SIZE BODY\.PEEK\[\]<0\.300000>\)/.test(c)), "BODY.PEEK : rien n'est marqué lu");
    const r2 = await releverBoite({ ...cfg, depuisUid: 42, uidValidite: 7 }); assert.deepStrictEqual([r2.messages.length, r2.dernierUid], [0, 42], "« 43:* » renvoie le dernier message : il est écarté");
    msgs.push({ uid: 43, brut: MAIL_QP.replace("abc123", "def456") }); const r3 = await releverBoite({ ...cfg, depuisUid: 42, uidValidite: 7 }); assert.deepStrictEqual(r3.messages.map((m) => m.uid), [43]);
    await assert.rejects(releverBoite({ ...cfg, motDePasse: "faux" }), /Connexion refusée par la boîte \(\[AUTHENTICATIONFAILED\] Invalid credentials\)/);
    await assert.rejects(releverBoite({ ...cfg, motDePasse: "mot é" }), /mot de passe d'application/);
    await assert.rejects(releverBoite({ ...cfg, port: 1 }), /injoignable/);
  } finally { await f.fermer(); }
});

test("boîte des demandes : le relais relève, écarte nos messages et les doublons, garde l'erreur lisible ; routes protégées par le jeton", async () => {
  const msgs = [{ uid: 41, brut: MAIL_QP }, { uid: 42, brut: MAIL_HTML }, { uid: 43, brut: CRLF("From: contact@atlas-fret.ma\nSubject: copie envoyée\n\nRe: devis") }, { uid: 44, brut: MAIL_QP }], f = await fauxImap({ messages: msgs });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "boite-"));
  const imap = { hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "contact@atlas-fret.ma", motDePasse: "app-pass" };
  const s = await demarrer(dossier, { imap });
  try {
    assert.strictEqual((await s.appel("/api/demandes")).code, 401); assert.strictEqual((await s.appel("/api/demandes/relever", { methode: "POST" })).code, 401);
    const pre = await fetch(s.base + "/api/demandes", { method: "OPTIONS" }); assert.strictEqual(pre.status, 204); assert.ok(/x-lf/.test(pre.headers.get("access-control-allow-headers")), "l'application (autre origine) envoie X-LF : le navigateur doit y être autorisé");
    const r = await s.appel("/api/demandes/relever", { methode: "POST", jeton: "lit" }); assert.strictEqual(r.code, 200); assert.strictEqual(r.json.nouvelles, 2, "notre propre message et le doublon (même Message-ID) sont écartés");
    const l = await s.appel("/api/demandes", { jeton: "lit" }); assert.deepStrictEqual(l.json.demandes.map((d) => d.de.email), ["achats@primeurs-souss.ma", "trafico@logistica-iberia.es"]);
    assert.strictEqual(l.json.boite.active, true); assert.strictEqual(l.json.boite.adresse, "c…@atlas-fret.ma"); assert.strictEqual(l.json.boite.erreur, "");
    assert.ok(l.json.demandes[0].texte.includes("clémentines")); assert.deepStrictEqual(l.json.demandes[0].pieces.map((x) => x.nom), ["liste colisage n°12.pdf"]);
    assert.strictEqual((await s.appel(`/api/demandes?depuis=${l.json.demandes[1].recu}`, { jeton: "lit" })).json.demandes.length, 0);
    assert.strictEqual((await s.appel("/api/demandes/relever", { methode: "POST", jeton: "lit" })).code, 429, "pas de relève forcée en rafale");
    assert.strictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.boite.nombre, 2);
    await s.arreter();
    const s2 = await demarrer(dossier, { imap: { ...imap, motDePasse: "faux" } }); // redémarrage : demandes et position de relève conservées ; erreur gardée lisible
    try { assert.strictEqual(s2.boite().dernierUid, 44); const e = await s2.releverDemandes(); assert.ok(/Connexion refusée/.test(e.erreur)); assert.ok(/Connexion refusée/.test((await s2.appel("/api/demandes", { jeton: "lit" })).json.boite.erreur)); assert.strictEqual(s2.boite().demandes.length, 2); }
    finally { await s2.arreter(); }
    const s3 = await demarrer(null); try { assert.strictEqual((await s3.appel("/api/demandes/relever", { methode: "POST", jeton: "lit" })).code, 503); assert.strictEqual((await s3.appel("/api/demandes", { jeton: "lit" })).json.boite.active, false); } finally { await s3.arreter(); }
  } finally { await f.fermer(); }
});

/* ---------- liens sans compte : dépôt des documents, étapes du transitaire ---------- */
test("lien de dépôt : création par l'application, page publique, envoi d'une photo et d'un PDF, refus (type, taille, document inconnu), récupération à l'identique puis effacement, révocation", async () => {
  const s = await demarrer(); const pub = (chemin, opts = {}) => fetch(s.base + chemin, opts);
  try {
    assert.strictEqual((await s.appel("/api/liens", { methode: "POST", corps: { type: "depot", docs: [{ id: "facture", lib: "Facture" }] } })).code, 401);
    assert.strictEqual((await s.appel("/api/liens", { methode: "POST", jeton: "lit", corps: { type: "depot", docs: [] } })).code, 400);
    const c = await s.appel("/api/liens", { methode: "POST", jeton: "lit", corps: { type: "depot", titre: "CMD-2026-0087 · Primeurs du Souss", entreprise: "Atlas Fret", langue: "es", jours: 7, docs: [{ id: "facture", lib: "Factura comercial" }, { id: "phyto", lib: "Certificado fitosanitario", recu: true }] } });
    assert.strictEqual(c.code, 201); assert.ok(/^\/depot\/[A-Za-z0-9_-]{32}$/.test(c.json.chemin)); const id = c.json.id;
    const html = await pub(c.json.chemin); assert.strictEqual(html.status, 200); const h = await html.text(); assert.ok(h.includes('lang="es"') && h.includes("Envíe sus documentos")); assert.strictEqual(html.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.ok((await (await pub(c.json.chemin + "?lang=ar")).text()).includes('dir="rtl"'));
    const d = await (await pub(c.json.chemin + "/donnees")).json(); assert.deepStrictEqual(d.docs.map((x) => [x.id, x.recu, x.envoyes]), [["facture", false, 0], ["phyto", true, 0]]); assert.strictEqual(d.entreprise, "Atlas Fret"); assert.ok(!("fichiers" in d));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(5000)]), pdf = Buffer.from("%PDF-1.4\n%essai\n");
    const envoi = (doc, corps, type, nom = "f") => pub(`${c.json.chemin}/fichier?doc=${doc}&nom=${encodeURIComponent(nom)}`, { method: "POST", headers: { "content-type": type }, body: corps });
    assert.strictEqual((await envoi("facture", jpeg, "image/jpeg", "facture 12.jpg")).status, 201); assert.strictEqual((await envoi("autre", pdf, "application/pdf", "colisage.pdf")).status, 201);
    assert.strictEqual((await envoi("facture", Buffer.from("MZ"), "application/x-msdownload")).status, 415); assert.strictEqual((await envoi("inconnu", pdf, "application/pdf")).status, 400);
    assert.strictEqual((await envoi("facture", Buffer.alloc(13 * 1024 * 1024), "image/jpeg")).status, 413, "12 Mo au plus");
    const l = await s.appel(`/api/liens/${id}`, { jeton: "lit" }); assert.deepStrictEqual(l.json.fichiers.map((f) => [f.n, f.doc, f.nom, f.type, f.taille]), [[1, "facture", "facture 12.jpg", "image/jpeg", jpeg.length], [2, "autre", "colisage.pdf", "application/pdf", pdf.length]]);
    const f1 = await fetch(`${s.base}/api/liens/${id}/fichiers/1`, { headers: { authorization: "Bearer lit" } }); assert.strictEqual(f1.headers.get("content-type"), "image/jpeg"); assert.ok(Buffer.from(await f1.arrayBuffer()).equals(jpeg), "fichier rendu à l'identique");
    assert.strictEqual((await fetch(`${s.base}/api/liens/${id}/fichiers/1`)).status, 401, "le public ne relit pas les fichiers");
    assert.strictEqual((await s.appel(`/api/liens/${id}/fichiers/1`, { methode: "DELETE", jeton: "lit" })).code, 200); assert.strictEqual((await s.appel(`/api/liens/${id}`, { jeton: "lit" })).json.fichiers.length, 1, "récupéré par l'application : effacé du relais");
    assert.strictEqual((await (await pub(c.json.chemin + "/donnees")).json()).envoyes, 2, "le client voit toujours ce qu'il a envoyé");
    assert.strictEqual((await s.appel(`/api/liens/${id}`, { methode: "PUT", jeton: "lit", corps: { docs: [{ id: "facture", lib: "Factura comercial", recu: true }] } })).code, 200);
    assert.strictEqual((await (await pub(c.json.chemin + "/donnees")).json()).docs[0].recu, true);
    assert.strictEqual((await s.appel(`/api/liens/${id}`, { methode: "DELETE", jeton: "lit" })).code, 200); assert.strictEqual((await pub(c.json.chemin)).status, 404); assert.strictEqual((await envoi("facture", jpeg, "image/jpeg")).status, 404);
    assert.strictEqual((await pub("/depot/court")).status, 404);
  } finally { await s.arreter(); }
});
test("relance des documents (J-2) : le relais ne redemande pas ce que le client a déposé par son lien, et n'envoie rien s'il ne manque plus rien", async () => {
  const appels = [], mails = [], http_ = async (url, o) => { appels.push({ url, corps: String(o.body || "") }); return { ok: true, status: 200 }; };
  const s = await demarrer(null, { http_, courriel_: async (cfg, m) => { mails.push(m); return { ok: true }; }, smtp: { hote: "smtp.exemple.org", de: "relais@atlas.example" } }); const T = Date.now();
  try {
    const c = await s.appel("/api/liens", { methode: "POST", jeton: "lit", corps: { type: "depot", titre: "CMD-1", docs: [{ id: "facture", lib: "Facture" }, { id: "colisage", lib: "Colisage" }, { id: "phyto", lib: "Phyto" }] } });
    const envoi = (doc) => fetch(`${s.base}${c.json.chemin}/fichier?doc=${doc}&nom=x.pdf`, { method: "POST", headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF-1.4\n") });
    const relance = (id, quand, lien) => ({ id, quand, canal: "email", destination: "achats@client.example", sujet: "CMD-1 — documents", texte: "Bonjour,\n\nil nous manque :\n- Facture\n- Colisage\n- Phyto\n\nMerci,\nAtlas",
      docs: { lien, avant: "Bonjour,\n\nil nous manque :\n", apres: "\n\nMerci,\nAtlas", lignes: [{ id: "facture", texte: "- Facture" }, { id: "colisage", texte: "- Colisage" }, { id: "phyto", texte: "- Phyto" }] } });
    const r = await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: { messages: [relance("docs:o1:relance", T + 3600000, c.json.id), relance("docs:o2:relance", T + 3600000, c.json.id), relance("docs:o3:relance", T + 3600000, "")] } });
    assert.strictEqual(r.json.programmes, 3);
    assert.strictEqual((await envoi("facture")).status, 201);
    await s.appel(`/api/liens/${c.json.id}`, { methode: "PUT", jeton: "lit", corps: { docs: [{ id: "facture", lib: "Facture" }, { id: "colisage", lib: "Colisage", recu: true }, { id: "phyto", lib: "Phyto" }] } });
    let f = await s.tick(T + 3600000 + 1000);
    assert.deepStrictEqual(f.map((x) => [x.id, x.statut]), [["docs:o1:relance", "envoye"], ["docs:o2:relance", "envoye"], ["docs:o3:relance", "envoye"]]);
    assert.strictEqual(mails[0].texte, "Bonjour,\n\nil nous manque :\n- Phyto\n\nMerci,\nAtlas", "facture déposée et colisage reçu : seul le phyto est redemandé");
    assert.strictEqual(mails[2].texte, "Bonjour,\n\nil nous manque :\n- Facture\n- Colisage\n- Phyto\n\nMerci,\nAtlas", "sans lien : le message tel quel");
    await envoi("phyto");
    await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: { messages: [relance("docs:o4:relance", T + 7200000, c.json.id)] } });
    f = await s.tick(T + 7200000 + 1000); assert.deepStrictEqual(f.map((x) => [x.id, x.statut]), [["docs:o4:relance", "inutile"]]); assert.strictEqual(mails.length, 3, "plus rien ne manque : aucun message");
    const sch = await s.appel(`/api/notifications/scheduler?debut=${T}&fin=${T + 9000000}`, { jeton: "lit" }); assert.ok(sch.json.messages.some((m) => m.id === "docs:o4:relance" && m.statut === "inutile"), JSON.stringify(sch.json.messages.map((m) => [m.id, m.statut])));
    const piege = await s.appel("/api/notifications/plan", { methode: "PUT", jeton: "lit", corps: { messages: [{ ...relance("p", T + 1, "../../etc"), docs: { lien: "../../etc", lignes: [{ id: "x", texte: "y" }] } }] } }); assert.strictEqual(piege.code, 200);
    assert.strictEqual(s.planif().messages.find((m) => m.id === "p").docs.lien, "", "identifiant de lien invalide écarté");
  } finally { await s.arreter(); }
});
test("lien transitaire : étapes marquées par le transitaire (référence, note, annulation), lues par l'application, mises à jour par elle ; expiration ; liens gardés au redémarrage et chiffrés au repos", async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "liens-")), { coffre } = chargerCoffre(dossier, { CHIFFRER_DONNEES: "true" });
  const s = await demarrer(dossier, { coffre }); const pub = (chemin, opts = {}) => fetch(s.base + chemin, opts);
  try {
    const etapes = [{ id: "alg_debarquement", lib: "Débarquement", port: "Algeciras", fait: true, date: "2026-11-17T08:00:00Z" }, { id: "alg_douane", lib: "Douane espagnole", port: "Algeciras", refLib: "MRN", docs: ["T1", "CMR"] }];
    const c = await s.appel("/api/liens", { methode: "POST", jeton: "lit", corps: { type: "transit", titre: "V-2026-0041 · 111-A-1", entreprise: "Atlas Fret", etapes } }); assert.strictEqual(c.code, 201);
    const poste = (b) => pub(`${c.json.chemin}/etape`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    assert.strictEqual((await poste({ etape: "inexistante" })).status, 400);
    const r = await poste({ etape: "alg_douane", ref: "26ES00481234567", note: "passage rapide" }); assert.strictEqual(r.status, 200);
    let d = await (await pub(`${c.json.chemin}/donnees`)).json(); assert.deepStrictEqual([d.etapes[1].fait, d.etapes[1].ref, d.etapes[1].docs], [true, "26ES00481234567", ["T1", "CMR"]]);
    await poste({ etape: "alg_douane", annuler: true }); d = await (await pub(`${c.json.chemin}/donnees`)).json(); assert.strictEqual(d.etapes[1].fait, false);
    await poste({ etape: "alg_douane", ref: "26ES00481234567" });
    const a = await s.appel(`/api/liens/${c.json.id}`, { jeton: "lit" }); assert.deepStrictEqual(a.json.evenements.map((e) => [e.n, e.etape, e.ref, e.annule]), [[1, "alg_douane", "26ES00481234567", false], [2, "alg_douane", "", true], [3, "alg_douane", "26ES00481234567", false]]);
    assert.strictEqual(a.json.evenements[0].note, "passage rapide");
    await s.appel(`/api/liens/${c.json.id}`, { methode: "PUT", jeton: "lit", corps: { etapes: [...etapes, { id: "alg_sortie", lib: "Sortie du port", port: "Algeciras", fait: true, date: "2026-11-17T11:00:00Z" }] } });
    assert.strictEqual((await (await pub(`${c.json.chemin}/donnees`)).json()).etapes.length, 3, "l'application tient la page à jour (étapes posées par le GPS)");
    const brut = fs.readFileSync(path.join(dossier, "liens.json")); assert.ok(estChiffre(brut) && !brut.toString("latin1").includes("Douane"), "chiffré au repos");
    await s.arreter();
    const s2 = await demarrer(dossier, { coffre });
    try { assert.strictEqual((await fetch(`${s2.base}${c.json.chemin}/donnees`)).status, 200, "gardé au redémarrage");
      const e = await s2.appel("/api/liens", { methode: "POST", jeton: "lit", corps: { type: "transit", etapes, jours: 1 } }); s2.liens.liens.get(e.json.id).expire = Math.floor(Date.now() / 1000) - 10;
      assert.strictEqual((await fetch(`${s2.base}${e.json.chemin}`)).status, 410); assert.ok((await (await fetch(`${s2.base}${e.json.chemin}`)).text()).includes("expiré"));
      s2.liens.liens.get(e.json.id).expire = Math.floor(Date.now() / 1000) - 8 * 86400; assert.strictEqual(s2.liens.purger(), 1, "effacé 7 jours après l'expiration"); }
    finally { await s2.arreter(); }
  } finally { if (s.serveur.listening) await s.arreter(); }
});

/* ---------- itinéraire poids lourd ---------- */
test("itinéraire poids lourd : appel openrouteservice (profil camion, ferries évités, gabarit), km par pays et à péage, cache, quota, erreurs ; route du relais", async () => {
  const { creerItineraire, lireReponse } = require("../serveur/itineraire.js");
  const appels = [];
  const reponse = { features: [{ geometry: { coordinates: [[-9.6, 30.42], [-5.5, 35.88]] }, properties: { summary: { distance: 812400, duration: 36720 }, extras: { countryinfo: { values: [[0, 1, 134]], summary: [{ value: 134, distance: 812400, amount: 100 }] }, tollways: { values: [[0, 1, 1]], summary: [{ value: 1, distance: 700100, amount: 86 }, { value: 0, distance: 112300, amount: 14 }] } } } }] };
  const http_ = async (u, o) => { appels.push({ u, o, corps: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => reponse }; };
  const it = creerItineraire({ cle: "cle-essai", quotaJour: 2, http_ });
  const r = await it.calculer({ points: [[30.42, -9.6], [35.88, -5.5]], camion: { poids: 44 } });
  assert.deepStrictEqual([r.km, r.heures, r.kmPays, r.kmPeage, r.source], [812, 10.2, { MA: 812 }, 700, "openrouteservice (service public)"]);
  const a = appels[0]; assert.strictEqual(a.u, "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"); assert.strictEqual(a.o.headers.Authorization, "cle-essai");
  assert.deepStrictEqual(a.corps.coordinates, [[-9.6, 30.42], [-5.5, 35.88]], "longitude puis latitude"); assert.deepStrictEqual(a.corps.options.avoid_features, ["ferries"]); assert.strictEqual(a.corps.options.vehicle_type, "hgv");
  assert.deepStrictEqual(a.corps.options.profile_params.restrictions, { weight: 44, height: 4, length: 16.5, width: 2.55, axleload: 11.5 }); assert.deepStrictEqual(a.corps.extra_info, ["countryinfo", "tollways"]);
  assert.strictEqual((await it.calculer({ points: [[30.4201, -9.6001], [35.88, -5.5]], camion: { poids: 44 } })).cache, true, "mêmes points à 100 m près : pas de nouvel appel"); assert.strictEqual(appels.length, 1);
  await it.calculer({ points: [[36.14, -5.45], [42.69, 2.89]] }); await assert.rejects(it.calculer({ points: [[36.14, -5.45], [48.85, 2.35]] }), /Quota du jour atteint \(2 calculs\)/);
  // sans résumé : km par pays recalculés sur le tracé (Algeciras → frontière → Perpignan)
  const t = lireReponse({ features: [{ geometry: { coordinates: [[-5.45, 36.14], [2.87, 42.42], [2.89, 42.69]] }, properties: { summary: { distance: 1100000, duration: 40000 }, extras: { countryinfo: { values: [[0, 1, 187], [1, 2, 70]] } } } }] });
  assert.ok(t.kmPays.ES > 950 && t.kmPays.ES < 1000 && t.kmPays.FR > 25 && t.kmPays.FR < 35, JSON.stringify(t.kmPays));
  await assert.rejects(creerItineraire({}).calculer({ points: [[1, 1], [2, 2]] }), /non configuré/);
  await assert.rejects(it.calculer({ points: [[1, 1]] }), /De 2 à 10 points/);
  const refus = creerItineraire({ url: "http://ors.local:8080/ors/", http_: async () => ({ ok: false, status: 403, json: async () => ({ error: "Quota exceeded" }) }) });
  await assert.rejects(refus.calculer({ points: [[1, 1], [2, 2]] }), /Clé refusée ou quota du service atteint \(réponse 403\)/);
  const s = await demarrer(null, { itineraire: { cle: "k" }, http_ });
  try { assert.strictEqual((await s.appel("/api/itineraire", { methode: "POST", corps: { points: [[30.42, -9.6], [35.88, -5.5]] } })).code, 401);
    const x = await s.appel("/api/itineraire", { methode: "POST", jeton: "lit", corps: { points: [[30.42, -9.6], [35.88, -5.5]] } }); assert.strictEqual(x.code, 200); assert.strictEqual(x.json.kmPays.MA, 812);
    assert.deepStrictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.itineraire.actif, true); }
  finally { await s.arreter(); }
  const s2 = await demarrer(null); try { assert.strictEqual((await s2.appel("/api/itineraire", { methode: "POST", jeton: "lit", corps: { points: [[1, 1], [2, 2]] } })).code, 503); } finally { await s2.arreter(); }
});

/** E-mail avec pièces jointes : PDF (taille choisie), logo de signature en ligne, PDF annoncé « octet-stream », archive. */
const pdfFactice = (n) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(n, 0x41)]);
const MAIL_PIECES = (uid, taillePdf = 2000, extra = "") => CRLF(`From: Souss Export <achats@souss-export.ma>
To: contact@atlas-fret.ma
Subject: Re: CMD-2026-0087 — documents
Date: Tue, 24 Nov 2026 08:00:00 +0100
Message-ID: <pj${uid}@souss-export.ma>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b1"
${extra}
--b1
Content-Type: multipart/related; boundary="b2"

--b2
Content-Type: text/html; charset=utf-8

<p>Bonjour, ci-joint la facture et le colisage.</p><img src="cid:logo">
--b2
Content-Type: image/png; name="image001.png"
Content-ID: <logo>
Content-Disposition: inline; filename="image001.png"
Content-Transfer-Encoding: base64

${Buffer.alloc(3000, 7).toString("base64")}
--b2--
--b1
Content-Type: application/pdf; name="Facture FC-2211.pdf"
Content-Disposition: attachment; filename="Facture FC-2211.pdf"
Content-Transfer-Encoding: base64

${pdfFactice(taillePdf).toString("base64").replace(/.{76}/g, "$&\n")}
--b1
Content-Type: application/octet-stream; name="packing list 0087.pdf"
Content-Disposition: attachment; filename="packing list 0087.pdf"
Content-Transfer-Encoding: base64

${pdfFactice(900).toString("base64")}
--b1
Content-Type: application/zip; name="photos.zip"
Content-Disposition: attachment; filename="photos.zip"
Content-Transfer-Encoding: base64

UEsDBA==
--b1--
`);

test("pièces jointes : lues avec leur contenu, type déduit du nom, logo de signature écarté ; message trop gros relu en entier (dans la limite), sinon seulement nommé", async () => {
  const { lireCourriel } = require("../serveur/mime.js"), { releverBoite } = require("../serveur/imap.js"), { typePiece } = require("../serveur/pieces.js");
  const c = lireCourriel(MAIL_PIECES(1), { garderPieces: true });
  assert.deepStrictEqual(c.pieces.map((p) => [p.nom, p.type, p.taille]), [["Facture FC-2211.pdf", "application/pdf", 2009], ["packing list 0087.pdf", "application/octet-stream", 909], ["photos.zip", "application/zip", 4]], "le logo en ligne (3 Ko) n'est pas une pièce jointe");
  assert.ok(c.pieces[0].octets.subarray(0, 8).equals(Buffer.from("%PDF-1.4")), "contenu décodé du base64"); assert.strictEqual(lireCourriel(MAIL_PIECES(1)).pieces[0].octets, undefined, "sans garderPieces : les noms seulement");
  assert.deepStrictEqual([typePiece("packing list 0087.pdf", "application/octet-stream"), typePiece("photos.zip", "application/zip"), typePiece("scan.JPG", ""), typePiece("x", "image/jpg")], ["application/pdf", "", "image/jpeg", "image/jpeg"]);
  // relève : un message de 600 Ko est relu en entier ; un autre au-delà de maxComplet reste coupé
  const msgs = [{ uid: 51, brut: MAIL_PIECES(51, 450000) }, { uid: 52, brut: MAIL_PIECES(52, 2000) }, { uid: 53, brut: MAIL_PIECES(53, 900000) }], f = await fauxImap({ messages: msgs });
  try {
    const r = await releverBoite({ hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "contact@atlas-fret.ma", motDePasse: "app-pass", maintenant: Date.parse("2026-11-24T10:00:00Z"), maxComplet: 1000000, maxCompletTotal: 1000000 });
    assert.deepStrictEqual(r.messages.map((m) => [m.uid, m.tronque]), [[51, false], [52, false], [53, true]], "51 relu en entier ; 53 dépasse ce qui reste du budget de la relève");
    assert.strictEqual(r.messages[0].brut.length, Buffer.from(msgs[0].brut, "latin1").length);
    assert.ok(f.commandes.some((x) => /UID FETCH 51 \(UID RFC822\.SIZE BODY\.PEEK\[\]\)$/.test(x)) && !f.commandes.some((x) => /UID FETCH 52 \(/.test(x)), "relu seulement s'il était coupé, toujours en BODY.PEEK");
    const sans = await releverBoite({ hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "contact@atlas-fret.ma", motDePasse: "app-pass", maintenant: Date.parse("2026-11-24T10:00:00Z") });
    assert.deepStrictEqual(sans.messages.map((m) => m.tronque), [true, false, true], "sans maxComplet : comme avant, coupé à 300 Ko");
  } finally { await f.fermer(); }
});

test("pièces jointes : gardées sur le relais (chiffrées), servies avec le jeton, effacées une fois rangées, au bout de 30 jours ou quand la demande sort de la boîte", async () => {
  const msgs = [{ uid: 61, brut: MAIL_PIECES(61, 450000) }, { uid: 62, brut: MAIL_PIECES(62, 1000, "List-Unsubscribe: <mailto:u@x.ma>\n") }], f = await fauxImap({ messages: msgs });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "pieces-")), coffre = chargerCoffre(dossier, { CHIFFRER_DONNEES: "true", CLE_DONNEES: "phrase-essai-pieces" }).coffre;
  const imap = { hote: "127.0.0.1", port: f.port, securite: "aucune", utilisateur: "contact@atlas-fret.ma", motDePasse: "app-pass" };
  let s = await demarrer(dossier, { imap, coffre });
  try {
    await s.releverDemandes(Date.parse("2026-11-24T10:00:00Z"));
    const l = (await s.appel("/api/demandes", { jeton: "lit" })).json, d = l.demandes.find((x) => x.uid === 61), masse = l.demandes.find((x) => x.uid === 62);
    assert.deepStrictEqual(d.pieces.map((p) => [p.n, p.nom, p.type, p.garde]), [[1, "Facture FC-2211.pdf", "application/pdf", true], [2, "packing list 0087.pdf", "application/pdf", true], [3, "photos.zip", "application/zip", false]]);
    assert.match(d.pieces[2].raison, /type non gardé/); assert.strictEqual(d.tronque, false, "message de 600 Ko relu en entier");
    assert.ok(masse.pieces.every((p) => !p.garde && /lettre d'information/.test(p.raison)), "rien n'est gardé d'une lettre d'information");
    assert.deepStrictEqual(l.boite.pieces, { nombre: 2, octets: 450009 + 909 });
    const chemin = `/api/demandes/${d.id}/pieces/1`;
    assert.strictEqual((await s.appel(chemin)).code, 401, "jeton de lecture requis");
    const rep = await fetch(s.base + chemin, { headers: { authorization: "Bearer lit" } }), o = Buffer.from(await rep.arrayBuffer());
    assert.strictEqual(rep.status, 200); assert.strictEqual(rep.headers.get("content-type"), "application/pdf"); assert.strictEqual(o.length, 450009); assert.ok(o.subarray(0, 8).equals(Buffer.from("%PDF-1.4")));
    assert.match(rep.headers.get("content-disposition"), /filename\*=UTF-8''Facture%20FC-2211\.pdf/);
    assert.ok(fs.readdirSync(path.join(dossier, "pieces")).every((x) => estChiffre(fs.readFileSync(path.join(dossier, "pieces", x)))), "chiffrées au repos");
    assert.strictEqual((await s.appel(`/api/demandes/${d.id}/pieces/3`, { jeton: "lit" })).code, 404, "pièce non gardée");
    assert.strictEqual((await s.appel(`/api/demandes/../pieces/1`, { jeton: "lit" })).code, 404);
    // rangée par l'application : effacée, marquée effacée pour les autres appareils
    assert.strictEqual((await s.appel(chemin, { jeton: "lit", methode: "DELETE" })).json.efface, true);
    assert.strictEqual((await s.appel(chemin, { jeton: "lit" })).code, 404); assert.strictEqual(s.boite().demandes.find((x) => x.uid === 61).pieces[0].efface, true);
    await s.arreter();
    s = await demarrer(dossier, { imap, coffre }); // redémarrage : la pièce restante est toujours servie
    assert.strictEqual((await s.appel(`/api/demandes/${d.id}/pieces/2`, { jeton: "lit" })).code, 200);
    assert.strictEqual(s.pieces.purger(null, 30), 0, "gardée depuis moins de 30 jours");
    assert.strictEqual(s.pieces.purger(new Set(["autre"])), 1, "la demande est sortie de la boîte : sa pièce est effacée");
    assert.deepStrictEqual(s.pieces.resume(), { nombre: 0, octets: 0 }); assert.strictEqual(fs.readdirSync(path.join(dossier, "pieces")).length, 0);
    assert.strictEqual((await s.appel("/api/etat", { jeton: "lit" })).json.version, "2.3.0");
  } finally { await s.arreter(); await f.fermer(); }
});

test("pièces jointes : plafonds — 15 Mo la pièce, 10 par message, espace total du relais", () => {
  const { creerPieces } = require("../serveur/pieces.js"), p = creerPieces({ coffre: creerCoffre(null), maxMo: 1, pieceMaxMo: 0.5, maxParMessage: 2 });
  const pdf = (n) => ({ nom: `d${n}.pdf`, type: "application/pdf", octets: Buffer.alloc(n) });
  const l = p.garder("m1-1", [pdf(600000), pdf(300000), pdf(300000), pdf(10)]);
  assert.deepStrictEqual(l.map((x) => x.garde), [false, true, true, false]); assert.match(l[0].raison, /plus de 0.5 Mo/); assert.match(l[3].raison, /plus de 2 pièces/);
  const l2 = p.garder("m1-2", [pdf(500000)]); assert.match(l2[0].raison, /espace du relais plein/);
  assert.deepStrictEqual(p.garder("../x", [pdf(10)]), [], "identifiant de demande refusé");
});

(async () => {
  let ok = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log("✓", n); } catch (e) { console.error("✗", n, "\n ", e.message); process.exitCode = 1; } }
  console.log(`\n${ok}/${tests.length} test(s) du relais réussi(s)`);
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); // un test en échec peut laisser un serveur ouvert : on ne reste jamais bloqué
})();
