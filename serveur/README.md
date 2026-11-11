# Relais de positions — suivi en direct

Le suivi en direct a besoin d'un **petit serveur** : l'application hors ligne ne peut pas recevoir, à elle seule, les positions de vos camions. Ce dossier contient un relais **sans dépendance** (Node 18 ou plus). L'application continue de fonctionner sans lui ; seul l'écran « Suivi en direct » en dépend.

```
balises GPS ──► (Traccar, facultatif) ──► relais ◄── application (lecture)
```

## Rester à zéro dollar

Rien dans ce projet n'exige de payer. Voici ce qui est gratuit, et ce qu'il faut éviter pour le rester.

| Besoin | Solution gratuite | À savoir |
|---|---|---|
| Application | GitHub Pages (déjà en place) | dépôt public |
| Carte | **Leaflet** (embarqué) + **OpenStreetMap** | Aucune clé. Le serveur public d'OpenStreetMap est réservé à un **usage léger** (quelques personnes qui regardent la carte, pas de téléchargement en masse) ; l'application garde les tuiles vues 7 jours sur l'appareil. Si l'usage grossit : un fournisseur à offre gratuite avec clé (son modèle d'adresse se colle dans les réglages) ou votre propre serveur de tuiles. |
| Relais (suivi, lien client, alertes, synchronisation) | Un **PC du bureau**, un mini-PC ou un **vieux téléphone Android** (Termux) allumé en permanence | Node 18+, aucune dépendance. |
| https devant le relais | Un **tunnel gratuit** (par exemple Cloudflare Tunnel ou Tailscale Funnel) | Vérifiez vous-même les conditions de l'offre gratuite ; certains tunnels « rapides » changent d'adresse à chaque redémarrage. |
| Balises GPS | **Traccar** (open source) pour décoder les protocoles, renvoi vers le relais | sur la même machine que le relais |
| Alertes | **Telegram** ou **ntfy** | WhatsApp passe par l'API de Meta, payante selon l'usage : à éviter pour rester à zéro. |
| Géorepérage, états, ETA, péages | Calculés par l'application et le relais | aucune API de cartographie payante |

**À ne pas activer si vous voulez rester à zéro** : l'assistant IA de classement SH (clé Anthropic payante à l'usage, facultatif et désactivé par défaut), WhatsApp Cloud API, un hébergeur payant. Google Maps, Mapbox et les API de géocodage ne sont utilisés nulle part.

## Deux façons de faire

| | Quand | Ce qu'il faut |
|---|---|---|
| **A. Relais de ce dossier** | vous recevez déjà les positions (API de votre fournisseur, Traccar, téléphone) ou pouvez les renvoyer par HTTP | un petit serveur ou un PC allumé, **https** |
| **B. Traccar existant** | vous avez déjà un serveur [Traccar](https://www.traccar.org) | l'application lit directement son API (aucun relais) |

Les balises de camion parlent souvent des protocoles propriétaires (Teltonika, Queclink, Concox…) : **Traccar** les comprend presque toutes et peut renvoyer chaque position vers le relais (A) ou être lu directement (B). Si votre plateforme actuelle fournit une API ou un renvoi de positions (« webhook »), le relais suffit.

## Démarrer le relais

```bash
node serveur/relais.js
```

Au premier démarrage, deux **jetons** sont générés et enregistrés dans `serveur/donnees/jetons.json`, puis affichés :

- **jeton d'écriture** : à donner aux balises / à Traccar (il ne sert qu'à envoyer) ;
- **jeton de lecture** : à saisir dans l'application (Suivi en direct → Réglages de la source).

Variables facultatives : `PORT` (8787), `JETON_ECRITURE`, `JETON_LECTURE`, `DONNEES` (dossier), `RETENTION_JOURS` (30), `ORIGINE` (origine autorisée par CORS, `*` par défaut), `HOTE`.

### Essayer tout de suite

```bash
node serveur/relais.js &
node serveur/simulateur.js http://localhost:8787 <jeton-ecriture> DEMO-1
```

Dans l'application : Suivi en direct → source « Relais », adresse `http://localhost:8787`, jeton de lecture. (Une page **https** n'a le droit d'appeler qu'un serveur **https** ; `localhost` fait exception.)

## Recevoir les positions

| Entrée | Appel | Notes |
|---|---|---|
| JSON | `POST /api/positions` avec `Authorization: Bearer <jeton d'écriture>` | un objet, un tableau, ou `{ "positions": [...] }` |
| OsmAnd / Traccar Client | `GET /osmand?token=<jeton>&id=...&lat=...&lon=...&timestamp=...&speed=...` | `&unite=kmh` (défaut), `noeuds` ou `ms` pour la vitesse |
| Renvoi Traccar | `POST /traccar?token=<jeton>` | corps JSON `{ position, device }`, vitesse en nœuds |

