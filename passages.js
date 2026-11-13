"use strict";
/* ============================================================
   Centre des passages en douane — logique pure, testée.
   Pour chaque étape du passage des ports (data.js, PORTS_PASSAGE ; portuaire.js) :
   · ce que l'étape faite veut dire et ce qui suit (étape suivante, documents, qui doit agir) ;
   · alertes : attente trop longue avant l'étape suivante, inspection physique (couloir rouge), référence non notée (DUM, TIR/T1, MRN, CHED) ;
   · à préparer avant d'arriver : CHED dans TRACES (marchandise fraîche), déclaration sommaire d'entrée (ENS), export UE et DUM import au retour ;
   · messages prêts à envoyer (fil de l'application, transitaire, exploitation, chauffeur), selon un routage réglable.
   Sources : Tanger Med (passage portuaire dématérialisé, résultat du scanner transmis à BADR, bon douanier d'embarquement),
   ministère espagnol de l'Agriculture (PCF d'Algeciras : CHED partie I au moins un jour ouvrable avant, contrôle documentaire, d'identité,
   physique, partie II puis dédouanement ; horaires), règlement EES (pleinement en service depuis le 10/04/2026), ICS2 (ENS avant l'arrivée).
   Les délais sont des repères, réglables : ils servent à prévenir, pas à juger.
   Dépend de data.js (PORTS_PASSAGE), noyau.js, portuaire.js.
   ============================================================ */

