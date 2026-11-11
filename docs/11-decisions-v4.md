# Décisions pour la version 4 — « système nerveux » de l'exploitant et du chef d'entreprise

Document de décision (11/11/2026). Il tranche les points laissés ouverts par le cahier des charges v4 (13 livrables) à partir de l'audit « valeur actuelle / valeur non réalisée » et des contraintes du projet : **gratuit, hors ligne d'abord, sans dépendance, données du transporteur chez lui**.

## Ce que dit l'audit

- **Valeur actuelle** : l'application enregistre très bien ce qui s'est passé sur le corridor Maroc ⇄ Europe (voyages, traversée, autorisations, Schengen, péages, tachygraphe, suivi, lien client).
- **Valeur non réalisée** : (1) la **vérité de l'argent** — chaque dirham rattaché à un voyage, un client, un camion, au moment où il est dépensé ; (2) **dire quoi faire ensuite** — prévisions, anomalies, seuils ; (3) **une seule image partagée** entre les postes et les deux bureaux, avec de vrais droits d'accès.

L'ordre de construction suit cette valeur, pas l'ordre des numéros.

## Décisions

| # | Question | Décision | Pourquoi |
|---|---|---|---|
| 1 | Dépendances du relais (SQLite, Argon2id) | **Aucune dépendance.** Stockage en fichiers JSON à écriture atomique ; mots de passe avec **scrypt** (bibliothèque standard de Node) ; jetons de session aléatoires gardés côté serveur (révocables) plutôt que JWT. | Le relais doit tourner sur un vieux PC, un Raspberry ou Termux sans compilation. À l'échelle d'une flotte (dizaines de camions, milliers d'enregistrements), des fichiers suffisent. scrypt est un algorithme reconnu, disponible sans rien installer. |
| 2 | « Le relais ne voit que des blocs chiffrés » contre comptes et droits réels | **Deux modes.** Par défaut, rien ne change (blocs chiffrés). Le mode multi-utilisateur est un **choix explicite** : le serveur lit alors les données pour appliquer les droits, avec chiffrement des fichiers au repos. | Des droits appliqués par le serveur exigent qu'il lise les données : on ne peut pas avoir les deux. Le transporteur choisit, en connaissance de cause. |
| 3 | Zéro dollar et deux bureaux | Le mode gratuit reste complet (PC du bureau + tunnel gratuit). Le mode multi-utilisateur fonctionne de la même façon ; un petit serveur loué n'est qu'une option de confort. | Ne jamais imposer un coût. |
| 4 | Import des cartes carburant | **À construire** (il n'existe pas : seul le relevé de télépéage existe). CSV avec colonnes reconnues ou désignées, rattachement automatique au voyage. | Le carburant est la première ligne de coût ; sans lui, la marge « en direct » est fausse. |
| 5 | Versions du schéma (7, 7.1, 7.2) | Entiers : **7** (coûts), **8** (notifications), **9** (comptes). | Le schéma est un entier depuis l'origine. |
| 6 | Lignes de coût et anciens champs | Les anciens champs restent lisibles et sont **projetés** en lignes. Dès qu'une ligne réelle existe pour un type, elle **remplace** l'estimation de ce type (jamais de double compte). | Aucune perte, aucune ressaisie. |
| 7 | Détection du pays de connexion | Remplacée par une alerte **« nouvel appareil ou nouvelle adresse »**. | Une base de géolocalisation d'adresses est une dépendance et un coût. |
| 8 | Pièces PDF envoyées par le relais | Le relais envoie un **lien** vers le dossier (ou sa version HTML), pas un PDF. | Fabriquer un PDF côté serveur demande un navigateur ou une bibliothèque. |
| 9 | Recherche dans le texte des photos (OCR) | **Hors périmètre.** | Elle exigerait une clé payante. |
| 10 | Amendes du tachygraphe | Ligne « amende » saisie sur le voyage ; rattachement automatique au voyage en cours à la date donnée. Pas de montant inventé. | Les fichiers de carte ne contiennent pas de montant d'amende. |

## Ordre de construction

1. **Vérité de l'argent** — carte visible avant toute connexion GPS (demande en attente) ; D1 lignes de coût ; D2 marge du voyage en direct ; D3 capture automatique.
2. **Chef d'entreprise** — D4 compte de résultat, D5 trésorerie à 90 jours, D6 simulateur d'investissement, D7 anomalies.
3. **Exploitant** — D8 conseils, D10 deux accueils et historique, D12 attentes aux ports mesurées par GPS, tableau des opérations.
4. **Deux bureaux** — D9 durcissement et chiffrement au repos, D11 notifications par étape, D13 comptes et droits réels.

D13 vient en dernier : c'est le changement le plus risqué, il dépend de D9, et il n'a de valeur que si ce qu'on partage (argent et opérations en direct) existe déjà.

## Ce qui dépend du terrain

Les étapes réelles aux ports (ordre, lieux d'attente, durées) et à la livraison seront calées sur les retours des transporteurs : elles déterminent les zones GPS à créer pour mesurer chaque attente (D12).
