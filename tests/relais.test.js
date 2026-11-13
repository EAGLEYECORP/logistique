// Tests du relais de positions : node tests/relais.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
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
    for (const interdit of ["/serveur/relais.js", "/package.json", "/tests/relais.test.js", "/../etc/passwd", "/.git/config", "/serveur/donnees/comptes.json"]) assert.ok([401, 404].includes((await s.appel(interdit)).code), interdit);
  } finally { await s.arreter(); }
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

(async () => {
  let ok = 0;
  for (const [n, f] of tests) { try { await f(); ok++; console.log("✓", n); } catch (e) { console.error("✗", n, "\n ", e.message); process.exitCode = 1; } }
  console.log(`\n${ok}/${tests.length} test(s) du relais réussi(s)`);
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); // un test en échec peut laisser un serveur ouvert : on ne reste jamais bloqué
})();
