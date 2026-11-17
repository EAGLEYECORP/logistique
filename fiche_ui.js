"use strict";
/* ============================================================
   Fiche du voyage (interface) : ce qui se passe, ce qu'il faut faire, puis le détail rangé en quatre onglets.
   · en-tête : référence, client, trajet, marge, statut ; fiche fermée : frise réduite et « À faire » ;
   · fiche ouverte : frise du voyage (départ, port de départ, port d'arrivée, livraison, retour, dépôt), arrivée estimée,
     la chose à faire maintenant avec son bouton, les points d'attention ;
   · onglets Suivi · Documents · Argent · Équipe : chaque fonction y inscrit son bloc (enregistrerBlocVoyage, voyages.js) ;
   · le contenu n'est calculé qu'à l'ouverture de la fiche ; changer d'onglet ne recharge pas la page.
   Logique pure dans fiche.js. Chargé après les fichiers qui fournissent les blocs, avant annuler_ui.js.
   ============================================================ */

const ONGLETS_FICHE = [["suivi", "Suivi"], ["documents", "Documents"], ["argent", "Argent"], ["equipe", "Équipe"]];
const ongletFiche = new Map(); // voyage → onglet ouvert, le temps de la session
const ongletsFicheVisibles = () => ONGLETS_FICHE.filter(([k]) => k !== "argent" || !sansFinances());
function ongletDeFiche(v) {
  const visibles = ongletsFicheVisibles().map(([k]) => k), o = ongletFiche.get(v.id);
  if (o && visibles.includes(o)) return o;
  return v.statut === "termine" && visibles.includes("argent") ? "argent" : "suivi";
}

/* ---------- ce qui est montré selon le profil : sans accès aux prix, pas d'action ni de montant d'argent ---------- */
const CLES_ARGENT = ["client", "prix", "facturer", "envoyer", "facturer_retour", "relancer", "paiement", "solde"];
function actionAffichee(v) {
  const a = prochaineAction(v);
  if (!a || !sansFinances()) return a;
  if (CLES_ARGENT.includes(a.cle)) return { cle: "fini", titre: "Voyage terminé", detail: "", bouton: "", act: "", id: "", ton: "ok" };
  return a.cle === "retour" ? { ...a, detail: "" } : a;
}
function attentionAffichee(v) {
  const p = pointsAttention(v);
  return sansFinances() ? p.filter((x) => x.cle !== "facturer").map((x) => (x.cle === "retour" ? { ...x, texte: "Pas encore de chargement de retour" } : x)) : p;
}

/* ---------- frise ---------- */
function htmlFrise(f) {
  return `<ol class="frise" style="--n:${f.noeuds.length};--avance:${Math.round(f.fraction * 1000) / 1000}" aria-label="Avancement du voyage">${f.noeuds.map((x) => `<li class="${x.etat}${x.alerte ? " alerte" : ""}"${x.etat === "encours" ? ' aria-current="step"' : ""}><span class="pt">${x.etat === "fait" ? ic("check") : ""}</span><strong>${esc(x.lib)}</strong>${x.sous ? `<span class="sub">${esc(x.sous).replace(/(\d) (h|min|j)\b/g, "$1\u00a0$2").replace(/ h (\d)/g, "\u00a0h\u00a0$1")}</span>` : ""}</li>`).join("")}</ol>`;
}
const htmlFriseMini = (f) => `<span class="frise-mini" aria-hidden="true">${f.noeuds.map((x) => `<i class="${x.etat}${x.alerte ? " alerte" : ""}"></i>`).join("")}</span>`;
/** Arrivée estimée, en une ligne sous la frise (le détail et l'origine du calcul sont dans l'onglet Suivi). */
function ligneEta(v) {
  if (!["prevu", "en_cours"].includes(v.statut) || typeof etaDuVoyage !== "function") return "";
  const e = etaDuVoyage(v); if (!e) return "";
  const d = new Date(e.arrivee * 1000).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const etat = e.retardMin === null ? "" : e.retardMin > 30 ? `retard probable ${fmt(Math.round(e.retardMin / 6) / 10, 1)} h` : e.retardMin < -30 ? "en avance" : "dans les temps";
  return `<p class="fiche-eta ${e.retardMin > 30 ? "retard" : ""}">${ic("clock")}<span>Arrivée estimée <strong>${esc(d)}</strong>${etat ? ` · ${etat}` : ""}</span></p>`;
}