Température (chaîne du froid) : `temp`, `temperature` ou `temp1` en °C (Traccar : attribut `temp1`). Champs JSON reconnus : `id` (ou `deviceId`, `imei`), `lat`/`lon` (ou `latitude`/`longitude`, `lng`), `t` (ou `timestamp`, `time`, `fixTime` : secondes, millisecondes ou date ISO), `v` (ou `speed`, `vitesse`, km/h), `cap`. Les positions dans le futur (> 10 min), de plus de 7 jours, hors plage ou en double sont ignorées.

### Brancher Traccar sur le relais

Dans le fichier de configuration de Traccar (`traccar.xml`), le renvoi de positions s'active avec des clés de la forme (**à vérifier dans la documentation de votre version**) :

```xml
<entry key='forward.enable'>true</entry>
<entry key='forward.url'>https://suivi.mon-entreprise.ma/traccar?token=JETON_ECRITURE</entry>
<entry key='forward.json'>true</entry>
```

### Brancher l'application directement sur Traccar (option B)

Dans Traccar, créez un **jeton d'API** (profil utilisateur) et autorisez l'origine de l'application (`web.origin`). Dans l'application : source « Serveur Traccar », adresse de Traccar, ce jeton. L'identifiant de la balise (`uniqueId`, souvent l'IMEI) est ensuite saisi sur la fiche du camion. *Cette option n'a pas pu être essayée contre un vrai Traccar : si un champ diffère dans votre version, dites-le.*

## Lire (application)

`GET /api/derniere` (dernière position de chaque balise), `GET /api/trace?id=…&depuis=<secondes>&max=…`, `GET /api/etat`, `GET /sante`. Jeton de lecture requis, sauf `/sante`.

## Synchronisation entre appareils

Réglages → Données → « Synchronisation entre appareils » : adresse du relais, jeton de lecture et un **mot de passe de synchronisation** identique sur tous les appareils. L'application chiffre l'état (AES-256-GCM, dérivé du mot de passe) avant l'envoi : le relais ne garde qu'un bloc illisible et un numéro de version (`GET /api/sync`, `PUT /api/sync` avec la version de base ; 409 si elle est périmée). Mot de passe perdu = données du serveur irrécupérables. Taille maximale de l'état : 40 Mo.

**Photos** : chaque photo est un fichier chiffré (`donnees/photos/<identifiant>.bin`), envoyé ou reçu par lots de 20 (`GET /api/sync/photos` pour la liste, `PUT` / `GET` / `DELETE /api/sync/photos/<id>`). 6 Mo au plus par photo ; quota total réglable par `PHOTOS_MAX_MO` (2048 Mo par défaut, réponse 507 quand il est atteint). Une suppression laisse une trace 90 jours pour que les autres appareils suppriment aussi. Un appareil vidé ne supprime rien sur le serveur : il récupère tout. Comptez environ 300 Ko par photo de téléphone.

## Téléphone du chauffeur comme balise de secours

