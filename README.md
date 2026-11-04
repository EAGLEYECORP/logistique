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
| **Codes SH** | Recherche dans les 97 chapitres du Système Harmonisé et dans vos codes habituels (10 chiffres, droit d'importation, notes) |
| **Réglages** | Prix du gasoil, seuils d'alerte, temps de conduite et de repos, sauvegarde/restauration, installation sur mobile |

Ergonomie : fenêtres de saisie, notifications, mode sombre automatique, tableaux transformés en cartes sur mobile,
touche **N** pour ajouter un élément sur la page courante.

## Démarrer

- **Essai rapide** : ouvrir `index.html` (double-clic), puis « Voir avec des données d'exemple ».
- **Usage réel (recommandé)** : héberger le dossier gratuitement, par exemple avec GitHub Pages
  (Settings → Pages → branche → dossier racine). L'hébergement permet l'installation sur téléphone et le mode hors ligne.

Les données sont enregistrées **sur l'appareil**. L'application rappelle de faire une sauvegarde chaque semaine
(Réglages → Exporter), et le fichier peut être importé sur un autre appareil.

## Tests

```
npm test
```

Les tests vérifient les calculs métier : consommation, échéances, état des chauffeurs, découpage des trajets
en jours, pauses et repos, dépenses et alertes.

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
| `app.js` | Interface : vues, fenêtres, navigation |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Application installable et hors ligne |
| `tests/noyau.test.js` | Tests des calculs |