/* ---------- la chose à faire maintenant, les points d'attention ---------- */
const ETIQUETTE_ACTION = { action: "À faire maintenant", alerte: "À faire maintenant", attente: "En attente", ok: "Terminé" };
function carteAction(v, a) {
  if (!a) return "";
  const ch = parId(S.chauffeurs, v.chauffeurId), tel = v.statut === "en_cours" && ch?.tel && typeof telInternational === "function" ? telInternational(ch.tel) : "";
  const boutons = `${a.bouton ? btn(a.act, esc(a.bouton), { id: a.id, cls: "btn" }) : ""}${a.second ? btn(a.second.act, esc(a.second.bouton), { id: a.second.id, cls: "btn ghost" }) : ""}${tel ? `<a class="btn ghost" href="tel:+${tel}">${ic("phone")}Appeler ${esc(String(ch.nom || "").split(" ")[0])}</a>` : ""}`;
  return `<div class="fiche-action ${a.ton}"><span class="etiquette">${ETIQUETTE_ACTION[a.ton] || ETIQUETTE_ACTION.action}</span><strong class="titre">${esc(a.titre)}</strong>
    ${a.detail ? `<span class="detail">${esc(a.detail)}</span>` : ""}${a.acteur ? `<span class="detail acteur">${ic("users")}${esc(a.acteur)}</span>` : ""}
    ${boutons ? `<div class="row">${boutons}</div>` : ""}</div>`;
}
function listeAttention(v, pts) {
  if (!pts.length) return "";
  return `<div class="fiche-attention">${pts.map((p) => `<button type="button" class="attention ${p.niveau}" data-act="${p.act || "fiche-onglet"}" data-id="${esc(p.act ? p.id : `${v.id}|${p.onglet}`)}">${ic(p.niveau === "info" ? "clock" : "alert")}<span>${esc(p.texte)}</span><b>${esc(p.bouton || "Voir")}</b></button>`).join("")}</div>`;
}