Mode chauffeur → « Partager ma position » : le téléphone envoie sa position à `POST /api/positions` avec le **jeton d'écriture** (saisi une fois par le gestionnaire dans les réglages de la carte). Liez l'identifiant envoyé (par défaut `TEL-<chauffeur>`) au camion dans sa fiche (champ « balise »). Le navigateur ne localise plus quand l'écran s'éteint : gardez-le allumé (l'application le demande).

## Alertes automatiques (ntfy, Telegram, WhatsApp, webhook)

Le relais transmet chaque alerte de l'application (`POST /api/alertes`, jeton de lecture) aux canaux configurés **sur le serveur** par variables d'environnement. Les secrets ne passent jamais par l'application.

| Canal | Variables |
|---|---|
| ntfy | `NTFY_URL` (https://ntfy.sh/<sujet-secret>) |
| Telegram | `TELEGRAM_TOKEN`, `TELEGRAM_CHAT` (identifiant de la conversation ou du groupe), `TELEGRAM_API` (facultatif) |
| WhatsApp (Cloud API de Meta) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_DEST` (numéros internationaux séparés par des virgules, sans « + »), `WHATSAPP_MODELE` et `WHATSAPP_LANGUE` (facultatifs), `WHATSAPP_API` (facultatif) |
| Webhook | `WEBHOOK_URL` (reçoit `{ texte, niveau, cle, t }` en JSON) |

**WhatsApp** : il faut un compte WhatsApp Business, un numéro et un jeton Meta (à créer chez Meta, conditions et tarifs à vérifier de votre côté). Un message libre n'est livré que si le destinataire vous a écrit dans les 24 dernières heures ; sinon, créez et faites approuver un **modèle** de message à un seul paramètre texte et indiquez son nom dans `WHATSAPP_MODELE`. *Cette intégration suit la documentation de l'API, sans compte Meta pour l'essayer : testez-la avec un seul destinataire d'abord.* Telegram est gratuit et plus simple pour démarrer.

Une même alerte (même clé) n'est transmise qu'une fois par 6 heures ; 60 alertes par heure au plus ; un canal en échec n'empêche pas les autres.

## Alertes sur le téléphone du bureau

Suivi en direct → Réglages de la source → « Alertes sur le téléphone du bureau » : adresse d'un sujet [ntfy](https://ntfy.sh) (`https://ntfy.sh/<sujet-long-et-secret>`). Installez l'application ntfy sur le téléphone du bureau et abonnez-vous au sujet. Chaque nouvelle alerte du suivi (signal perdu, conduite continue, température, retard…) y est envoyée. Le sujet fait office de mot de passe : choisissez un nom long et imprévisible, ou hébergez votre propre serveur ntfy.

## Lien de suivi pour vos clients

Dans l'application : **Voyages → Partager le suivi**. Le relais crée une adresse secrète `https://…/suivi/<identifiant>` qui affiche, **sans compte ni installation** (téléphone ou ordinateur, en français, anglais, espagnol ou arabe) :

- l'état du camion (en route, pause, au port, traversée du détroit…) ;
- l'**heure d'arrivée estimée**, avec une fourchette, et le retard probable par rapport au créneau promis ;
- une **position approximative** (≈ 10 km), exacte ou masquée, au choix ;
- les étapes (parti, embarqué, arrivé en Europe, livré) et votre message.

Le client ne voit **ni le chauffeur, ni la plaque, ni l'identifiant de la balise**. La page fonctionne **application fermée** : le relais calcule l'état et l'ETA lui-même (il charge `data.js`, `noyau.js`, `adm.js` et `gps.js` de la racine du dépôt, pour donner exactement le même résultat que l'application). L'application envoie au relais les étapes, le créneau et le statut « livré » à chaque changement.

| Appel (jeton de lecture) | Effet |
|---|---|
| `POST /api/partages` | crée un lien (`balise`, `reference`, `origine`, `destination`, `destLat`, `destLon`, `origLat`, `origLon`, `livraisonPrevue`, `precision` : `approx` / `exacte` / `masquee`, `langue`, `jours`, `message`, `etapes`, `zones`) |
| `PUT /api/partages/<id>` | met à jour (étapes, `statut: "livre"`, créneau…) |
| `DELETE /api/partages/<id>` | **révoque** le lien |
| `GET /api/partages` | liste |
| `GET /suivi/<id>` · `/suivi/<id>/donnees` | page et données publiques (410 si expiré, 404 si révoqué) |

Le jeton d'**écriture** (balises, Traccar) ne peut pas créer de lien. Un lien expire après 14 jours par défaut (1 à 120). **Toute personne qui possède l'adresse voit le suivi** : ne la transmettez qu'aux destinataires concernés, et révoquez-la après la livraison. La page n'est pas indexée par les moteurs de recherche et n'envoie pas de référent.

## Mise en ligne (https)

- **PC, Raspberry Pi ou serveur** : placez un proxy https devant le relais, par exemple [Caddy](https://caddyserver.com) : `suivi.mon-entreprise.ma { reverse_proxy localhost:8787 }` (certificat automatique).
- **Sans ouvrir de port** : un tunnel (par exemple Cloudflare Tunnel) expose le relais en https depuis une machine du bureau.
- **Conteneur** (à construire depuis la racine du dépôt) : `docker build -f serveur/Dockerfile -t relais . && docker run -d -p 8787:8787 -v relais-donnees:/donnees relais`.
- **Téléphone Android (Termux)** : `pkg install nodejs`, puis `node serveur/relais.js` ; adresse `http://localhost:8787` depuis le même téléphone.

Choisissez et vérifiez vous-même l'hébergement, ses conditions et son coût : aucun n'est imposé.

## Sécurité et vie privée

- Deux jetons distincts ; comparaison à temps constant ; taille des envois limitée ; débit limité par adresse. **Gardez les jetons secrets** et régénérez-les (supprimez `jetons.json`) en cas de fuite.
- Les positions sont conservées **30 jours** par défaut (`RETENTION_JOURS`), puis supprimées. Fixez la durée selon votre politique.
- La géolocalisation de vos chauffeurs est une donnée personnelle : **déclaration à la CNDP**, information des salariés et de leurs représentants (délibération 17-2014), et en Europe le RGPD. Voir `docs/02-cahier-des-charges-application-suivi.md`, §9.
- Le relais ne chiffre pas les fichiers sur disque : protégez le dossier `donnees/`.

## Tests

`npm test` lance les tests de l'application et ceux du relais (`tests/relais.test.js`).
