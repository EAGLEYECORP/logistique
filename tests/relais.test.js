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
