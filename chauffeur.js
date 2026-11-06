"use strict";
/* ============================================================
   Mode chauffeur : une interface très simple, verrouillée sur un chauffeur.
   - missions assignées, prise/fin de service, changement d'étape, photos (CMR, livraison), plein de gasoil ;
   - tout le reste (clients, factures, marges, réglages…) est masqué ;
   - sortie protégée par un code PIN (et un code de secours remis une seule fois au gestionnaire).
   Le mode est propre à l'appareil (localStorage « logistique-mode »), jamais inclus dans les sauvegardes.
   ATTENTION : le PIN verrouille l'interface, il ne chiffre pas les données (voir Export chiffré pour cela).
   ============================================================ */

const MODE_CLE = "logistique-mode";
const verrouEssais = { n: 0, jusqua: 0 };

function modeChauffeurLire() { try { return JSON.parse(localStorage.getItem(MODE_CLE) || "null"); } catch { return null; } }
const modeChauffeurActif = () => !!modeChauffeurLire()?.chauffeurId;
const chauffeurCourant = () => parId(S.chauffeurs, modeChauffeurLire()?.chauffeurId);

function chauffeurAppliquerMode() { document.body.classList.toggle("mode-chauffeur", modeChauffeurActif()); }

/** Active le mode sur cet appareil. Renvoie le code de secours (à noter) si un PIN est défini. */
async function chauffeurActiver(chauffeurId, pin) {
  const { verrou, secours } = await verrouCreer(pin);
  try { localStorage.setItem(MODE_CLE, JSON.stringify({ chauffeurId, verrou: pin ? verrou : null, depuis: new Date().toISOString() })); }
  catch { throw new Error("Impossible d'enregistrer le mode sur cet appareil."); }
  return pin ? secours : "";
}

async function chauffeurQuitter() {
  const m = modeChauffeurLire();
  if (!m) return;
  if (m.verrou?.hashPin) {
    let message = "";
    for (;;) {
      const attente = Math.ceil((verrouEssais.jusqua - Date.now()) / 1000);
      if (attente > 0) return toast(`Trop d'essais : réessayez dans ${attente} s.`, "warn");
      const v = await formulaire("Quitter le mode chauffeur", [{ name: "code", label: "Code PIN (ou code de secours)", type: "password", required: true, full: true, autocomplete: "off" }], { valider: "Quitter", aide: `${message}Réservé au gestionnaire.` });
      if (!v) return;
      if (await verrouVerifier(m.verrou, v.code)) break;
      if (++verrouEssais.n >= 5) { verrouEssais.n = 0; verrouEssais.jusqua = Date.now() + 60000; }
      message = `<strong style="color:var(--danger)">Code incorrect.</strong><br>`;
    }
  } else if (!(await confirmer("Quitter le mode chauffeur ?", "L'application complète sera de nouveau accessible sur cet appareil.", "Quitter"))) return;
  verrouEssais.n = 0;
  try { localStorage.removeItem(MODE_CLE); } catch { /* ignoré */ }
  chauffeurAppliquerMode();
  afficher("tableau");
  toast("Mode chauffeur désactivé");
}

/* ---------- vue ---------- */
const prenom = (nom) => String(nom || "").trim().split(/\s+/)[0] || "";

function carteService(ch) {
  const e = etatChauffeur(ch);
  const P = S.params;
  const enService = e.code === "service" || e.code === "depasse";
  const h = ch.debutService ? (Date.now() - new Date(ch.debutService).getTime()) / 3600000 : 0;
  const pct = Math.min(100, (h / P.amplitudeMaxHeures) * 100);
  let titre, sous, action = "", barre = "";
  if (enService) {
    const depasse = e.code === "depasse";
    titre = depasse ? "Repos obligatoire" : "En service";
    sous = depasse ? `Vous êtes en service depuis ${fmt(h, 1)} h (limite ${P.amplitudeMaxHeures} h). Arrêtez-vous dès que possible.` : `Depuis ${fmt(h, 1)} h · repos obligatoire dans ${fmt(Math.max(0, e.reste), 1)} h`;
    barre = `<div class="progress ${depasse ? "danger" : e.reste <= 1 ? "warn" : ""}"><i style="width:${pct}%"></i></div>`;
    action = btn("chf-fin", "Fin de service", { cls: depasse ? "btn lg" : "btn lg ghost" });
  } else if (e.code === "repos") {
    titre = "En repos"; sous = `Jusqu'à ${dateHeureFr(ch.reposJusqua)}`;
    action = btn("chf-service", "Prendre mon service quand même", { cls: "btn lg ghost" });
  } else if (e.code === "libre") {
    titre = "Prêt"; sous = "Vous n'êtes pas en service.";
    action = btn("chf-service", "Prendre mon service", { icone: "play", cls: "btn lg" });
  } else { titre = e.code === "conge" ? "En congé" : "Permis expiré"; sous = e.code === "conge" ? "Aucune mission à lancer pendant un congé." : "Contactez le bureau : vous ne pouvez pas prendre de service."; }
  return `<div class="card chf-service ${e.code}"><div class="chf-titre">${esc(titre)}</div><p class="sub" style="margin:2px 0 0">${esc(sous)}</p>${barre}${action ? `<div class="chf-actions">${action}</div>` : ""}</div>`;
}