const ORDRE_PASSAGE = { aller: ["tmed_export", "alg_entree"], retour: ["alg_sortie", "tmed_import"] };
const ACTEURS_PASSAGE = { transitaire: "Transitaire", chauffeur: "Chauffeur", douane: "Douane", police: "Police des frontières", sanitaire: "Contrôle sanitaire", port: "Port / armateur", importateur: "Importateur" };
/** Par étape : ce que « fait » veut dire, qui agit pour arriver à cette étape, délai habituel (minutes) depuis l'étape précédente, référence attendue. */
const SUITES_PASSAGE = {
  tme_parc: { acteur: "chauffeur", seuil: 0, apres: "Le camion est au parc de régulation export. Le passage portuaire est dématérialisé : le transitaire doit avoir saisi camion, chauffeur et marchandise dans PortNet pour que le camion soit appelé." },
  tme_portnet: { acteur: "transitaire", seuil: 90, refRequise: true, apres: "Le dossier est enregistré dans PortNet et la DUM export déposée dans BADR. La marchandise est désormais sous contrôle douanier : rien ne doit être ajouté ni retiré du camion." },
  tme_douane: { acteur: "douane", seuil: 120, refRequise: true, apres: "La douane a validé la DUM et le titre de transit (TIR ou T1). Le « bon à embarquer » douanier dépend encore du scanner et, pour le frais, du certificat d'inspection (transmis automatiquement à BADR)." },
  tme_sanitaire: { acteur: "sanitaire", seuil: 120, refRequise: true, apres: "Le certificat d'inspection export (EACCE / ONSSA) est délivré et transmis à BADR : il compte pour le bon douanier d'embarquement." },
  tme_scanner: { acteur: "douane", seuil: 60, apres: "Passage au scanner terminé ; son résultat part automatiquement dans BADR. Couloir vert : le camion continue. Couloir rouge : inspection physique en présence du transitaire." },
  tme_police: { acteur: "police", seuil: 45, apres: "Sortie du territoire marocain enregistrée pour le chauffeur et le véhicule." },
  tme_tmpa: { acteur: "port", seuil: 60, apres: "Droits de port réglés, le camion est en file de pré-embarquement." },
  tme_embarquement: { acteur: "port", seuil: 180, refRequise: false, apres: "Le camion est à bord. Traversée d'environ 1 h 30 vers Algeciras." },
  alg_debarquement: { acteur: "port", seuil: 180, apres: "Le camion est débarqué à Algeciras et rejoint la zone de contrôle." },
  alg_police: { acteur: "police", seuil: 60, apres: "Entrée Schengen enregistrée dans l'EES (système européen d'entrée et de sortie, en service complet depuis le 10/04/2026) : chaque jour passé dans l'espace Schengen est compté automatiquement." },
  alg_douane: { acteur: "douane", seuil: 120, refRequise: true, apres: "La douane espagnole a accepté le titre de transit ou la déclaration d'importation (MRN). Le transit doit être apuré au bureau de destination, dans le délai fixé." },
  alg_pcf: { acteur: "sanitaire", seuil: 240, refRequise: true, apres: "Le poste de contrôle frontalier a libéré la marchandise (partie II du CHED) : le dédouanement peut se terminer. Contrôles : documentaire, d'identité, et physique pour une partie des lots (prélèvement possible)." },
  alg_sortie: { acteur: "chauffeur", seuil: 60, apres: "Le camion a quitté le port d'Algeciras : route vers la destination." },
  ras_arrivee: { acteur: "chauffeur", seuil: 0, apres: "Le camion est au port d'Algeciras pour le retour." },
  ras_douane: { acteur: "douane", seuil: 120, refRequise: true, apres: "Sortie de l'Union validée par la douane d'Algeciras (déclaration d'export, système ECS) : l'exportateur européen aura sa preuve de sortie (exonération de TVA)." },
  ras_police: { acteur: "police", seuil: 60, apres: "Sortie Schengen enregistrée dans l'EES : le séjour du chauffeur est fermé, ses jours restants sont recalculés." },
  ras_embarquement: { acteur: "port", seuil: 180, apres: "Le camion est à bord vers Tanger Med." },
  tmi_debarquement: { acteur: "port", seuil: 180, apres: "Le camion est débarqué à Tanger Med, zone de contrôle import." },
  tmi_police: { acteur: "police", seuil: 60, apres: "Entrée au Maroc enregistrée pour le chauffeur et le véhicule." },
  tmi_scanner: { acteur: "douane", seuil: 90, apres: "Passage au scanner terminé ; résultat transmis à BADR. Couloir rouge : inspection physique." },
  tmi_douane: { acteur: "transitaire", seuil: 180, refRequise: true, apres: "La DUM import est liquidée : droits et TVA à l'import calculés et payés. Reste la mainlevée (bon à enlever)." },
  tmi_controles: { acteur: "sanitaire", seuil: 120, apres: "Contrôles propres à la marchandise terminés (ONSSA, normes…)." },
  tmi_mainlevee: { acteur: "douane", seuil: 120, apres: "Mainlevée obtenue : le camion quitte le port, la marchandise est libre au Maroc." },
};
/** Conseils quand l'attente avant une étape dépasse le repère. */
const CONSEILS_RETARD = {
  tme_portnet: "Le camion attend d'être appelé : vérifiez avec le transitaire que la saisie PortNet et la DUM sont complètes.",
  tme_douane: "Demandez au transitaire si la DUM est « en circuit » de contrôle et s'il manque un document (facture, EUR.1, carnet TIR).",
  tme_sanitaire: "Vérifiez que la demande d'inspection export (EACCE) est faite et que le lot est prêt à être contrôlé.",
  tme_embarquement: "Vérifiez la réservation et l'heure du prochain départ auprès de l'armateur.",
  alg_douane: "Vérifiez avec le représentant en douane en Espagne que le transit (TIR/T1) ou la déclaration est bien enregistré.",
  alg_pcf: "Le PCF ne contrôle que les lots dont la partie I du CHED est validée dans TRACES. Horaires du PCF d'Algeciras : lun.–ven. 7 h 30–22 h, sam., dim. et fêtes 9 h 30–22 h.",
  ras_douane: "Vérifiez que la déclaration d'export (MRN) a été transmise et que le camion est attendu au bureau de sortie.",
  tmi_douane: "Demandez au transitaire où en est la DUM import (circuit, liquidation, paiement des droits).",
  tmi_mainlevee: "Le bon à enlever attend souvent le paiement des droits ou la fin d'un contrôle : demandez au transitaire.",
};
const seuilPassage = (id) => { const p = num(S.params?.seuilsPassage?.[id], NaN); return Number.isFinite(p) && p >= 0 ? p : SUITES_PASSAGE[id]?.seuil || 0; };

