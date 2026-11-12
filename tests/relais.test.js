// Tests du relais de positions : node tests/relais.test.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { creer, normaliser } = require("../serveur/relais.js");
const { creerCoffre, chargerCoffre, estChiffre } = require("../serveur/coffre.js");
const { planPurge } = require("../serveur/purge-photos.js");

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
