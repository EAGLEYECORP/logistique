# Changelog

## 2.0.0 — Application hors ligne complète

### Sécurité des données
- **Schéma versionné (v3)** et migration automatique des anciennes données ; copie de sécurité conservée avant la mise à niveau ; données plus récentes jamais rétrogradées.
- **IndexedDB** : copie miroir de l'état, **instantané quotidien (7 jours)** et instantané avant chaque import ; **récupération automatique** si le navigateur efface ou corrompt les données.
- **Sauvegarde** : ZIP (données + photos), JSON, ou **chiffrée AES-256-GCM** par mot de passe ; import des anciens formats ; export **CSV/Excel** de toutes les tables.
- **Pastille « dernière sauvegarde »** toujours visible, rappel hebdomadaire, protection du stockage contre l'effacement, jauge d'espace.

### Rappels
- Notifications pour **papiers qui expirent, repos des chauffeurs, factures en retard, commandes à traiter, sauvegarde**, avec catégories au choix.
- Déduplication (urgent : chaque jour ; à surveiller : tous les 3 jours), un clic ouvre la bonne page.
- **Application fermée** : synchronisation périodique via le service worker (Android/Chrome, application installée).

### Photos
- Pièces jointes sur **commandes (CMR, livraison, dommages), pleins (ticket), camions, entretiens, chauffeurs, dossiers de douane**.
- Compression à la prise (1600 px, JPEG) : une photo de 15 Mo tient en ~300 Ko ; 100 % hors ligne ; galerie, visionneuse plein écran, export/restauration dans le ZIP.

### Mode chauffeur
- Interface à un écran verrouillée sur un chauffeur : service, mission et étape suivante en un geste, photos, itinéraire, plein de gasoil.
- PIN salé (PBKDF2) + code de secours, blocage temporaire après 5 échecs.

### Démarrage, mobile et PWA
- **Assistant de démarrage** (entreprise, mentions légales, paramètres, données de départ : zéro / exemple / restauration).
- Icônes PNG (standard, adaptative, Apple), manifeste enrichi (raccourcis), écran de démarrage, **indicateur hors ligne**, bandeau d'installation (Android et iOS), mise à jour proposée à l'utilisateur.
- Bouton « + » flottant, menu « Plus », claviers adaptés, pas de clavier surgissant à l'ouverture d'une fenêtre sur mobile.
- Thème clair / sombre / automatique, champs plus lisibles en sombre.

### Gestion
- **« À traiter »** classé par urgence avec actions directes ; recherche globale et touche N conservées.
- **Impression** : factures avec **montant en lettres**, logo, RIB et mentions ; **ordre de transport** (nouveau) ; dossier de douane en une page.
- Réglages en onglets (Général, Données, Rappels, Appareil).

### Technique
- Logique métier étendue dans `noyau.js` (migrations, rappels, étapes de commande, missions, montants en lettres) ; **43 tests** (ZIP validé par un outil standard, chiffrement, migrations…).
- Service worker : cache d'abord, version = commit, mise à jour contrôlée.
- Workflow GitHub Pages : tests puis publication.

### Corrigé
- Rechargement parasite à la toute première visite (nouveau service worker).
- Échap dans la recherche globale vidait le champ au lieu de fermer la fenêtre.

## 1.x
- Flotte, gasoil, chauffeurs, trajets, douane, codes SH, assistant IA, commandes, clients, factures.