function carteMission(c, ch, principale) {
  const nx = suivant(c.statut);
  const carte = (t) => `<div class="card chf-mission ${principale ? "principale" : ""}">${t}</div>`;
  const maps = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${c.origine}, ${c.paysOrigine || ""}`)}&destination=${encodeURIComponent(`${c.destination}, ${c.paysDest || ""}`)}&travelmode=driving`;
  const entete = `<div class="row" style="justify-content:space-between;align-items:flex-start"><div><strong class="chf-ref">${esc(c.ref)}</strong><span class="sub">${esc(nomClient(c.clientId))}</span></div>${badge(libStatutCmd(c.statut), niveauStatut[c.statut])}</div>`;
  const route = `<div class="chf-route"><span>${esc(lieu(c.origine, c.paysOrigine))}</span><span class="fl">→</span><span>${esc(lieu(c.destination, c.paysDest))}</span></div>`;
  const infos = [c.marchandise, c.palettes && `${fmt(c.palettes)} palettes`, c.poids && `${fmt(c.poids)} kg`, c.cmr && `CMR ${c.cmr}`].filter(Boolean).map(esc).join(" · ");
  const dates = `Chargement ${dateFr(c.dateChargement)}${c.dateLivraison ? ` · livraison ${dateFr(c.dateLivraison)}` : ""}`;
  if (!principale) return carte(`${entete}${route}<p class="sub" style="margin:0">${dates}</p>`);
  const etape = c.statut === "devis" ? `<p class="hint" style="margin:0">En attente de confirmation par le bureau.</p>`
    : nx ? btn("chf-etape", `Marquer « ${libStatutCmd(nx)} »`, { id: c.id, icone: nx === "livre" ? "flag" : "check", cls: "btn lg" }) : "";
  return carte(`${entete}${route}<p style="margin:0">${infos || ""}</p><p class="sub" style="margin:0">${dates}</p>
    ${c.notes ? `<p class="hint" style="margin:0">${esc(c.notes)}</p>` : ""}
    <div class="chf-actions">${etape}
      ${boutonPhotos(`commande:${c.id}`, `Photos — ${c.ref} (CMR, livraison, dommages)`, { texte: true, cls: "btn lg ghost" })}
      <a class="btn lg ghost" href="${maps}" target="_blank" rel="noopener">${ic("route")}Itinéraire</a></div>`);
}

function carteCamion(ch) {
  const c = parId(S.camions, ch.camionId);
  if (!c) return "";
  return `<div class="card"><div class="card-head"><h2>Mon camion · ${esc(c.immat)}</h2><span class="sub num">${fmt(c.km)} km</span></div>
    <div class="gauges" style="margin-bottom:14px">${etatCamion(c).filter((e) => e.pct !== undefined).map((e) => `<div class="gauge ${e.niveau}"><span class="lbl">${e.type}</span><span class="bar"><i style="width:${e.pct}%"></i></span><span class="txt">${esc(e.texte)}</span></div>`).join("")}</div>
    <div class="chf-actions">${btn("chf-plein", "Saisir un plein", { icone: "fuel", cls: "btn lg ghost" })}${boutonPhotos(`camion:${c.id}`, `Photos — ${c.immat}`, { texte: true, cls: "btn lg ghost" })}</div></div>`;
}