/* ---------- la fiche ---------- */
function compteursOnglets(v) {
  if (!["prevu", "en_cours"].includes(v.statut)) return {};
  const docs = documentsARelancer(v).reduce((n, d) => n + d.liste.length, 0);
  return { documents: docs, equipe: controlesVoyage(v).filter((x) => x.niveau === "danger").length };
}
function corpsFiche(v) {
  const onglet = ongletDeFiche(v), n = compteursOnglets(v), annule = v.statut === "annule";
  return `<div class="fiche-corps">
    <div class="fiche-haut">${annule ? `<p class="hint" style="margin-top:14px">Voyage annulé : il ne compte ni dans le planning ni dans la marge.</p>` : htmlFrise(friseVoyage(v)) + ligneEta(v) + carteAction(v, actionAffichee(v)) + listeAttention(v, attentionAffichee(v))}</div>
    <div class="fiche-fond">
      <div class="segmented fiche-onglets" role="tablist">${ongletsFicheVisibles().map(([k, l]) => `<button type="button" role="tab" data-act="fiche-onglet" data-id="${v.id}|${k}" aria-selected="${k === onglet}">${l}${n[k] ? `<span>${n[k]}</span>` : ""}</button>`).join("")}</div>
      <div class="fiche-contenu" role="tabpanel">${blocsVoyage(v, onglet) || `<p class="hint">Rien à afficher ici pour ce voyage.</p>`}</div>
    </div>
    <div class="fiche-pied">
      ${btn("partager", v.partage ? "Lien client" : "Partager le suivi", { id: v.id, icone: "mail", cls: "btn ghost sm" })}
      ${btn("modifier", "Modifier", { id: v.id, icone: "edit", cls: "btn ghost sm" })}
      <details class="menu-plus"><summary class="btn ghost sm" title="Autres actions" aria-label="Autres actions">${ic("more")}</summary><div class="menu-plus-liste">
        ${btn("dupliquer", "Dupliquer", { id: v.id, icone: "plus", cls: "btn ghost sm", titre: "Nouveau voyage identique (trajet, client, prix, équipe), à une autre date" })}
        ${["termine", "annule"].includes(v.statut) ? "" : btn("terminer", "Terminer le voyage", { id: v.id, icone: "check", cls: "btn ghost sm" })}
        ${btn("suppr", "Supprimer", { id: v.id, icone: "trash", cls: "btn ghost sm text-danger" })}
      </div></details>
    </div></div>`;
}
function carteVoyage(v) {
  const ouvert = voyagesOuverts.has(v.id), ctl = ["prevu", "en_cours"].includes(v.statut) ? controlesVoyage(v) : [], blocages = ctl.filter((x) => x.niveau === "danger").length;
  const f = v.statut === "annule" ? null : friseVoyage(v), a = f ? actionAffichee(v) : null;
  return `<details class="card dossier fiche" data-voyage="${v.id}" ${ouvert ? "open" : ""}>
    <summary>
      <div class="fiche-tete"><span class="fiche-ref">${esc(v.ref)}${v.clientId ? " · " + esc(nomClient(v.clientId)) : ""}</span>
        <div class="row">${pastilleMarge(v)}${blocages ? badge(`${blocages} blocage(s)`, "danger") : ctl.length ? badge(`${ctl.length} point(s)`, "warn") : ""}${badge(STATUTS_VOYAGE.find(([k]) => k === v.statut)?.[1], niveauStatutVoyage[v.statut])}</div></div>
      <h3 class="fiche-trajet">${esc(v.origine)} <span class="fl">→</span> ${esc(v.destination)}</h3>
      <div class="meta">${[dateFr(v.dateDepart) + " → " + dateFr(v.dateRetourPrevue), v.chauffeurId && nomChauffeur(v.chauffeurId), v.camionId && nomCamion(v.camionId), v.marchandise].filter(Boolean).map(esc).join(" · ")}</div>
      ${f ? `<div class="fiche-resume">${htmlFriseMini(f)}${f.legende ? `<span class="legende">${esc(f.legende)}</span>` : ""}${a ? `<span class="fiche-afaire ${a.ton}">${a.ton === "ok" ? ic("check") : a.ton === "attente" ? "" : "<b>À faire</b>"}${esc(a.titre)}</span>` : ""}</div>` : ""}
    </summary>
    <div class="body">${ouvert ? corpsFiche(v) : ""}</div></details>`;
}
/** Recalcule le contenu d'une fiche ouverte, sans recharger la page (ouverture, changement d'onglet). */
function majFiche(id) {
  const v = parId(S.voyages, id), corps = document.querySelector(`details[data-voyage="${CSS.escape(id)}"] > .body`);
  if (!v || !corps) return;
  corps.innerHTML = corpsFiche(v);
  etiqueterTableaux(); if (typeof hydraterPhotos === "function") hydraterPhotos();
}

