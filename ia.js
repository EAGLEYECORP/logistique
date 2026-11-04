"use strict";
/* ============================================================
   Assistant IA — classement SH des marchandises (Claude, Anthropic)
   L'appel part directement du navigateur avec la clé API de l'utilisateur.
   La clé est stockée à part (jamais incluse dans les sauvegardes exportées).
   ============================================================ */

const IA_STORAGE_KEY = "logistique-ia";

// Prix publics en dollars US par million de jetons (entrée / sortie).
const IA_MODELES = [
  { id: "claude-opus-5-5", nom: "Claude Opus 5.5 — le plus précis (recommandé)", entree: 4, sortie: 20, fallbacks: true },
  { id: "claude-sonnet-5-5", nom: "Claude Sonnet 5.5 — équilibré", entree: 2, sortie: 10, fallbacks: true },
  { id: "claude-haiku-5-5", nom: "Claude Haiku 5.5 — le moins cher", entree: 0.1, sortie: 0.5, fallbacks: false },
];

function iaConfig() {
  try { return { cle: "", modele: IA_MODELES[0].id, ...JSON.parse(localStorage.getItem(IA_STORAGE_KEY) || "{}") }; }
  catch { return { cle: "", modele: IA_MODELES[0].id }; }
}
function iaSauverConfig(c) {
  try { localStorage.setItem(IA_STORAGE_KEY, JSON.stringify(c)); } catch { /* stockage indisponible */ }
}
const iaModele = (id) => IA_MODELES.find((m) => m.id === id) || IA_MODELES[0];

const IA_SYSTEME = `Tu es un expert en classement tarifaire douanier qui assiste un transitaire au Maroc.
Ta mission : proposer le classement d'une marchandise dans le Système Harmonisé (SH) à partir de sa description.

Méthode :
- Applique les Règles générales interprétatives (RGI 1 à 6) dans l'ordre et cite celle qui décide du classement.
- Tiens compte des notes de section et de chapitre, de la matière constitutive, de la fonction et du degré d'élaboration.
- Propose de 1 à 3 classements, du plus probable au moins probable. N'en propose plusieurs que si un doute réel existe.
- Le code à 6 chiffres (SH international) est au format « 0000.00 ».
- Le code national marocain compte 10 chiffres. Ne le donne que si tu es raisonnablement sûr de la sous-position nationale ; sinon laisse le champ vide. Ne l'invente jamais.
- Indique ta confiance honnêtement : « elevee », « moyenne » ou « faible ». Si la description est trop vague, mets « faible » et pose des questions précises.
- Liste les points à vérifier (composition, usage, présentation…) qui pourraient changer le classement.
- Liste les contrôles ou autorisations probables au Maroc (ONSSA, MCINET, ANRT, normes, etc.) seulement s'ils sont plausibles pour ce produit.
- Ne donne pas de taux de droits : ils changent avec la loi de finances.
Réponds en français, de façon concise et concrète.`;

const IA_SCHEMA = {
  type: "object",
  properties: {
    comprehension: { type: "string", description: "Reformulation courte de la marchandise telle que comprise" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code_sh6: { type: "string", description: "Sous-position SH à 6 chiffres, format 0000.00" },
          code_national: { type: "string", description: "Code marocain à 10 chiffres, ou chaîne vide si incertain" },
          designation: { type: "string" },
          confiance: { type: "string", enum: ["elevee", "moyenne", "faible"] },
          justification: { type: "string", description: "Raisonnement court avec la RGI et les notes appliquées" },
          points_a_verifier: { type: "array", items: { type: "string" } },
        },
        required: ["code_sh6", "code_national", "designation", "confiance", "justification", "points_a_verifier"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: { type: "string" }, description: "Questions pour lever les doutes, vide si aucune" },
    controles: { type: "array", items: { type: "string" }, description: "Contrôles ou autorisations probables au Maroc" },
  },
  required: ["comprehension", "suggestions", "questions", "controles"],
  additionalProperties: false,
};

/** Coût approximatif d'une réponse, en dollars. */
function iaCout(usage, modeleId) {
  const m = iaModele(modeleId);
  const entree = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  return (entree * m.entree + (usage?.output_tokens || 0) * m.sortie) / 1e6;
}