VUES.chauffeur = {
  titre: () => { const ch = chauffeurCourant(); return ch ? `Bonjour ${prenom(ch.nom)}` : "Mode chauffeur"; },
  sous: () => new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (x) => x.toUpperCase()),
  actions: () => S.entreprise?.tel ? `<a class="btn ghost" href="tel:${esc(S.entreprise.tel.replace(/\s/g, ""))}">${ic("phone")}Appeler le bureau</a>` : "",
  rendu() {
    const ch = chauffeurCourant();
    if (!ch) return `<div class="card">${vide("users", "Chauffeur introuvable", "Le chauffeur de cet appareil n'existe plus dans les données.", btn("chf-quitter", "Quitter le mode chauffeur"))}</div>`;
    const missions = missionsChauffeur(ch.id);
    const isoles = trajetsIsoles(ch.id);
    const mesAlertes = alertes().filter((a) => a.cle.split(":").some((x) => x === ch.id || (ch.camionId && x === ch.camionId)) && a.cat !== "autre");
    const [premiere, ...autres] = missions;
    return `${carteService(ch)}
      ${mesAlertes.length ? `<div class="card"><div class="card-head"><h2>À régler</h2></div><ul class="alerts">${mesAlertes.map((a) => `<li><span class="ico ${a.niveau}">${ic(a.niveau === "danger" ? "alert" : "flag")}</span><div class="t">${esc(a.texte.replace(`${ch.nom} — `, ""))}</div></li>`).join("")}</ul></div>` : ""}
      <div class="section-title">Ma mission</div>
      ${premiere ? carteMission(premiere, ch, true) : `<div class="card">${vide("check", "Aucune mission", "Le bureau n'a rien planifié pour vous pour l'instant.")}</div>`}
      ${autres.length ? `<div class="section-title">À venir · ${autres.length}</div>${autres.map((c) => carteMission(c, ch, false)).join("")}` : ""}
      ${isoles.length ? `<div class="section-title">Trajets</div>${isoles.map((t) => `<div class="card chf-mission"><div class="row" style="justify-content:space-between"><div class="chf-route"><span>${esc(t.depart)}</span><span class="fl">→</span><span>${esc(t.arrivee)}</span></div>${badge(STATUTS[t.statut][0], STATUTS[t.statut][1])}</div>
        <p class="sub" style="margin:0">${fmt(t.distance)} km · ${dateFr(t.date)}</p>
        <div class="chf-actions">${t.statut === "planifie" ? btn("chf-trajet-go", "Démarrer le trajet", { id: t.id, icone: "play", cls: "btn lg" }) : btn("chf-trajet-fin", "Terminer le trajet", { id: t.id, icone: "flag", cls: "btn lg" })}</div></div>`).join("")}` : ""}
      <div class="section-title">Véhicule</div>
      ${carteCamion(ch) || `<div class="card">${vide("truck", "Aucun camion", "Aucun camion ne vous est attribué : prévenez le bureau.")}</div>`}
      <div class="row" style="justify-content:center;margin-top:24px">${btn("chf-quitter", "Quitter le mode chauffeur", { cls: "btn ghost sm" })}</div>`;
  },
  async agir(act, id) {
    if (!modeChauffeurActif()) return;
    const ch = chauffeurCourant();
    if (act === "chf-quitter") return chauffeurQuitter();
    if (!ch) return;
    const etat = etatChauffeur(ch);
    const demarrerService = async () => {
      if (etat.code === "service" || etat.code === "depasse") return true;
      if (!etat.dispo && etat.code !== "repos") { toast(etat.texte, "warn"); return false; }
      if (etat.code === "repos" && !(await confirmer("Repos non terminé", `Vous êtes en repos jusqu'à ${dateHeureFr(ch.reposJusqua)}. Prendre le service quand même ?`, "Prendre le service"))) return false;
      prendreService(ch); return true;
    };
    if (act === "chf-service") { if (await demarrerService()) { sauver(); toast("Bon service !"); rafraichir(); } }
    if (act === "chf-fin") {
      if (!(await confirmer("Terminer le service ?", `Votre repos de ${S.params.reposMinHeures} h commence maintenant.`, "Fin de service"))) return;
      finDeService(ch); sauver(); toast("Service terminé · bon repos"); rafraichir();
    }
    if (act === "chf-etape") {
      const c = parId(S.commandes, id);
      const nx = c && suivant(c.statut);
      if (!nx || c.statut === "devis") return;
      c.camionId ||= ch.camionId;
      if (!c.camionId) return toast("Aucun camion affecté : prévenez le bureau.", "warn");
      if (nx === "livre" && !(await confirmer("Confirmer la livraison ?", `${c.ref} · ${lieu(c.destination, c.paysDest)}`, "Livraison effectuée"))) return;
      if (nx === "charge" && !(await demarrerService())) return;
      appliquerEtape(c, nx); sauver();
      toast(`${c.ref} : ${libStatutCmd(nx)}`); rafraichir();
      if (nx === "livre") ouvrirPhotos(`commande:${c.id}`, `Preuve de livraison — ${c.ref}`); // CMR signé, déchargement
    }
    if (act === "chf-trajet-go" || act === "chf-trajet-fin") {
      const t = parId(S.trajets, id);
      if (!t) return;
      if (act === "chf-trajet-go") { if (!(await demarrerService())) return; t.statut = "encours"; }
      else { t.statut = "termine"; const cam = parId(S.camions, t.camionId); if (cam) cam.km += t.distance; }
      sauver(); toast(act === "chf-trajet-go" ? "Trajet démarré" : "Trajet terminé"); rafraichir();
    }
    if (act === "chf-plein") {
      const cam = parId(S.camions, ch.camionId);
      if (!cam) return;
      const v = await formulaire(`Plein — ${cam.immat}`, [
        { name: "km", label: "Kilométrage au compteur", type: "number", required: true, min: 0, value: cam.km },
        { name: "litres", label: "Litres", type: "number", required: true, min: 0 },
        { name: "prix", label: "Prix au litre (MAD)", type: "number", value: S.params.prixGasoil, required: true, min: 0 },
        { name: "station", label: "Station / lieu" },
        { name: "ticket", label: "Photo du ticket", type: "photo" },
        { name: "plein", label: "Plein complet (réservoir rempli)", type: "checkbox", value: true, full: true },
      ], { valider: "Enregistrer" });
      if (!v) return;
      enregistrerPlein({ ...v, camionId: cam.id, date: today() });
      rafraichir();
    }
  },
};