/* ---------- onglet Suivi ---------- */
function blocEtapesVoyage(v) {
  const jalons = v.jalons || [], actif = v.statut !== "annule";
  const dernier = JALONS_VOYAGE.reduce((n, [k], i) => (jalons.some((j) => j.type === k) ? i : n), -1), prochain = JALONS_VOYAGE.slice(dernier + 1).find(([k]) => !jalons.some((j) => j.type === k))?.[0]; // après la dernière étape faite : celles d'avant, non notées, ont été passées
  return `<div class="section-title">Étapes</div>
    <ol class="timeline">${JALONS_VOYAGE.map(([k, l]) => { const j = jalons.find((x) => x.type === k);
      return `<li class="${j ? "fait" : ""}"><span class="pt"></span><div><strong>${esc(l)}</strong>${j ? `<span class="sub">${dateHeureFr(j.date)}${j.source === "gps" ? " · " + badge("GPS", "ok") : ""}${(v.notifsJalons || []).includes(k) ? " · notifié" : ""}</span>` : ""}</div>${!actif ? "" : j ? iconBtn("notifier-jalon", "mail", "Notifier", `${v.id}|${k}`) : k === prochain ? btn("jalon", "Marquer", { id: `${v.id}|${k}`, icone: "flag", cls: "btn sm" }) : iconBtn("jalon", "check", "Marquer cette étape", `${v.id}|${k}`)}</li>`; }).join("")}</ol>
    ${jalons.length && actif ? `<div class="row">${btn("annuler-jalon", "Annuler la dernière étape", { id: v.id, cls: "btn ghost sm" })}</div>` : ""}`;
}
function blocInterdictionsVoyage(v) {
  if (!["prevu", "en_cours"].includes(v.statut) || !v.dateDepart) return "";
  const interd = interdictionsLe(v.dateDepart, INTERDICTIONS);
  return interd.length ? `<p class="hint">Départ un ${new Date(v.dateDepart + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long" })} : interdictions de circuler possibles (${interd.map((i) => i.pays).join(", ")}) — voir le tableau en bas de page.</p>` : "";
}
enregistrerBlocVoyage({ onglet: "suivi", ordre: (v) => (v.statut === "prevu" ? 10 : 30), rendu: (v) => `<div class="section-title">Traversée du détroit (Tanger Med ⇄ Algeciras)</div>${blocTraversee(v, "aller")}${blocTraversee(v, "retour")}` });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 20, rendu: (v) => (typeof blocPorts === "function" ? blocPorts(v) : "") });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 25, rendu: (v) => (typeof blocAttentesPort === "function" ? blocAttentesPort(v) : "") });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 50, rendu: blocEta });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 60, rendu: blocFroid });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 70, rendu: blocEtapesVoyage });
enregistrerBlocVoyage({ onglet: "suivi", ordre: 80, rendu: blocInterdictionsVoyage });