/** Étapes d'un sens dans l'ordre, avec leur état : [{ e, port, s }]. */
function chainePassage(v, sens) {
  return ORDRE_PASSAGE[sens].flatMap((port) => etapesApplicables(v, port).map((e) => ({ e: { ...e, port }, port, s: etatEtapePort(v, e) })));
}
const etapePortLib = (x) => `${PORTS_PASSAGE[x.port].lib.split(" — ")[0]} — ${x.e.lib}`;
/** Description d'une étape à venir : { id, lib, detail, docs, acteur, seuil, fait, date }. */
const suiteDe = (x) => ({ id: x.e.id, lib: etapePortLib(x), detail: x.e.detail, docs: x.e.docs, acteur: ACTEURS_PASSAGE[SUITES_PASSAGE[x.e.id]?.acteur] || "", seuil: seuilPassage(x.e.id), fait: !!x.s.fait, date: x.s.fait ? x.s.date : "" });
/** Ce qui suit une étape dans l'ordre du passage (l'étape obligatoire suivante, faite ou non), ou la suite du voyage. */
function suiteEtape(v, sens, apresId) {
  const ch = chainePassage(v, sens), i = ch.findIndex((x) => x.e.id === apresId);
  const prochaine = ch.slice(i + 1).find((x) => !x.e.facultatif);
  if (prochaine) return suiteDe(prochaine);
  return sens === "aller" ? { id: "", lib: `Route vers ${v.destination || "la destination"}`, detail: "Passage des ports terminé à l'aller.", docs: [], acteur: "Chauffeur" } : { id: "", lib: "Retour au dépôt", detail: "Passage des ports terminé au retour.", docs: [], acteur: "Chauffeur" };
}
const dureePassage = (min) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
const CATEGORIE_ETAPE = (id) => (["tme_portnet", "tme_douane", "tme_sanitaire", "alg_douane", "alg_pcf", "ras_douane", "tmi_douane", "tmi_controles", "tmi_mainlevee"].includes(id) ? "douane" : "etape");

/**
 * Événements de passage d'un voyage, du plus récent au plus ancien :
 * [{ id, voyageId, ref, sens, port, etape, type: "fait" | "inspection" | "reference" | "retard" | "preparer", categorie, niveau, date, titre, texte, suite?, conseil? }].
 */