/* ---------- Réglages → Appareil : activer le mode ---------- */
enregistrerCarteReglages({
  onglet: "appareil", ordre: 20,
  rendu() {
    const m = modeChauffeurLire();
    return `<div class="card">
      <div class="card-head"><h2>Mode chauffeur</h2>${m ? badge("Actif", "ok") : badge("Désactivé", "neutral")}</div>
      <p class="hint" style="margin-top:0">Pour un téléphone ou une tablette laissé dans le camion : l'appareil n'affiche que les missions d'un chauffeur (service, étapes, photos, plein) et masque clients, factures, marges et réglages. La sortie est protégée par un code PIN.</p>
      ${S.chauffeurs.length ? `<form id="f-chauffeur-mode">
        ${champs([
          { name: "chauffeurId", label: "Chauffeur de cet appareil", type: "select", required: true, options: [["", "— Choisir —"], ...S.chauffeurs.map((h) => [h.id, h.nom])] },
          { name: "pin", label: "Code PIN (4 à 6 chiffres)", type: "password", autocomplete: "off", placeholder: "Recommandé" },
          { name: "pin2", label: "Confirmer le code PIN", type: "password", autocomplete: "off" },
        ])}
        <p class="hint">Le PIN verrouille l'interface ; il ne chiffre pas les données. Un code de secours vous sera remis pour débloquer l'appareil si le PIN est oublié. Les données restent sur cet appareil : pour qu'un chauffeur voie ses missions, importez-y une sauvegarde à jour (Données → Importer).</p>
        <div class="row" style="justify-content:flex-end"><button class="btn">Activer le mode chauffeur</button></div>
      </form>` : `<p class="hint">Ajoutez d'abord un chauffeur (menu Flotte → Chauffeurs).</p>`}
    </div>`;
  },
  soumettre(fid, v) {
    if (fid !== "f-chauffeur-mode") return false;
    (async () => {
      if (!v.chauffeurId) return toast("Choisissez un chauffeur.", "warn");
      if (v.pin && !/^\d{4,6}$/.test(v.pin)) return toast("Le PIN doit comporter 4 à 6 chiffres.", "warn");
      if (v.pin !== v.pin2) return toast("Les deux codes PIN ne correspondent pas.", "warn");
      const ch = parId(S.chauffeurs, v.chauffeurId);
      if (!(await confirmer("Activer le mode chauffeur ?", `Cet appareil sera réservé à ${ch.nom}${v.pin ? " et verrouillé par PIN" : ""}. L'application complète ne sera plus accessible ici sans ${v.pin ? "le code" : "quitter le mode"}.`, "Activer"))) return;
      let secours = "";
      try { secours = await chauffeurActiver(v.chauffeurId, v.pin); } catch (e) { return toast(e.message, "danger"); }
      if (secours) await modale({ titre: "Code de secours", valider: "J'ai noté le code", annuler: "",
        corps: `<p style="margin:0 0 12px">Notez ce code et gardez-le en lieu sûr (gestionnaire uniquement). Il permet de quitter le mode chauffeur si le PIN est oublié.</p><p class="code-secours">${esc(secours)}</p><p class="hint">Il ne sera <strong>plus affiché</strong>.</p>` });
      chauffeurAppliquerMode(); afficher("chauffeur");
    })();
    return true;
  },
});
