# Logistique Fret

Application web **simple, gratuite et hors ligne** pour les entreprises de transport de marchandises au Maroc :
flotte, gasoil, chauffeurs, trajets, douane et nomenclature.

Pas de serveur, pas d'abonnement, pas d'installation obligatoire. Elle s'ouvre dans un navigateur et peut être
**installée sur le téléphone** comme une application, qui fonctionne ensuite **sans réseau** (route, port, zones blanches).

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| **Accueil** | Indicateurs (flotte, chauffeurs disponibles, dépenses 30 jours, coût gasoil/km, dossiers), liste « À traiter » avec accès direct, graphique des dépenses gasoil + entretien sur 8 semaines |
| **Camions** | Jauges d'usure vidange et pneus, papiers (assurance, visite technique), conso moyenne, coût d'entretien. Bouton « Entretien » : vidange, pneus, freins, réparation… avec coût et garage. Historique exportable |
| **Gasoil** | Saisie des pleins, consommation plein à plein, coût par camion et par km, alerte si la conso dépasse la moyenne (fuite, pneus, vol de gasoil) |
| **Chauffeurs** | Un responsable par camion, prise et fin de service, repos obligatoire après l'amplitude maximale, permis et visite médicale, appel en un clic |
| **Trajets** | Coût et durée **calculés pendant la saisie** (gasoil, péage, coût/km, pauses, repos de nuit, nombre de jours). Seuls les chauffeurs disponibles sont proposés, leur camion est choisi automatiquement, et le compteur est mis à jour à la fin du trajet |
| **Douane** | Dossiers import / export / transit, liste des documents (facture, colisage, CMR/B/L, EUR.1, DUM BADR, BAE…), progression, échéance, impression |
| **Codes SH** | Recherche dans les 97 chapitres du Système Harmonisé et dans vos codes habituels (10 chiffres, droit d'importation, notes). **Assistant IA** : propose le classement d'une marchandise (voir ci-dessous) |
| **Réglages** | Prix du gasoil, seuils d'alerte, temps de conduite et de repos, sauvegarde/restauration, installation sur mobile |

Ergonomie : fenêtres de saisie, notifications, mode sombre automatique, tableaux transformés en cartes sur mobile,
touche **N** pour ajouter un élément sur la page courante.

## Démarrer

- **Essai rapide** : ouvrir `index.html` (double-clic), puis « Voir avec des données d'exemple ».
- **Usage réel (recommandé)** : héberger le dossier gratuitement, par exemple avec GitHub Pages
  (Settings → Pages → branche → dossier racine). L'hébergement permet l'installation sur téléphone et le mode hors ligne.

Les données sont enregistrées **sur l'appareil**. L'application rappelle de faire une sauvegarde chaque semaine
(Réglages → Exporter), et le fichier peut être importé sur un autre appareil.

## Assistant IA de classement SH

Dans **Codes SH** (ou depuis un dossier douane via « Code SH avec l'IA »), décrivez la marchandise. L'assistant (Claude, d'Anthropic) renvoie :

- 1 à 3 classements, du plus probable au moins probable : code SH à 6 chiffres, code national seulement s'il est sûr, désignation, niveau de confiance ;
- le raisonnement (règles générales interprétatives, notes de section et de chapitre) et les points à vérifier ;
- les questions qui permettraient d'affiner, et les contrôles ou autorisations probables au Maroc.

Un clic ajoute le code à « Mes codes » ou l'applique au dossier douane d'origine.

**Mise en route** : Réglages → Assistant IA → collez une clé API créée sur [console.anthropic.com](https://console.anthropic.com) (paiement à l'usage), puis « Vérifier la clé ». Le modèle se choisit au même endroit : Opus 5.5 (le plus précis, par défaut), Sonnet 5.5 ou Haiku 5.5 (le moins cher). Le coût réel de chaque demande s'affiche sous la réponse.

**Sécurité** : la clé reste sur l'appareil, n'est jamais incluse dans les sauvegardes, et part uniquement vers `api.anthropic.com`. Utilisez une clé dédiée avec une limite de dépense mensuelle. Toute personne qui utilise cet appareil peut se servir de la clé.

Les propositions sont **indicatives** : vérifiez toujours le code sur le tarif officiel de l'ADII avant de déclarer. L'assistant ne fonctionne qu'avec une connexion internet ; le reste de l'application marche hors ligne.

Le SDK officiel `@anthropic-ai/sdk` (0.137.0) est regroupé dans `vendor/anthropic-sdk.js` (licence MIT, `vendor/LICENSE-anthropic-sdk`), sans CDN ni étape de compilation.

## Tests

```
npm test
```

Les tests vérifient les calculs métier : consommation, échéances, état des chauffeurs, découpage des trajets
en jours, pauses et repos, dépenses et alertes, et l'interprétation des réponses de l'assistant IA (refus, réponse coupée, modèle de secours, coût).

## Avertissements

- Les listes de documents douaniers et les règles de temps de conduite sont des **modèles de départ** : vérifiez-les avec la
  réglementation en vigueur (ADII — [douane.gov.ma](https://www.douane.gov.ma), ministère du Transport) et adaptez-les à votre activité.
- Les codes tarifaires complets (10 chiffres) et les taux changent avec la loi de finances : consultez le tarif officiel avant toute déclaration.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Système de design (clair/sombre, mobile) |
| `data.js` | Référentiels modifiables : chapitres SH, listes de documents douaniers |
| `noyau.js` | État et calculs métier, sans interface (testé) |
| `ia.js` | Assistant IA : configuration, consigne, schéma de réponse, appel à l'API |
| `vendor/anthropic-sdk.js` | SDK Anthropic officiel, regroupé en un seul fichier |
| `app.js` | Interface : vues, fenêtres, navigation |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Application installable et hors ligne |
| `tests/noyau.test.js` | Tests des calculs |