function evenementsPassage(v, maintenant = Date.now()) {
  if (!v || v.statut === "annule") return [];
  const ev = [], ref = v.ref || "", estFr = estFrais(v), jalon = (t) => (v.jalons || []).find((j) => j.type === t);
  for (const sens of ["aller", "retour"]) {
    const ch = chainePassage(v, sens);
    for (const x of ch) {
      if (!x.s.fait) continue;
      const sp = SUITES_PASSAGE[x.e.id] || {}, suite = suiteEtape(v, sens, x.e.id), base = { voyageId: v.id, ref, sens, port: x.port, etape: x.e.id };
      ev.push({ ...base, id: `${v.id}:${x.e.id}:fait`, type: "fait", categorie: CATEGORIE_ETAPE(x.e.id), niveau: "ok", date: x.s.date, titre: `${ref} · ${etapePortLib(x)}`, texte: `${sp.apres || x.e.detail}${x.s.ref ? ` ${x.e.ref || "Réf."} : ${x.s.ref}.` : ""}${x.s.note ? ` Note : ${x.s.note}.` : ""}`, suite, source: x.s.source });
      if (x.s.inspection) ev.push({ ...base, id: `${v.id}:${x.e.id}:inspection`, type: "inspection", categorie: "alerte", niveau: "warn", date: x.s.date, titre: `${ref} · inspection physique au scanner (${PORTS_PASSAGE[x.port].lib.split(" — ")[0]})`, texte: "Couloir rouge : la marchandise est contrôlée physiquement (ouverture, parfois déchargement partiel). Comptez plusieurs heures de plus ; le chauffeur reste près du camion et le transitaire assiste au contrôle. Cette attente est écartée de vos temps moyens au port.", suite });
      if (sp.refRequise && x.e.ref && !x.s.ref && x.s.source === "saisie") ev.push({ ...base, id: `${v.id}:${x.e.id}:reference`, type: "reference", categorie: "alerte", niveau: "warn", date: x.s.date, titre: `${ref} · ${x.e.ref} non noté (${x.e.lib})`, texte: `Demandez le ${x.e.ref} au transitaire et notez-le : il sert en cas de contrôle ou de litige, pour le dossier du voyage et la facture.` });
    }
    // attente trop longue avant la prochaine étape (seulement pendant le passage, dans les 48 h)
    const faites = ch.filter((x) => x.s.fait && Number.isFinite(Date.parse(x.s.date))).sort((a, b) => Date.parse(a.s.date) - Date.parse(b.s.date)), derniere = faites[faites.length - 1];
    if (derniere && maintenant - Date.parse(derniere.s.date) < 48 * 3600000) {
      const i = ch.findIndex((x) => x.e.id === derniere.e.id), prochaine = ch.slice(i + 1).find((x) => !x.s.fait && !x.e.facultatif);
      const seuil = prochaine && seuilPassage(prochaine.e.id), attente = (maintenant - Date.parse(derniere.s.date)) / 60000;
      if (prochaine && seuil > 0 && attente > seuil) {
        const grave = attente > 2 * seuil;
        ev.push({ voyageId: v.id, ref, sens, port: prochaine.port, etape: prochaine.e.id, id: `${v.id}:${prochaine.e.id}:retard:${grave ? 2 : 1}`, type: "retard", categorie: "alerte", niveau: grave ? "danger" : "warn", date: new Date(Date.parse(derniere.s.date) + (grave ? 2 : 1) * seuil * 60000).toISOString(),
          titre: `${ref} · en attente depuis ${dureePassage(attente)} : ${etapePortLib(prochaine)}`, texte: `Dernière étape faite : ${derniere.e.lib} (${new Date(Date.parse(derniere.s.date)).toISOString().slice(11, 16)} UTC). Habituellement moins de ${dureePassage(seuil)}.`, conseil: CONSEILS_RETARD[prochaine.e.id] || "", suite: suiteDe(prochaine) });
      }
    }
  }
  // à préparer avant d'arriver
  const PORT_PREP = { ched: "alg_entree", ens: "alg_entree", export_ue: "alg_sortie", dum_import: "tmed_import" };
  const prep = (id, date, titre, texte, faitDeja) => { if (date && !faitDeja) ev.push({ voyageId: v.id, ref, port: PORT_PREP[id], id: `${v.id}:${id}:preparer`, type: "preparer", categorie: "preparer", niveau: "info", date, titre: `${ref} · ${titre}`, texte }); };
  const fait = (id) => !!etatEtapePort(v, etapePort(id) || {}).fait, dateFait = (id) => (fait(id) ? etatEtapePort(v, etapePort(id)).date : null);
  const departAller = jalon("depart")?.date || dateFait("tme_parc");
  if (estFr) prep("ched", departAller, "CHED à déposer dans TRACES avant Algeciras", "Marchandise fraîche : l'importateur (ou son agent) doit déposer la partie I du CHED dans TRACES au moins un jour ouvrable avant l'arrivée au poste de contrôle frontalier d'Algeciras (4 h minimum si justifié). Sans elle, le PCF ne contrôle pas le lot et le camion attend.", !!v.etapesPort?.alg_pcf?.ref || fait("alg_pcf"));
  prep("ens", dateFait("tme_douane") || dateFait("tme_portnet"), "Déclaration d'entrée dans l'UE (ENS) avant l'arrivée", "Avant l'arrivée du navire à Algeciras, la déclaration sommaire d'entrée (ENS, système ICS2) doit être déposée par le transporteur ou son représentant. Vérifiez avec votre transitaire ou représentant en Espagne qu'elle est faite (numéro MRN de l'ENS).", fait("alg_douane"));
  const finAller = jalon("livre")?.date || jalon("charge_retour")?.date;
  prep("export_ue", finAller, "Retour : déclaration d'export UE à préparer", "Pour une marchandise chargée dans l'UE, la déclaration d'export (MRN) doit être faite avant Algeciras ; la douane d'Algeciras valide la sortie (ECS), preuve d'exonération de TVA pour l'exportateur.", fait("ras_douane"));
  prep("dum_import", dateFait("ras_embarquement") || dateFait("ras_douane"), "Retour : DUM import à préparer pour Tanger Med", "Envoyez au transitaire marocain facture, CMR et certificat d'origine EUR.1 (préférence UE-Maroc) pour qu'il dépose la DUM import dans BADR avant l'arrivée : la mainlevée sera plus rapide.", fait("tmi_douane"));
  return ev.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** Voyages en cours de passage : [{ v, sens, port, derniere, prochaine, depuisMin, retard, faites, total }]. */
function voyagesEnPassage(maintenant = Date.now()) {
  const r = [];
  for (const v of S.voyages) {
    if (v.statut === "annule" || v.statut === "termine") continue;
    for (const sens of ["aller", "retour"]) {
      const ch = chainePassage(v, sens), faites = ch.filter((x) => x.s.fait && Number.isFinite(Date.parse(x.s.date))).sort((a, b) => Date.parse(a.s.date) - Date.parse(b.s.date));
      if (!faites.length || ch.filter((x) => !x.e.facultatif).every((x) => x.s.fait)) continue;
      const derniere = faites[faites.length - 1]; if (maintenant - Date.parse(derniere.s.date) > 48 * 3600000) continue;
      const i = ch.findIndex((x) => x.e.id === derniere.e.id), prochaine = ch.slice(i + 1).find((x) => !x.s.fait && !x.e.facultatif) || ch.find((x) => !x.s.fait && !x.e.facultatif);
      const depuisMin = (maintenant - Date.parse(derniere.s.date)) / 60000, seuil = prochaine ? seuilPassage(prochaine.e.id) : 0;
      const sautees = ch.slice(0, i).filter((x) => !x.s.fait && !x.e.facultatif).map((x) => x.e);
      r.push({ v, sens, enMer: !!derniere.e.jalon?.startsWith("embarque") && prochaine?.port !== derniere.port, port: prochaine?.port || derniere.port, derniere, prochaine, suite: prochaine ? suiteDe(prochaine) : null, sautees, depuisMin, seuil, retard: seuil > 0 && depuisMin > seuil, faites: ch.filter((x) => x.s.fait).length, total: ch.length });
    }
  }
  return r.sort((a, b) => Number(b.retard) - Number(a.retard) || b.depuisMin - a.depuisMin);
}
/** Tous les événements (voyages des 30 derniers jours), filtrables : { type: "alertes" | "preparer" | "fait" | "", voyageId }. */
function centrePassages({ maintenant = Date.now(), filtre = "", voyageId = "" } = {}) {
  const depuis = new Date(maintenant - 30 * 86400000).toISOString();
  return S.voyages.filter((v) => !voyageId || v.id === voyageId).flatMap((v) => evenementsPassage(v, maintenant)).filter((e) => e.date >= depuis && e.date <= new Date(maintenant + 60000).toISOString())
    .filter((e) => !filtre || (filtre === "alertes" ? e.categorie === "alerte" : filtre === "preparer" ? e.type === "preparer" : e.type === "fait"))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ---------- routage : qui est prévenu, pour quelle catégorie ---------- */
const CATEGORIES_PASSAGE = [["douane", "Étapes de douane et de contrôle faites"], ["etape", "Autres étapes faites (parc, scanner, police, embarquement…)"], ["alerte", "Alertes : attente trop longue, inspection, référence manquante"], ["preparer", "À préparer avant d'arriver (CHED, ENS, export, DUM import)"], ["chauffeur", "Au chauffeur : prochaine étape et documents à présenter"]];
const AUDIENCES_PASSAGE = [["in_app", "Fil de l'application"], ["dispatcher_casa", "Exploitation Maroc"], ["exploitante_frankfurt", "Exploitation Allemagne"], ["chef_entreprise", "Direction"], ["transitaire", "Transitaire"], ["chauffeur", "Chauffeur"]];
const ROUTAGE_PASSAGE_DEFAUT = { douane: ["in_app"], etape: ["in_app"], alerte: ["in_app", "dispatcher_casa", "transitaire"], preparer: ["in_app", "transitaire"], chauffeur: [] };
const routagePassages = () => ({ ...ROUTAGE_PASSAGE_DEFAUT, ...(S.params?.routagePassages || {}) });
const canalAudiencePassage = (a) => (a === "in_app" ? "in_app" : a === "chauffeur" ? "prefere" : AUDIENCES_NOTIF.find((x) => x[0] === a)?.[2] === "in_app" ? "prefere" : AUDIENCES_NOTIF.find((x) => x[0] === a)?.[2] || "prefere");
/** Texte d'un message : ce qui s'est passé, puis ce qui suit. */
function texteEvenement(ev, { pourChauffeur = false } = {}) {
  if (pourChauffeur) { const s = ev.suite; return s?.id ? `${ev.ref} — étape suivante : ${s.lib}.${s.docs?.length ? ` À présenter : ${s.docs.join(", ")}.` : ""}` : `${ev.ref} — ${s?.lib || "passage terminé"}.`; }
  const s = ev.suite;
  return `${ev.titre}\n${ev.texte}${ev.conseil ? `\n${ev.conseil}` : ""}${s ? `\nEnsuite : ${s.lib}${s.acteur ? ` (${s.acteur})` : ""}${s.docs?.length ? ` — à présenter : ${s.docs.join(", ")}` : ""}.` : ""}`;
}
/** Messages d'un événement selon le routage : { messages, manques }. */
function messagesEvenement(ev, { routage = routagePassages() } = {}) {
  const v = parId(S.voyages, ev.voyageId), messages = [], manques = [];
  if (!v) return { messages, manques };
  const audiences = [...(routage[ev.categorie] || []).filter((a) => a !== "chauffeur"), ...(ev.type === "fait" && (routage.chauffeur || []).includes("chauffeur") ? ["chauffeur"] : [])];
  for (const a of new Set(audiences)) {
    const d = destinataireNotif(a, canalAudiencePassage(a), v);
    if (d.manque) { manques.push(d.manque); continue; }
    messages.push({ ...d, id: `passage:${ev.id}:${a}`, cle: `passage:${ev.id}:${a}`, audience: a, voyageId: v.id, sujet: ev.titre, texte: texteEvenement(ev, { pourChauffeur: a === "chauffeur" }), quand: Date.parse(ev.date) || Date.now() });
  }
  return { messages, manques };
}
/** Événements récents (12 h) pas encore notifiés par cet appareil. */
function passagesANotifier(maintenant = Date.now()) {
  const depuis = new Date(maintenant - 12 * 3600000).toISOString(), r = [];
  for (const v of S.voyages) for (const ev of evenementsPassage(v, maintenant)) if (ev.date >= depuis && ev.date <= new Date(maintenant + 60000).toISOString() && !(v.notifsPassage || []).includes(ev.id)) r.push({ v, ev });
  return r;
}

/* ---------- vue par port : Tanger Med, Algeciras ---------- */
const LIEUX_PASSAGE = { tmed: { lib: "Tanger Med", ports: ["tmed_export", "tmed_import"] }, alg: { lib: "Algeciras", ports: ["alg_entree", "alg_sortie"] } };
const lieuDuPort = (port) => Object.keys(LIEUX_PASSAGE).find((k) => LIEUX_PASSAGE[k].ports.includes(port)) || "";
const medianeMin = (l) => { const t = l.filter(Number.isFinite).sort((a, b) => a - b); if (!t.length) return null; const m = Math.floor(t.length / 2); return Math.round(t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2); };
/** Durées passées (minutes) de vos voyages des `jours` derniers jours : par étape (depuis l'étape précédente du même port) et par port (de la première à la dernière étape), inspections écartées. */
function dureesPassage({ maintenant = Date.now(), jours = 90 } = {}) {
  const depuis = maintenant - jours * 86400000, etapes = {}, ports = {};
  for (const v of S.voyages) {
    if (v.statut === "annule") continue;
    for (const port of Object.keys(PORTS_PASSAGE)) {
      if (v.scanRouge?.[PORTS_PASSAGE[port].portAttente]) continue; // inspection physique : hors repères
      const faites = etapesApplicables(v, port).map((e) => ({ e, s: etatEtapePort(v, e) })).filter((x) => x.s.fait && Number.isFinite(Date.parse(x.s.date)));
      if (!faites.length || Date.parse(faites[0].s.date) < depuis) continue;
      const ordre = faites.slice().sort((a, b) => Date.parse(a.s.date) - Date.parse(b.s.date));
      for (let i = 1; i < ordre.length; i++) (etapes[ordre[i].e.id] ||= []).push((Date.parse(ordre[i].s.date) - Date.parse(ordre[i - 1].s.date)) / 60000);
      const r = resumePort(v, port, maintenant); if (r.fini && r.dureeMs > 0) (ports[port] ||= []).push(r.dureeMs / 60000);
    }
  }
  return { etapes: Object.fromEntries(Object.entries(etapes).map(([k, l]) => [k, { mediane: medianeMin(l), n: l.length }])), ports: Object.fromEntries(Object.entries(ports).map(([k, l]) => [k, { mediane: medianeMin(l), n: l.length }])) };
}
/**
 * Ce qui se passe dans un port : { lib, dedans: [voyagesEnPassage…], sens: [{ port, lib, etapes: [{ e, attente: [voyages dont c'est la prochaine étape], mediane, n, repere }], mediane, n }], alertes, termines }.
 */
function vuePort(lieu, { maintenant = Date.now() } = {}) {
  const L = LIEUX_PASSAGE[lieu]; if (!L) return null;
  const dedans = voyagesEnPassage(maintenant).filter((x) => L.ports.includes(x.port)), d = dureesPassage({ maintenant });
  const sens = L.ports.map((port) => ({ port, lib: PORTS_PASSAGE[port].lib, mediane: d.ports[port]?.mediane ?? null, n: d.ports[port]?.n || 0,
    etapes: PORTS_PASSAGE[port].etapes.map((e) => ({ e, attente: dedans.filter((x) => x.prochaine?.e.id === e.id), mediane: d.etapes[e.id]?.mediane ?? null, n: d.etapes[e.id]?.n || 0, repere: seuilPassage(e.id) })) }));
  const evts = centrePassages({ maintenant }).filter((e) => L.ports.includes(e.port));
  const termines = S.voyages.flatMap((v) => L.ports.map((port) => ({ v, port, r: resumePort(v, port, maintenant) }))).filter((x) => x.r.fini && x.r.fin && maintenant - x.r.fin < 7 * 86400000).sort((a, b) => b.r.fin - a.r.fin).slice(0, 8);
  return { lieu, lib: L.lib, dedans, sens, alertes: evts.filter((e) => e.categorie === "alerte"), evenements: evts, termines };
}
