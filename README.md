# Logistique Fret

Application **gratuite, hors ligne et sans serveur** pour les entreprises de transport routier de marchandises (national et international, Maroc) :
commandes, clients, facturation, flotte, chauffeurs, trajets, douane, codes SH.

- 🆓 **Gratuite** : aucun abonnement, aucun compte, aucun serveur obligatoire.
- 📴 **100 % hors ligne** : sur la route, au port, en zone blanche. Seul l'assistant IA (facultatif) a besoin d'internet.
- 🔒 **Vos données restent sur l'appareil**, avec sauvegarde ZIP (photos comprises), chiffrement par mot de passe et copies automatiques.
- 📱 **Installable** sur téléphone, tablette et ordinateur comme une vraie application.

## Fonctionnalités

| Module | Ce qu'il fait |
|---|---|
| **Accueil** | CA et marge 30 jours, encours clients, commandes en cours, chauffeurs disponibles, dépenses. **« À traiter »** classé par urgence (papiers, repos, factures en retard, commandes sans équipe), « Aujourd'hui et demain », graphique des dépenses |
| **Commandes** | Ordres de transport MAD/€, étapes Devis → Confirmée → Chargée → En transit → En douane → Livrée horodatées, marge par commande, facturation en un clic, **ordre de transport imprimable** (signatures expéditeur, transporteur, destinataire), **photos** (CMR, livraison, dommages) |
| **Clients / Factures** | ICE, délais de paiement, encours ; facture numérotée avec TVA, **montant en lettres**, logo, RIB et mentions, encaissement, relance e-mail préremplie, impression/PDF |
| **Camions** | Jauges d'usure vidange et pneus, papiers (assurance, visite, carte verte, tachygraphe, autorisation internationale), historique d'entretien avec coûts et photos |
| **Gasoil** | Pleins, consommation plein à plein, détection d'anomalie (fuite, vol), **photo du ticket** |
| **Chauffeurs** | Un responsable par camion, service/repos, permis, visa, passeport, carte conducteur |
| **Voyages** | Maroc ⇄ Europe : aller, **traversée Tanger Med ⇄ Algeciras (aller et retour)**, étapes, contrôles avant départ (visa, passeport, papiers, autorisation, Schengen, poids), coût complet, marge, retour à vide, listes de contrôle |
| **Autorisations & visas** | Autorisations bilatérales « E » / « MA », comptes-rendus de voyage, **compteur Schengen 90/180** par chauffeur |
| **Suivi en direct** | **Carte interactive de la flotte** (Leaflet + OpenStreetMap, gratuite), **camion cliquable avec fiche complète** (position, voyage, chauffeur, camion, température), état de chaque camion (traversée, port, signal perdu…), conduite sans pause, alertes, étapes automatiques, heure d'arrivée estimée ; nécessite le relais ou Traccar (`serveur/`) |
| **Synchronisation** | Mêmes données sur le bureau et les téléphones des chauffeurs par votre relais : chiffrée sur l'appareil, fusion par enregistrement, copies de sécurité (Réglages → Données) |
| **Tachygraphe** | Import de la **carte conducteur (.ddd)** ou d'un CSV d'activités, dépassements des temps de conduite et de repos (CE 561/2006, version simplifiée), alertes |
| **Chaîne du froid** | Température des balises, consigne par voyage, excursions, alerte et rapport (fiche voyage) |
| **CMR** | Lettre de voiture CMR (24 rubriques, français / anglais) préremplie et imprimable ; relevés de télépéage européen importés |
| **Preuve de livraison** | Signature du destinataire, réserves, position et heure, imprimable (ce n'est pas un e-CMR) |
| **Lien client** | Page publique de suivi (état, ETA, position approximative, étapes) en 4 langues, révocable, fonctionne application fermée ; nécessite le relais |
| **Traces GPS** | Import CSV/GPX de vos balises, tracé hors ligne, traversées et étapes détectées, conduite estimée, zones modifiables |
| **Péages Maroc** | Grille officielle Autoroutes du Maroc (584 sections), classe déduite du camion, trajets types ; **gares localisées** (relevées sur vos traces ou importées d'OpenStreetMap), **péage mesuré par GPS** et **rapprochement avec le relevé Jawaz Pro** |
| **Trajets** | Coût, durée, pauses et repos calculés pendant la saisie |
| **Douane** | Dossiers import/export/transit, documents à réunir, scans photo, impression |
| **Codes SH** | Recherche des 97 chapitres, vos codes habituels, **assistant IA** de classement (facultatif) |
| **Mode chauffeur** | Écran unique verrouillé par PIN : mission, étapes, service, photos, plein |
| **Rappels** | Notifications pour papiers, repos, factures, commandes ; même application fermée sur Android (Chrome, installée) |
| **Données** | Sauvegarde ZIP/JSON/chiffrée, export Excel (CSV), copies automatiques quotidiennes, récupération en cas de perte |

Ergonomie : recherche globale **⌘K / Ctrl+K**, touche **N** (nouvel élément), liens directs (`#commandes`, `#factures`…), mode clair/sombre, bouton « + » flottant et menu « Plus » sur mobile, assistant de démarrage.

## Lancer l'application

Aucune installation de dépendances : ce sont des fichiers statiques.

```bash
git clone https://github.com/EAGLEYECORP/logistique && cd logistique
python3 -m http.server 8080          # ou : npx serve -l 8080
```

Ouvrez **http://localhost:8080**. (Un double-clic sur `index.html` fonctionne aussi, mais sans installation ni mode hors ligne.)

> ⚠️ **Gardez toujours la même adresse** (ici `localhost:8080`) : le navigateur range les données par adresse. Une autre adresse ou un autre port affichera une application vide.

## Installer comme application (PWA)

| Appareil | Comment |
|---|---|
| **Android (Chrome)** | Un bandeau propose l'installation à la 2ᵉ visite, ou menu ⋮ → « Installer l'application ». Les rappels fonctionnent alors application fermée |
| **iPhone / iPad (Safari)** | Partager → « Sur l'écran d'accueil » (iOS 16.4 ou plus pour les notifications) |
| **Ordinateur (Chrome, Edge)** | Icône d'installation dans la barre d'adresse |

Après installation, l'application démarre instantanément, sans réseau. Une nouvelle version est proposée par un bandeau « Mettre à jour ».

## Utiliser sur Android avec Termux (sans ordinateur, sans hébergement)

Idéal pour tester ou pour une petite structure : le téléphone sert lui-même de « serveur » le temps de l'installation.

1. Installez **Termux** (depuis F-Droid) et **Chrome**.
2. Dans Termux :
   ```bash
   pkg update && pkg install -y python git
   git clone https://github.com/EAGLEYECORP/logistique
   cd logistique
   python -m http.server 8080 --bind 127.0.0.1
   ```
3. Dans Chrome, ouvrez `http://localhost:8080` puis **Installer l'application** (menu ⋮).
4. C'est terminé : l'application installée fonctionne sans Termux. Relancez le serveur seulement pour récupérer une mise à jour (`git pull`, puis le même port **8080**).

`localhost` est considéré comme une adresse sécurisée : installation, hors ligne et notifications fonctionnent. Pour transférer des données d'un appareil à l'autre, utilisez Réglages → Données → Exporter, puis Importer.

## Hébergement gratuit (GitHub Pages)

Le dépôt contient `.github/workflows/pages.yml` : à chaque envoi, il lance les tests puis publie le site.
Réglage unique : **Settings → Pages → Source : GitHub Actions** (le dépôt doit être public, ou votre compte GitHub Pro).
Adresse : `https://<compte>.github.io/logistique/`. La version du cache hors ligne suit l'identifiant du commit : chaque publication déclenche la mise à jour chez les utilisateurs.

## Sauvegardes et sécurité des données

- **Où sont mes données ?** Dans le navigateur de l'appareil : petit état en `localStorage`, photos et copies en `IndexedDB`. Rien n'est envoyé nulle part.
- **Exporter** (Réglages → Données, ou la pastille « Sauvegardé il y a N j ») :
  - **ZIP complet** : `donnees.json` + `photos/` (ouvrable avec n'importe quel outil ZIP) ;
  - **JSON** : données seules ;
  - **Chiffré** (`.lfs`) : AES-256-GCM, clé dérivée de votre mot de passe (PBKDF2, 200 000 itérations). **Sans le mot de passe, le fichier est irrécupérable.** Format propre à l'application : seul « Importer » sait le rouvrir.
- **Copies automatiques** : une copie par jour (7 jours) et une avant chaque import/restauration, restaurables depuis Réglages → Données.
- **Récupération** : si le navigateur efface ou corrompt les données, l'application retrouve une copie interne (miroir IndexedDB) et propose de la restaurer.
- **Excel** : « Exporter tout en CSV » fournit un ZIP d'un CSV par table (séparateur `;`, virgule décimale, UTF-8).
- La clé de l'assistant IA et le code PIN du mode chauffeur ne sont **jamais** inclus dans une sauvegarde.

## Rappels (notifications)

Réglages → Rappels → « Activer les rappels ». Tout est calculé sur l'appareil.
Un point urgent est rappelé chaque jour, un point « à surveiller » tous les 3 jours ; un toucher ouvre la page concernée.

| Situation | Rappels |
|---|---|
| Application ouverte (tous navigateurs) | ✅ à l'ouverture, chaque minute, au retour sur l'onglet |
| Android + Chrome + application installée | ✅ aussi application fermée (synchronisation périodique, quelques fois par jour, à la discrétion du système) |
| iPhone | ✅ application installée sur l'écran d'accueil, iOS 16.4+ (pas d'arrière-plan) |

## Mode chauffeur

Pour un téléphone ou une tablette laissé dans le camion : Réglages → Appareil → Mode chauffeur → choisir le chauffeur, définir un PIN.
L'appareil n'affiche plus que la mission du chauffeur (service, étapes, photos, itinéraire, plein) ; clients, factures, marges et réglages sont masqués. La sortie demande le PIN ; un **code de secours** est remis une seule fois au gestionnaire.

> **Limites à connaître** — le PIN verrouille l'interface, il ne chiffre pas les données (utilisez l'export chiffré pour cela). Les données sont propres à chaque appareil : pour que le chauffeur voie ses missions, activez la synchronisation par le relais (ou importez une sauvegarde à jour). La **synchronisation par le relais** (Réglages → Données) évite cet import manuel.

## Migration depuis l'ancienne version

Automatique et sans action de votre part.

1. Au premier lancement, vos données sont **mises à niveau** (schéma v1/v2 → v3). **Une copie d'avant la mise à niveau est conservée** (Réglages → Données → Copies automatiques, « Avant import »).
2. La clé de stockage `logistique-v1` est inchangée : vos données sont retrouvées telles quelles. L'assistant de démarrage ne s'affiche pas si vous avez déjà des données.
3. Vos anciens fichiers d'export `.json` s'importent toujours (Réglages → Données → Importer).
4. Des données plus récentes que l'application ne sont jamais « rétrogradées » : l'application avertit au lieu de les modifier.

## Architecture

**Pourquoi du JavaScript pur, sans compilation ?** L'application doit s'ouvrir partout (poste de bureau, téléphone, Termux), se servir avec un simple `python -m http.server` et rester modifiable par n'importe qui sans chaîne d'outils. Un framework et un bundler ajouteraient Node, des dépendances et une étape de build sans bénéfice ici. La logique est séparée de l'interface et testée.

| Fichier | Rôle |
|---|---|
| `noyau.js` | **Logique métier pure** : état, migrations, calculs, alertes, rappels, étapes de commande, montants en lettres (testée) |
| `stockage.js` | IndexedDB : miroir, copies quotidiennes, photos, compression d'image |
| `sauvegarde.js` | ZIP, chiffrement AES-GCM, import/export, CSV, verrou PIN (testé) |
| `app.js` | Interface : vues, fenêtres, navigation, recherche globale |
| `commercial.js` | Commandes, clients, factures |
| `voyages.js` | Voyages internationaux, traversées, autorisations, Schengen, péages |
| `gps.js` | Lecture CSV/GPX, nettoyage, analyse, zones, jalons, passages aux gares, péage mesuré, rapprochement Jawaz (testé) |
| `synchro.js` | Synchronisation entre appareils (relais, chiffrement, fusion à trois voies) |
| `conformite.js` | WhatsApp / SMS, analyse du tachygraphe, chaîne du froid, balise du téléphone (testé) |
| `terrain.js` | Balise de secours du téléphone et preuve de livraison |
| `tachy.js` | Page Tachygraphe et tarifs des péages d'Europe |
| `partages.js` | Lien de suivi client : création, partage WhatsApp / e-mail, révocation, synchronisation |
| `direct.js` | Suivi en direct : sources (relais, Traccar, démo), carte, états, alertes |
| `serveur/relais.js` | Relais de positions (Node, sans dépendance) : réception et lecture |
| `gares.js` | Gares de péage : relevé sur trace, import OpenStreetMap, relevés Jawaz Pro |
| `traces.js` | Page Traces GPS : import, zones, application au voyage |
| `adm.js` | Grille tarifaire officielle des Autoroutes du Maroc |
| `langue.js` | Interface en arabe (RTL), partielle |
| `photos.js` | Galerie et visionneuse de photos |
| `impression.js` | Factures, ordres de transport, dossiers de douane (A4/PDF) |
| `reglages.js` | Réglages en onglets, sauvegarde et restauration |
| `notifications.js` | Rappels : autorisation, vérification, carte de réglage |
| `chauffeur.js` | Mode chauffeur |
| `onboarding.js` | Assistant de démarrage, bandeau d'installation |
| `boot.js` | Démarrage, récupération, thème, hors ligne, mises à jour |
| `ia.js`, `vendor/anthropic-sdk.js` | Assistant IA de classement SH (facultatif, clé API de l'utilisateur) |
| `data.js` | Référentiels modifiables (chapitres SH, listes de documents douaniers) |
| `vendor/leaflet/` | Bibliothèque de carte Leaflet 1.9.4 (BSD-2-Clause), embarquée |
| `sw.js`, `manifest.webmanifest`, `icon*.png/svg` | Application installable, hors ligne, rappels en arrière-plan |
| `tests/noyau.test.js`, `tests/relais.test.js` | 108 tests |

```bash
npm test      # logique métier, ZIP, chiffrement, migrations, rappels, verrou, montants en lettres
```

## Assistant IA de classement SH (facultatif)

Réglages → Général → Assistant IA : collez une clé API créée sur [console.anthropic.com](https://console.anthropic.com) (paiement à l'usage, le coût de chaque demande s'affiche). Décrivez une marchandise (Codes SH ou depuis un dossier douane) : l'assistant propose le code SH, son raisonnement, les points à vérifier et les contrôles probables au Maroc. La clé reste sur l'appareil. **Vérifiez toujours le code sur le tarif officiel de l'ADII.**

## Transport international (Maroc ⇄ Europe)

Étude complète dans [`docs/`](docs/README.md) (audit du voyage, cahier des charges, annexes). Ce que l'application fait aujourd'hui, **sans serveur et hors ligne** : voyages avec traversée du détroit, autorisations, Schengen, péages ADM, coûts et retour à vide. L'**import de traces GPS** exportées de vos balises fonctionne aussi hors ligne ; le **suivi en direct** des camions demande un petit serveur : voir `serveur/README.md`.

## Mise en service

Le suivi en direct, les alertes, le lien client et la synchronisation demandent un petit serveur (relais) ; la liste de ce qui dépend de vous (comptes, fichiers réels, déclarations) et les tests en un clic sont dans [`docs/04-mise-en-service.md`](docs/04-mise-en-service.md).

## Avertissements

- **Péages ADM** : grille relevée le 10/11/2026 sans date d'effet publiée ; recontrôlez sur adm.co.ma. **Tarifs de traversée** : le fret du détroit est sur devis, saisissez celui de votre armateur. **Interdictions de circuler** et **autorisations** : valeurs indicatives à vérifier auprès des autorités.

- Listes de documents douaniers, règles de temps de conduite et TVA par défaut sont des **valeurs de départ** : vérifiez-les avec la réglementation en vigueur (ADII, ministère du Transport, votre comptable).
- Les codes tarifaires à 10 chiffres et les droits changent avec la loi de finances : consultez le tarif officiel avant toute déclaration.
- Les notifications en arrière-plan dépendent du navigateur et du système ; ne vous y fiez pas pour une échéance critique sans la vérifier dans l'application.