/* ---------- onglet Documents ---------- */
function blocPapiersVoyage(v) {
  const annule = v.statut === "annule", p = v.pod;
  return `<div class="section-title">Papiers du voyage</div>
    ${annule ? "" : `<div class="trav"><div><strong>CMR, lettre de voiture</strong><span class="sub">Préremplie avec le client, la marchandise, le camion et le chauffeur.</span></div><div class="r">${btn("cmr", "CMR (impression)", { id: v.id, icone: "print", cls: "btn ghost sm" })}</div></div>`}
    ${annule && !p ? "" : `<div class="trav"><div><strong>${p ? `Preuve de livraison : livré${p.signataire ? ` à ${esc(p.signataire)}` : ""}` : "Preuve de livraison"}</strong><span class="sub">${p ? `${dateHeureFr(p.date)}${p.lat ? ` · position ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : ""}${p.reserves ? ` · réserves : ${esc(p.reserves)}` : " · sans réserve"}` : "À faire signer par le destinataire, sur le téléphone, à la livraison."}</span></div>
      <div class="r"><div class="row">${p ? btn("preuve-imprimer", "Imprimer", { id: v.id, icone: "print", cls: "btn ghost sm" }) : ""}${annule ? "" : btn("preuve", p ? "Refaire la preuve de livraison" : "Preuve de livraison", { id: v.id, icone: "check", cls: `btn ${p ? "ghost " : ""}sm` })}</div></div></div>`}
    <div class="trav"><div><strong>Photos et documents scannés</strong><span class="sub">CMR signé, bons, reçus : rangés avec le voyage.</span></div><div class="r">${typeof boutonPhotos === "function" ? boutonPhotos("voyage:" + v.id, `Documents — ${v.ref}`, { texte: true }) : ""}</div></div>
    <div class="trav"><div><strong>Dossier complet du voyage</strong><span class="sub">Papiers, étapes, traversées, preuve de livraison, trace et photos en un seul document.</span></div><div class="r">${btn("dossier", "Dossier complet", { id: v.id, icone: "file", cls: "btn ghost sm" })}</div></div>`;
}
function blocReferencesVoyage(v) {
  const r = typeof referencesPortuaires === "function" ? referencesPortuaires(v) : [];
  return r.length ? `<div class="section-title">Références de douane</div><div class="trav"><div>${r.map((x) => `<span class="sub ref-douane"><strong>${esc(x.lib)} : ${esc(x.ref)}</strong> · ${esc(x.port)}</span>`).join("")}</div></div>` : "";
}
enregistrerBlocVoyage({ onglet: "documents", ordre: 20, rendu: blocPapiersVoyage });
enregistrerBlocVoyage({ onglet: "documents", ordre: 30, rendu: blocReferencesVoyage });

/* ---------- onglet Argent ---------- */
/** La marge d'abord, en grand, avec ce dont elle est faite et ce qui lui manque. */
function blocMargeResume(v) {
  if (v.statut === "annule") return "";
  const m = margeVoyage(v); if (!m) return "";
  const c = coutVoyage(v), couts = m.total_direct + m.total_structure, estimes = m.couts_directs.filter((l) => l.projete).length;
  if (!m.revenu) return `<div class="fiche-marge fin"><div class="tete"><span class="etiquette">Marge</span></div><div class="valeur"><strong>Prix non renseigné</strong></div><span class="sub">Coûts à ce jour : ${fmt(couts)} MAD. Renseignez le prix du voyage (Modifier) pour voir la marge.</span></div>`;
  const nette = m.total_structure > 0, marge = nette ? m.marge_nette : m.marge_directe, taux = (marge / m.revenu) * 100, neg = marge < 0;
  const gris = Math.max(0, Math.min(100, neg ? (m.revenu / couts) * 100 : (couts / m.revenu) * 100));
  const notes = [c.prixRetour ? `Aller ${fmt(c.prixAller)} MAD + retour ${fmt(c.prixRetour)} MAD` : "", v.devise === "EUR" ? `1 € = ${fmt(S.params.tauxEUR, 2)} MAD` : "", estimes ? `${estimes} coût${estimes > 1 ? "s" : ""} encore estimé${estimes > 1 ? "s" : ""}, remplacé${estimes > 1 ? "s" : ""} par les dépenses réelles à mesure qu'elles arrivent` : ""].filter(Boolean);
  return `<div class="fiche-marge fin ${neg ? "neg" : "pos"}">
    <div class="tete"><span class="etiquette">${nette ? "Marge nette" : "Marge directe"}</span><span class="sub">${nette ? "charges fixes comprises" : "charges fixes du camion non renseignées : non déduites"}</span></div>
    <div class="valeur"><strong>${fmt(marge)} MAD</strong><span>${fmt(taux, 1)} %</span></div>
    <div class="barre" role="img" aria-label="Part des coûts dans le prix"><i style="width:${Math.round(gris)}%"></i></div>
    <div class="pieds"><span>Coûts ${fmt(couts)} MAD</span><span>Prix ${fmt(m.revenu)} MAD</span></div>
    ${notes.length ? `<span class="sub">${notes.map(esc).join(" · ")}.</span>` : ""}</div>`;
}
enregistrerBlocVoyage({ onglet: "argent", ordre: 10, rendu: blocMargeResume });
enregistrerBlocVoyage({ onglet: "argent", ordre: 15, rendu: (v) => `<div class="fin"><div class="section-title">Coût et marge</div>${blocCoutsVoyage(v)}
  <div class="row" style="margin-top:8px">${btn("releve-eu", "Relevé péages Europe", { id: v.id, icone: "upload", cls: "btn ghost sm", titre: "Importer le relevé CSV de votre fournisseur de télépéage (DKV, UTA, Eurowag, Telepass…)" })}</div>${typeof blocLignesCout === "function" ? blocLignesCout(v) : ""}</div>` });
