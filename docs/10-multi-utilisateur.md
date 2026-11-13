# 10 — Multi-utilisateur : un navigateur suffit, des droits réels

Avec `MULTI_UTILISATEUR=true`, le relais devient le serveur de l'application : chaque membre de l'équipe (Casablanca, Francfort, un transitaire partenaire) ouvre l'adresse du relais dans un navigateur, se connecte avec son compte et voit le même état, en direct. Plus de mot de passe de synchronisation par appareil, plus d'installation obligatoire.

Les droits sont **appliqués par le serveur** à chaque appel : ce qu'un rôle ne doit pas voir n'est jamais envoyé, et ce qu'il n'a pas le droit de changer est refusé ou ignoré. L'ancien profil d'appareil (« tri de l'affichage, pas un contrôle d'accès ») reste pour le mode sans comptes.

## 1. Mise en route

```bash
MULTI_UTILISATEUR=true CHIFFRER_DONNEES=true CLE_DONNEES='phrase longue et secrète' \
URL_PUBLIQUE=https://suivi.votre-entreprise.ma \
SMTP_HOTE=smtp.gmail.com SMTP_PORT=465 SMTP_UTILISATEUR=… SMTP_MOT_DE_PASSE=… SMTP_DE=… \
node serveur/relais.js
```

1. Ouvrez l'adresse du relais (en HTTPS dès qu'il est joignable depuis Internet).
2. **Premier démarrage** : nom, e-mail et mot de passe du chef d'entreprise, **jeton de lecture** du relais (affiché à son démarrage : personne d'autre ne peut s'approprier un relais neuf), puis les données de départ — celles de l'appareil, une sauvegarde `.json`, ou rien.
3. Notez la **clé de récupération** affichée une seule fois.
4. Connexion, puis **double authentification** (obligatoire pour le chef) : une application d'authentification (Google Authenticator, Microsoft Authenticator, Aegis…) et un code à 6 chiffres.
5. Page **Utilisateurs** : créez les comptes de l'équipe (mot de passe provisoire à transmettre de vive voix ; chacun le change dans Réglages → Mon compte).

Les applications déjà installées (téléphones des chauffeurs, appareils hors ligne) continuent de marcher avec les jetons et la synchronisation chiffrée.

## 2. Rôles et droits

| Données | Chef | Exploitant | Répartiteur | Commercial | Comptable | Chauffeur | Transitaire |
|---|---|---|---|---|---|---|---|
| Voyages | tout | tout | sans prix ni marges | lecture, sans dépenses | lecture ; dépenses seulement | ses voyages : étapes, preuve, listes | voyages confiés, lecture |
| Commandes | tout | tout | sans prix | tout | lecture | — | — |
| Factures | tout | lecture | **refusé** | écriture (pas de suppression) | écriture | — | — |
| Clients | tout | lecture | lecture sans conditions | tout | lecture | — | — |
| Camions, chauffeurs, flotte | tout | tout | sans coûts fixes | lecture | lecture ; coûts fixes | sa fiche, ses camions | — |
| Échéances, charges générales | tout | lecture | — | — | tout | — | — |
| Dossiers de douane | tout | tout | tout | lecture | — | — | dossiers confiés |
| Réglages | tout | lecture | lecture sans trésorerie | lecture | lecture | — | — |
| Utilisateurs, journal | ✔ | — | — | — | — | — | — |