/** Transforme la réponse de l'API en résultat affichable, ou lève une erreur lisible. */
function iaInterpreter(reponse, modeleDemande) {
  if (reponse.stop_reason === "refusal") throw new Error("L'assistant a refusé cette demande. Reformulez la description de la marchandise.");
  if (reponse.stop_reason === "max_tokens") throw new Error("La réponse a été coupée. Réessayez avec une description plus courte.");
  const texte = (reponse.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try { data = JSON.parse(texte); } catch { throw new Error("Réponse illisible de l'assistant. Réessayez."); }
  if (!Array.isArray(data.suggestions)) throw new Error("Réponse incomplète de l'assistant. Réessayez.");
  return {
    ...data,
    modele: reponse.model || modeleDemande,
    secours: !!reponse.model && reponse.model !== modeleDemande,
    cout: iaCout(reponse.usage, reponse.model || modeleDemande),
  };
}

function iaMessageErreur(e) {
  const SDK = window.AnthropicSDK || {};
  if (SDK.AuthenticationError && e instanceof SDK.AuthenticationError) return "Clé API refusée. Vérifiez-la dans Réglages → Assistant IA.";
  if (SDK.PermissionDeniedError && e instanceof SDK.PermissionDeniedError) return "Cette clé n'a pas accès à ce modèle. Choisissez-en un autre dans Réglages.";
  if (SDK.RateLimitError && e instanceof SDK.RateLimitError) return "Trop de demandes ou crédit épuisé. Patientez une minute ou vérifiez votre compte Anthropic.";
  if (SDK.APIConnectionError && e instanceof SDK.APIConnectionError) return "Pas de connexion internet. L'assistant IA a besoin du réseau.";
  if (SDK.BadRequestError && e instanceof SDK.BadRequestError) return `Demande refusée par l'API : ${e.message}`;
  if (SDK.InternalServerError && e instanceof SDK.InternalServerError) return "Le service est momentanément indisponible. Réessayez dans un instant.";
  if (SDK.APIError && e instanceof SDK.APIError) return `Erreur du service (${e.status ?? "?"}) : ${e.message}`;
  return e?.message || "Erreur inconnue.";
}

let iaChargement = null;
function iaChargerSDK() {
  if (window.AnthropicSDK) return Promise.resolve(window.AnthropicSDK);
  iaChargement ||= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "vendor/anthropic-sdk.js";
    s.onload = () => (window.AnthropicSDK ? ok(window.AnthropicSDK) : ko(new Error("Module IA introuvable.")));
    s.onerror = () => { iaChargement = null; ko(new Error("Impossible de charger le module IA (vendor/anthropic-sdk.js).")); };
    document.head.append(s);
  });
  return iaChargement;
}

async function iaClient() {
  const { cle } = iaConfig();
  if (!cle) throw new Error("Ajoutez d'abord votre clé API dans Réglages → Assistant IA.");
  const SDK = await iaChargerSDK();
  // La clé appartient à l'utilisateur et reste sur son appareil : l'appel direct depuis le navigateur est voulu.
  return new SDK.default({ apiKey: cle, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Demande un classement SH pour une description de marchandise. */
async function iaClasser({ description, details = "" }) {
  const { modele } = iaConfig();
  const m = iaModele(modele);
  const client = await iaClient();
  const contenu = `Marchandise à classer :\n${description.trim()}${details.trim() ? `\n\nPrécisions :\n${details.trim()}` : ""}`;
  const params = {
    model: m.id,
    max_tokens: 16000,
    system: IA_SYSTEME,
    messages: [{ role: "user", content: contenu }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: IA_SCHEMA } },
  };
  // En cas de refus par un filtre de sécurité, l'API relance automatiquement sur le modèle de secours recommandé.
  if (m.fallbacks) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  try {
    const reponse = await client.beta.messages.create(params);
    return iaInterpreter(reponse, m.id);
  } catch (e) {
    throw new Error(iaMessageErreur(e));
  }
}

/** Vérifie la clé sans rien facturer (lecture de la fiche du modèle). */
async function iaVerifierCle() {
  const client = await iaClient();
  try {
    const info = await client.models.retrieve(iaModele(iaConfig().modele).id);
    return info.display_name || info.id;
  } catch (e) {
    throw new Error(iaMessageErreur(e));
  }
}
