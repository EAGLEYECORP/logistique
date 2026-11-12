# 08 — Notifications par étape

Qui est prévenu, quand, comment, dans quelle langue — aux 11 étapes du voyage, et avant ou après certaines d'entre elles.

## 1. Le routage

`S.routageJalons` : une entrée par étape (identifiant = étape, pour la synchronisation). Vide = routage par défaut ; seules les étapes modifiées sont enregistrées.

```
{ jalon, auto, audiences: { audience: [canal] }, modeles: { fr, en, es, ar },
  pre_notifications: [{ offset_h | jour + heure, audience, canal, modele }],
  post_notifications: [{ offset_h, audience, canal, modele, siNonFacture? }] }
```

| Étape | Auto | Prévenus par défaut |
|---|---|---|
| Départ | oui | exploitation Maroc et Allemagne (ntfy), direction (application) ; rappel la veille à 18 h à l'exploitation Maroc |
| Douane export | non | exploitation Maroc (ntfy), transitaire (e-mail : DUM, CMR, facture) |
| Entrée au port de Tanger Med | oui | exploitation Maroc et Allemagne ; rappel au chauffeur 2 h avant la présentation |
| Embarqué (aller) | oui | exploitation, direction ; rappel au chauffeur 3 h avant (réservation) |
| Débarqué à Algeciras | oui | exploitation, commercial |
| Livré | non (preuve de livraison) | **client** (s'il a accepté), comptabilité (e-mail), commercial, direction ; rappel au chauffeur 1 h avant ; « facture à émettre » à la comptabilité 24 h après si elle n'est pas faite |
| Chargement retour | non | exploitation |
| Embarqué (retour) | oui | exploitation |
| Débarqué à Tanger Med | oui | exploitation Maroc |
| Douane import | non | exploitation Maroc, comptabilité |
| Retour au dépôt | oui | direction (application et ntfy), comptabilité (e-mail : marge directe), exploitation Maroc |

Réglages → Rappels → « Notifications par étape » : destinataires (sujet ntfy, e-mail, WhatsApp, langue), grille étapes × destinataires, case « Auto », éditeur de message par étape avec aperçu, bouton « Essayer les canaux ».

## 2. Destinataires et canaux

| Audience | Résolue en |
|---|---|
| Exploitation Maroc / Allemagne, direction, commercial, comptabilité, transitaire | Coordonnées saisies dans les réglages |
| Client | Fiche du client : **seulement si « Le client accepte d'être prévenu »** est coché ; canal préféré (WhatsApp, e-mail, SMS) et langue. WhatsApp avec repli sur l'e-mail. |
| Chauffeur | Fiche du chauffeur : sujet ntfy, sinon WhatsApp ; langue (français, arabe…) |

| Canal | Envoyé par |
|---|---|
| Application (`in_app`) | Fil « Notifications » de l'application |
| ntfy | Relais ; sans relais, l'application directement (gratuit, application ntfy sur le téléphone) |
| E-mail | Relais (SMTP) ; sinon message prêt à envoyer |
| WhatsApp | Relais avec un compte WhatsApp Cloud (modèles approuvés par Meta pour un premier message) ; sinon lien `wa.me` prêt à envoyer |
| Canaux du relais (`equipe`) | Telegram, WhatsApp de l'équipe, webhook configurés sur le relais |

Un destinataire sans coordonnées n'est jamais inventé : il est signalé (« sujet ntfy à renseigner »).

## 3. Rédiger un message

Variables : `{ref} {client} {origine} {destination} {jalon} {heure} {camion} {chauffeur} {reservation} {controles} {marge} {eta} {lien} {entreprise}`. L'heure est celle du Maroc. Une variable inconnue reste visible pour être corrigée. Le message personnalisé d'une étape est choisi dans la langue du destinataire ; à défaut, le message par défaut dans sa langue (français, anglais, espagnol, arabe). Les messages du client, de la comptabilité, du transitaire et du chauffeur ont leurs propres modèles.

## 4. Envoi

- **Étape atteinte** (GPS, chauffeur, bouton) : si l'étape est automatique, les messages partent une fois (`voyage.notifsJalons`) ; deux appareils qui la voient en même temps n'envoient qu'une fois (déduplication du relais sur 6 h).
- **« Notifier »** sur chaque étape de la fiche voyage : messages pré-remplis, modifiables, cases à cocher par destinataire. Ce que le relais ne peut pas envoyer s'ouvre en liens prêts à envoyer.
- **Rappels programmés** : calculés depuis les heures prévues (départ, présentation = embarquement − 3 h, livraison = arrivée estimée ou créneau promis, retour) — un voyage décalé décale ses rappels. L'application envoie le plan au relais (rédigé, sans autres données) ; le relais l'exécute **chaque minute, même application fermée**, garde ce qui est parti ou annulé (un nouveau plan ne renvoie rien) et n'envoie plus un rappel en retard de plus de 6 h. Panneau « Notifications » : rappels des 24 h, **Annuler** ou **+1 h**.
- Relais : `PUT /api/notifications/plan`, `GET /api/notifications/scheduler`, `DELETE /api/notifications/scheduler/<id>`, `POST /api/notifications/manuelle`, `POST /api/notifications/test` (voir `serveur/README.md`).

## 5. Ce qui n'est pas fait

Pièces jointes PDF (le message contient le lien de suivi) ; réglage SMTP depuis l'application (le relais ne lit pas les données synchronisées : il se règle par ses variables) ; message « retard probable » envoyé automatiquement au client (l'exploitation est prévenue, le client par le bouton « Notifier »).