Règles communes (`comptes.js`, même fichier pour l'application et le relais) :
- un rôle qui ne voit pas les prix ne peut **ni les modifier ni les effacer** : quand il enregistre un voyage, le serveur reprend les prix existants ;
- un rôle à écriture partielle (comptable, chauffeur) ne change que ses champs ; il ne crée pas d'enregistrement dans ces collections ;
- « ses voyages » : `voyage.chauffeurId` = fiche chauffeur du compte ; « confiés » : `transitaireId` = identifiant du compte ;
- chaque refus est inscrit au journal.

### Accès par service (réglés par le chef)

Le tableau ci-dessus est le **défaut**. Page **Accès par service** (chef d'entreprise) : pour chaque rôle et chaque groupe de données — voyages (avec traces, attentes, notifications, zones, trajets, autorisations), commandes, factures, clients, flotte (camions, chauffeurs, pleins, entretien), charges (charges générales, échéances, dépenses à rattacher), douane (dossiers, codes SH), réglages (avec le routage des notifications) — choisir :

| Niveau | Lire | Prix, coûts, marges | Modifier | Supprimer |
|---|---|---|---|---|
| Aucun accès | — | — | — | — |
| Lecture, sans prix | ✔ | — | — | — |
| Lecture | ✔ | ✔ | — | — |
| Modification, sans prix | ✔ | — | ✔ | — |
| Modification | ✔ | ✔ | ✔ | — |
| Tout, sans prix | ✔ | — | ✔ | ✔ |
| Tout | ✔ | ✔ | ✔ | ✔ |

- appliqué par le serveur (`droitsEffectifs` dans `comptes.js`) à chaque lecture, écriture, flux en direct et chargement ;
- s'applique **tout de suite** : les appareils connectés rechargent ce que leur rôle peut voir, le menu suit (une page sans aucun droit disparaît, un accès accordé la fait apparaître) ;
- le chef d'entreprise n'est jamais restreint ; « ses voyages » / « dossiers confiés » restent la règle pour le chauffeur et le transitaire ; les réglages ne peuvent pas passer à « aucun accès » (l'application en a besoin) ;
- chaque changement est inscrit au journal (`droits_modifies`, avant / après) ; réglage conservé dans `comptes.json`.

Sans relais, sur un appareil seul : Réglages → Appareil → **Pages de chaque service** choisit les pages et l'affichage des prix de chaque profil — un tri de l'affichage protégé par le code du poste, pas un contrôle d'accès.

## 3. Authentification

| Élément | Choix |
|---|---|
| Mots de passe | 12 caractères au moins, sans règle de composition ni rotation imposée (recommandations NIST) ; empreinte **scrypt** (N = 2^15), sel par compte. Argon2id demanderait une dépendance compilée : écarté (docs/11-decisions-v4.md). |
| Sessions | Jetons opaques aléatoires (le serveur ne garde que leur empreinte SHA-256) plutôt que JWT : révocables instantanément. Accès 12 h, renouvellement 30 jours avec **rotation** ; un jeton de renouvellement réutilisé révoque toute la famille (vol). |
| Navigateur | Cookies `HttpOnly`, `Secure`, `SameSite=Strict` ; écriture refusée sans l'en-tête `X-LF` (protection contre les requêtes d'un autre site). `COOKIE_NON_SECURISE=true` seulement pour un essai en http hors `localhost`. |
| Double authentification | TOTP (RFC 6238), ± 30 s, un code ne sert qu'une fois. Obligatoire pour le chef : sans elle, son compte ne peut que l'activer. Facultative pour les autres. |
| Essais | 10 par minute et par adresse ; 5 échecs → compte bloqué 15 min ; 3 blocages en 24 h → 1 h. |
| Réseau inhabituel | Sans base de géolocalisation (payante), le relais compare le réseau (deux premiers octets de l'adresse) aux 5 derniers du compte : alerte au chef (historique d'alertes, canaux du relais) et inscription au journal. |
| Mot de passe oublié | Lien d'une heure, à usage unique, par e-mail (SMTP du relais). Sans SMTP : le chef définit un mot de passe provisoire. |
| Chef bloqué | La **clé de récupération** réinitialise son mot de passe et sa double authentification, puis est remplacée. (Le mot de passe de synchronisation ne peut pas servir : le relais ne l'a jamais vu.) |
| Changements sensibles | Changer de mot de passe coupe les autres sessions ; changer le rôle, clôturer ou réinitialiser un compte le déconnecte partout (y compris le flux en direct). |

## 4. Données, versions et conflits

- Chaque enregistrement a une **version**. Une modification envoie `If-Match: <version>` ; si quelqu'un a modifié entre-temps : **409** avec l'état actuel et le nom de l'auteur. L'application propose **Fusionner** (recommandé : vos changements + les siens, la vôtre l'emporte sur un même champ), **Garder ma version** ou **Prendre la sienne**.
- Deux personnes qui modifient des champs différents ne voient même pas de conflit : la fusion est automatique dès qu'elles acceptent.
- **Verrous de 30 s** sur les opérations sensibles (livraison, preuve de livraison, encaissement, suppression d'un voyage) : les autres voient « X modifie » ; on peut passer outre en connaissance de cause.
- **Suppression douce** : l'enregistrement est retiré pour tous mais conservé (et son contenu inscrit au journal).
- `GET /api/changes?since=<n>` : ce qui a changé depuis — un appareil revenu en ligne rattrape ; les enregistrements sortis de son périmètre lui sont signalés comme supprimés.
- **Temps réel** : `GET /api/sse` pousse chaque changement aux rôles concernés (moins d'une seconde mesurée) ; reconnexion automatique de 1 s à 30 s.

## 5. Journal

Chaque écriture (création, modification, suppression) avec l'auteur, la date et les champs avant/après ; connexions, échecs, refus, conflits, comptes créés ou modifiés, récupérations. Page **Journal** (chef) : filtres par personne, données, action, période ; export CSV. Fichier `donnees/audit.jsonl`, chiffré ligne par ligne, **24 mois** (`RETENTION_AUDIT_JOURS`). Le journal d'accès à l'API (`JOURNAL_ACCES=true`) reste à part, 30 jours.

## 6. API

| Route | Rôle |
|---|---|
| `GET /api/auth/etat` | Mode multi, relais initialisé, réinitialisation par e-mail possible. |
| `POST /api/auth/initialiser` | Premier compte (jeton de lecture requis) et import des données. |
| `POST /api/auth/login` · `refresh` · `logout` · `GET /api/auth/me` | Session. |
| `POST /api/auth/mot-de-passe` · `2fa/initier` · `2fa/activer` · `2fa/desactiver` | Mon compte. |
| `POST /api/auth/reinitialiser` · `reinitialiser/confirmer` · `recuperation` | Mot de passe oublié, clé de récupération. |
| `GET/POST /api/utilisateurs` · `PUT /api/utilisateurs/<id>` | Comptes (chef). Pas de suppression : clôture et réouverture. |
| `GET /api/donnees` | Tout ce que le rôle peut voir (filtré). |
| `GET/PUT/DELETE /api/records/<collection>/<id>` | Un enregistrement (versions, verrous : `X-Forcer: 1`). |
| `GET /api/changes?since=` · `GET /api/sse` | Rattrapage, temps réel. |
| `POST /api/verrous` · `DELETE /api/verrous/<collection>/<id>` | Verrous de 30 s. |
| `GET /api/droits`, `PUT /api/droits` `{ droits: { role: { groupe: niveau } } }` | Accès par service (chef). `{}` remet tout par défaut. |
| `GET /api/journal?utilisateur=&collection=&action=&debut=&fin=&format=csv` | Journal (chef). |

Les routes existantes (positions, liens client, notifications, synchronisation) acceptent toujours les jetons ; une session d'un rôle de suivi (chef, exploitant, répartiteur, commercial) vaut le jeton de lecture.

## 7. Stockage et sauvegarde

Fichiers JSON par collection (`donnees/base/*.json`), comptes, sessions et journal — tous chiffrés si `CHIFFRER_DONNEES=true`, écrits de façon atomique. Pas de base SQLite : elle exigerait un module compilé ; à l'échelle d'une flotte (quelques milliers d'enregistrements), les fichiers suffisent. Sauvegardez le dossier `donnees/` chaque nuit (il est chiffré), et la phrase secrète **ailleurs**.

## 8. Liste de sécurité

- [ ] HTTPS (tunnel ou proxy : voir `serveur/README.md`), `CHIFFRER_DONNEES=true`, phrase secrète hors du serveur.
- [ ] Double authentification du chef activée ; clé de récupération rangée en lieu sûr.
- [ ] Un compte par personne, rôle le plus restreint suffisant ; comptes des partis clôturés le jour même.
- [ ] Journal consulté régulièrement (refus, échecs de connexion, réseaux inhabituels).
- [ ] Sauvegarde nocturne du dossier `donnees/` hors du serveur.
