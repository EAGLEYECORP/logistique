# 09 — Arrivée estimée calée sur vos attentes aux ports

La plus grosse source d'erreur d'une heure d'arrivée Maroc ⇄ Europe, ce sont les attentes aux ports. L'application les mesure à chaque voyage et s'en sert.

## 1. Mesurer chaque passage

| Port | Entrée | Sortie |
|---|---|---|
| `tmed_export` — Tanger Med (export) | étape « Entrée port Tanger Med » | étape « Embarqué (aller) » |
| `alg_entry` — Algeciras (entrée en Europe) | étape « Débarqué à Algeciras » | sortie de la zone du port (GPS), ou bouton « Sorti du port » |
| `tmed_import` — Tanger Med (import) | étape « Débarqué à Tanger Med » | étape « Douane import » |

Les étapes sont posées par le GPS (zones des ports) ou à la main. Chaque mesure : `{ portId, voyageId, camionId, entreeTimestamp, sortieTimestamp, dureeMs, jourSemaine, heureEntree, saison (haute : octobre–mai), avecSPS, scanRouge }`, dans `S.attentesPort` (synchronisé et chiffré : les deux bureaux voient les mêmes). Une mesure sous 5 minutes ou au-delà de 5 jours est écartée ; une étape annulée retire sa mesure.

## 2. Attente attendue

`attentePort(port, heure, jour, saison, { avecSPS })` → `{ p50, p75, p90, n_samples, source }`.

Repli tant qu'il y a moins de 10 mesures (`seuilCalibrationAttente`) : heure ± 2 h + jour + saison → sans la saison → sans le jour → heure ± 6 h → tout le port → **estimation générique** (Tanger Med 3 h, Algeciras 1 h, 4 h avec contrôle sanitaire).

- **Algeciras** : marchandises fraîches (contrôle sanitaire au point unique, depuis octobre 2024) et autres sont mesurées **séparément** — les mélanger fausserait les deux médianes. Un voyage sous température dirigée (ou `marchandiseFrais`) utilise la série « fraîche ».
- **Passage au scanner** (bouton sur la mesure) : hors médiane, gardé pour le P90.
- **Valeur imposée** (Réglages → Général → Attentes aux ports) : passe avant tout (« le lundi à Tanger Med, c'est 4 h »).

## 3. L'arrivée estimée

Le moteur de 2.5.0 (position, vitesse récente, détour, pauses de 45 min, repos de 11 h, traversée) reçoit les attentes :
- port **à venir** : médiane ;
- camion **au port** : médiane moins le temps déjà passé (au moins 15 min) — la carte du camion affiche « au port depuis 1 h 00 — sortie attendue vers 13:00 (médiane 4 h 00, 10 mesures) » ;
- port **franchi** : son attente réelle est connue, il ne pèse plus.

**Fourchette** = somme des (P90 − P50) des ports restants + 8 % du temps de conduite (20 min au moins). Elle se resserre à chaque port franchi. La fiche voyage et le lien client indiquent « calée sur les attentes mesurées » ou « estimation ».

**Décalage** : l'arrivée retenue (`voyage.eta`) ne change que si l'écart dépasse 30 min (`seuilDecalageETA`) ; un tel écart est signalé à l'exploitation, et en urgence s'il fait manquer le créneau promis au client.

## 4. Exemple : Casablanca → Perpignan

Le camion entre à Tanger Med à 9 h un lundi de novembre. 12 voyages mesurés à ce créneau : médiane 4 h, P90 5 h 30. Algeciras, marchandise fraîche : médiane 3 h, P90 5 h.

| Moment | Ports restants | Fourchette (ports) |
|---|---|---|
| Au départ | Tanger Med (4 h) + Algeciras (3 h) | ± (1 h 30 + 2 h) = ± 3 h 30 |
| Au port depuis 1 h | Tanger Med : reste 3 h ; Algeciras 3 h | idem, l'heure de sortie de Tanger Med s'affiche |
| Embarqué après 2 h 15 d'attente réelle | Algeciras (3 h) | ± 2 h |
| Sorti d'Algeciras après 3 h 40 | — | ± conduite seule |

Au retour, l'attente à Tanger Med (import) se mesure de la même façon (par exemple 1 h 50) et alimente les voyages suivants.

## 5. Côté relais

Le relais charge `prevision.js` avec le moteur ; l'application lui transmet, avec chaque lien client, les attentes à appliquer (`portH`, `auPortH`, `debarqH`, fourchette, source) — jamais vos mesures. Le lien client calcule donc la même arrivée que l'application (testé). Tests : `tests/noyau.test.js` et `tests/relais.test.js` (mesure, repli, scanner, contrôle sanitaire séparé, valeur imposée, fourchette, décalage, synchronisation, même moteur).