enregistrerBlocVoyage({ onglet: "argent", ordre: 20, rendu: (v) => (typeof blocFacturation === "function" ? blocFacturation(v) : "") });

/* ---------- onglet Équipe ---------- */
/** Papiers vérifiés au départ pour un voyage à venir, aujourd'hui pour un voyage en route. */
const jourPapiers = (v) => (v.dateDepart && v.dateDepart > today() ? v.dateDepart : today());
function blocEquipeVoyage(v) {
  const ch = parId(S.chauffeurs, v.chauffeurId), cam = parId(S.camions, v.camionId), jour = jourPapiers(v), aut = parId(S.autorisations, v.autorisationId);
  const papiers = (genre, r) => {
    if (typeof etatPapiers !== "function") return "";
    const l = etatPapiers(genre, r, jour), exp = l.filter((p) => p.statut === "expire").length, bientot = l.filter((p) => p.statut === "bientot").length;
    return `<button type="button" class="badge ${exp ? "danger" : bientot ? "warn" : "ok"} badge-btn" data-act="fiche-papiers" data-id="${v.id}|${genre}" title="Voir le détail des papiers et mettre à jour">${exp ? `${exp} papier${exp > 1 ? "s" : ""} expiré${exp > 1 ? "s" : ""}` : bientot ? `${bientot} papier${bientot > 1 ? "s" : ""} à renouveler` : "Papiers en règle"}</button>`;
  };
  const tel = ch?.tel && typeof telInternational === "function" ? telInternational(ch.tel) : "", sch = ch ? schengenEtat(ch.sejours) : null;
  return `<div class="section-title">Chauffeur et camion</div>
    <div class="trav"><div><strong>${ch ? esc(ch.nom) : "Chauffeur à affecter"}</strong><span class="sub">${ch ? [ch.tel, sch && (sch.depasse ? "Schengen : limite des 90 jours dépassée" : `Schengen : ${sch.restant} j restants sur 90`), ch.visa && `visa jusqu'au ${dateFr(ch.visa)}`].filter(Boolean).map(esc).join(" · ") || "Téléphone non renseigné" : "Le voyage ne peut pas partir sans chauffeur."}</span></div>
      <div class="r">${ch ? papiers("chauffeur", ch) : ""}<div class="row">${tel ? `<a class="btn ghost sm" href="tel:+${tel}">${ic("phone")}Appeler</a><a class="btn ghost sm" href="https://wa.me/${tel}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${ch ? "" : btn("modifier", "Affecter", { id: v.id, cls: "btn sm" })}</div></div></div>
    <div class="trav"><div><strong>${cam ? esc(cam.immat) : "Camion à affecter"}</strong><span class="sub">${cam ? [cam.marque, v.remorque && `remorque ${v.remorque}`, num(v.ptacT) && `${fmt(v.ptacT, 1)} t prévues`, aut && `autorisation ${aut.type === "MA" ? "« MA »" : "« E »"} ${aut.numero || ""}`.trim()].filter(Boolean).map(esc).join(" · ") || "Tracteur du voyage" : "Le voyage ne peut pas partir sans camion."}</span></div>
      <div class="r">${cam ? papiers("camion", cam) : btn("modifier", "Affecter", { id: v.id, cls: "btn sm" })}</div></div>`;
}
function blocControlesVoyage(v) {
  if (!["prevu", "en_cours"].includes(v.statut)) return "";
  const ctl = controlesVoyage(v);
  if (!ctl.length) return v.statut === "prevu" ? `<div class="section-title">À régler avant le départ</div><p class="hint" style="color:var(--ok);margin-top:0">${ic("check")} Aucun point bloquant détecté.</p>` : "";
  return `<div class="section-title">${v.statut === "prevu" ? "À régler avant le départ" : "Points à surveiller"}</div><ul class="ctl">${ctl.map((x) => `<li class="${niveauCtl[x.niveau]}">${ic(x.niveau === "danger" ? "alert" : "clock")}<span>${esc(x.texte)}</span></li>`).join("")}</ul>`;
}
function blocChecklistsVoyage(v) {
  const ck = ongletCheck[v.id] || "depart", items = CHECKLISTS_VOYAGE[ck], faits = items.filter((_, i) => v.coches?.[ck]?.[i]).length;
  return `<div class="section-title">Listes de contrôle</div>
    <div class="segmented">${Object.entries(LIB_CHECKLISTS_VOYAGE).map(([k, l]) => `<button type="button" data-act="onglet-check" data-id="${v.id}|${k}" aria-selected="${k === ck}">${l}</button>`).join("")}</div>
    <div class="progress"><i style="width:${Math.round((faits / items.length) * 100)}%"></i></div>
    <div class="checklist">${items.map((it, i) => `<label class="check"><input type="checkbox" data-coche="${v.id}" data-ck="${ck}" data-i="${i}" ${v.coches?.[ck]?.[i] ? "checked" : ""}><span>${esc(it)}</span></label>`).join("")}</div>`;
}
enregistrerBlocVoyage({ onglet: "equipe", ordre: 10, rendu: blocEquipeVoyage });
enregistrerBlocVoyage({ onglet: "equipe", ordre: 20, rendu: blocControlesVoyage });
enregistrerBlocVoyage({ onglet: "equipe", ordre: 30, rendu: blocChecklistsVoyage });
enregistrerBlocVoyage({ onglet: "equipe", ordre: 40, rendu: (v) => (v.notes ? `<div class="section-title">Notes</div><p class="fiche-notes">${esc(v.notes)}</p>` : "") });

/* ---------- gestes propres à la fiche ---------- */
const agirVoyagesAvantFiche = VUES.voyages.agir;
VUES.voyages.agir = async function (act, id, b) {
  if (!String(act).startsWith("fiche-")) return agirVoyagesAvantFiche.call(this, act, id, b);
  const [x, extra] = String(id).split("|");
  if (act === "fiche-onglet") {
    if (!parId(S.voyages, x)) return;
    ongletFiche.set(x, extra); voyagesOuverts.add(x); majFiche(x);
    if (!b?.closest?.(".fiche-onglets")) document.querySelector(`details[data-voyage="${CSS.escape(x)}"] .fiche-onglets`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if (act === "fiche-papiers") {
    const v = parId(S.voyages, x), r = v && (extra === "chauffeur" ? parId(S.chauffeurs, v.chauffeurId) : parId(S.camions, v.camionId));
    return r && typeof expliquerPapiers === "function" ? expliquerPapiers(extra, r, jourPapiers(v)) : undefined;
  }
  const f = parId(S.factures, x); if (!f) return;
  if (act === "fiche-envoyer-facture") return typeof envoyerFacture === "function" ? envoyerFacture(f) : afficher("factures");
  if (act === "fiche-encaisser") return VUES.factures.agir.call(VUES.factures, "payer", f.id);
  if (act === "fiche-relancer") return VUES.factures.agir.call(VUES.factures, "relance", f.id);
};
// La liste « autres actions » se referme quand on clique ailleurs.
document.addEventListener("click", (e) => { for (const m of document.querySelectorAll("details.menu-plus[open]")) if (!m.contains(e.target)) m.open = false; });
