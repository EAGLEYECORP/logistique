# Logistique Fret

Application web **simple et gratuite** pour aider les entreprises de transport de marchandises au quotidien (Maroc).
Elle n'a ni serveur, ni abonnement, ni installation : on ouvre `index.html` dans un navigateur, sur ordinateur ou sur téléphone.

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| **Tableau de bord** | Liste des urgences du jour : vidanges, pneus, assurance, visite technique, permis, chauffeurs à mettre en repos, dossiers en retard, consommation anormale |
| **Camions** | Suivi du kilométrage, des vidanges et de l'usure des pneus (alerte X km avant l'échéance), dates d'assurance et de visite technique. Boutons « Vidange faite » / « Pneus changés » |
| **Gasoil** | Saisie des pleins, calcul automatique de la consommation (L/100 km) plein à plein, coût par camion, alerte si la conso dépasse la moyenne de plus de 15 % (fuite, pneus, vol de gasoil), export CSV |
| **Chauffeurs** | Affectation d'un camion sous la responsabilité de chaque chauffeur (un seul responsable par camion), prise de service / repos, alerte au-delà de l'amplitude maximale, échéances du permis et de la visite médicale |
| **Itinéraires** | Estimation du gasoil, du péage, du coût au km, du temps de conduite, des pauses et des repos de nuit. Le système ne propose que les chauffeurs disponibles et choisit leur camion automatiquement. À la fin d'un trajet, il ajoute les km au compteur du camion |
| **Douane** | Dossiers import / export / transit avec la liste des documents à réunir (facture, colisage, CMR/B/L, EUR.1, DUM BADR, BAE…), progression, échéance, impression |
| **Nomenclature** | Recherche dans les 97 chapitres du Système Harmonisé et dans vos codes habituels (code à 10 chiffres, droit d'importation, notes) |
| **Paramètres** | Prix du gasoil, consommation, vitesse, règles de temps de conduite, sauvegarde/restauration JSON, données d'exemple |

## Utilisation

1. Ouvrir `index.html` (double-clic), ou héberger le dossier gratuitement (GitHub Pages, Netlify…).
2. Pour découvrir l'application, aller dans **Paramètres → Charger des données d'exemple**.
3. Ajouter ses camions, puis ses chauffeurs, puis saisir les pleins et les trajets.

Les données sont enregistrées **dans le navigateur de l'appareil**. Pensez à les exporter régulièrement (Paramètres → Exporter)
et à les importer sur un autre appareil si besoin.

## Avertissements

- Les listes de documents douaniers et les règles de temps de conduite sont des **modèles de départ** : vérifiez-les avec la
  réglementation en vigueur (ADII — [douane.gov.ma](https://www.douane.gov.ma), ministère du Transport) et adaptez-les à votre activité.
- Les codes tarifaires complets (10 chiffres) et les taux changent avec la loi de finances : consultez le tarif officiel avant toute déclaration.

## Fichiers

- `index.html` : structure de la page
- `style.css` : mise en forme (mode clair/sombre, adapté au mobile)
- `data.js` : données de référence (chapitres SH, listes de documents douaniers), faciles à modifier
- `app.js` : logique de l'application
