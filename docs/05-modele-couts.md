# 05 — Modèle de coûts (schéma 7)

Comment l'application passe de « ce que j'ai dépensé » à « ce que ce voyage m'a rapporté », sans double compte et sans ressaisie.

## 1. Lignes de coût d'un voyage

Chaque voyage porte une liste `lignesCout` : `{ id, type, montant, devise (MAD | EUR), source, date, ref, camionId, chauffeurId, sens?, libelle?, cle? }`.

| Type | Libellé | Rubrique | Comment il arrive |
|---|---|---|---|
| `carburant` | Carburant | carburant | Relevé de carte carburant (rattaché au voyage du camion à cette date), ou saisie ; sinon estimé d'après les pleins |
| `peage_ma` | Péages Maroc | péages Maroc | Gares franchies mesurées par GPS, sinon grille ADM du trajet type |
| `peage_eu`, `peage_fr` | Péages Europe, France | péages | Relevé de télépéage, tarifs officiels VINCI, tarif au km par pays |
| `traversee` | Traversée | traversées | Facture de l'armateur (rappel à l'embarquement) ; remplace l'estimation de **ce sens** seulement |
| `per_diem_chauffeur` | Per diem | frais de route | Calculé : tarif par jour du chauffeur × jours du voyage |
| `parking_securise`, `parking_port`, `hebergement` | Parking, hébergement | frais de route | Saisie ; le conseil « repos hebdomadaire » chiffre l'hébergement |
| `douane_frais`, `frais_douane_destination`, `inspection_sanitaire` | Douane, transitaire, contrôle sanitaire | douane | Rappel aux étapes de douane (forfait du transitaire proposé) |
| `froid_energie` | Énergie du groupe froid | froid | Calculé : part mensuelle du camion × jours |
| `amendes` | Amendes | amendes | Saisie (page Tachygraphe) : rattachée au voyage en cours du chauffeur à cette date |
| `maintien` | Dépannage, pneus en route | dépannage | Saisie |
| `autre` | Autre | autres | Saisie |
| `amortissement_camion`, `amortissement_remorque`, `charges_fixes`, `charges_generales` | Coûts de structure | — | Jamais comptés dans les coûts directs : répartis par le calcul de marge (§ 3) |

**Sources** : `saisie`, `gps`, `fuel_card_csv`, `facture_armateur`, `calcule`.

## 2. Pas de double compte

Les champs d'avant le schéma 7 (`carburantMad`, `peagesMad`, `peagesReelMad`, `peagesEur`, `douaneMad`, `fraisRouteMad`…) restent lus et sont **projetés** en lignes à la lecture (`lignesVoyage`). Dès qu'une ligne réelle existe pour un type, elle **remplace** l'estimation de ce type. Exceptions : une facture de traversée avec un sens ne remplace que la traversée de ce sens ; un coût de structure enregistré sur le voyage ne compte jamais dans les coûts directs.

Les lignes calculées (per diem, froid, péage GPS) sont tenues à jour à chaque enregistrement et **figées** quand le voyage est terminé : un tarif changé après coup ne réécrit pas l'histoire.

## 3. Coûts de structure

- **Charges fixes du camion** (par mois) : crédit ou leasing + assurance + taxe à l'essieu / 12 + amortissement (linéaire, ou dégressif avec coefficients 1,5 / 2 / 3 selon la durée — 🔶 à confirmer avec votre comptable). Le budget d'entretien n'est pas compté : l'entretien réel (interventions) l'est déjà.
- Sur un voyage : charges fixes mensuelles × jours du voyage / 30,4375.
- **Charges générales** : chacune répartie entre les voyages partis le même mois selon sa clé — au kilomètre, au chiffre d'affaires, par camion (part égale par camion, puis par voyage du camion), à parts égales. La somme des parts redonne exactement la charge du mois.
- Au niveau de l'entreprise (page Direction), les charges de la période sont comptées en entier : la part qu'aucun voyage ne porte (camions à l'arrêt) est affichée à part.

## 4. Exemple complet : Casablanca → Perpignan → Lyon → Casablanca

Aller : tomates de Casablanca au marché Saint-Charles International (Perpignan — c'est là qu'est le marché, pas à Marseille). Puis à vide jusqu'à Lyon (450 km), retour chargé de pièces automobiles Lyon → Casablanca. 12 jours, 3 980 km (1 590 aller, 450 à vide, 1 940 retour chargé). Prix total 6 000 € (3 600 aller + 2 400 retour), taux 10,8 MAD/€. Camion en leasing 14 000 MAD/mois, assurance 1 800, taxe 6 000/an, groupe froid 3 000 MAD/mois ; deux autres voyages dans le mois (4 200 et 2 100 km). Montants illustratifs, **calculés par le moteur de l'application** :

| Ligne | Montant | Source | Référence | MAD |
|---|---|---|---|---|
| Carburant | 4 800 MAD | Carte carburant | Casablanca · 400 L | 4 800 |
| Carburant | 806 € | Carte carburant | Algeciras · 520 L | 8 705 |
| Carburant | 825,60 € | Carte carburant | Le Boulou · 480 L | 8 916 |
| Carburant | 486 € | Carte carburant | Murcia · 300 L | 5 249 |
| Per diem chauffeur | 360 € | Calculé | 12 jours × 30 € | 3 888 |
| Énergie du groupe froid | 1 183 MAD | Calculé | 12 jours sur 3 000 MAD par mois | 1 183 |
| Péages Maroc | 506 MAD | Mesuré par GPS | 2 × 253 MAD (classe 3) | 506 |
| Péages Europe | 312,40 € | Saisie | Relevé de télépéage | 3 374 |
| Traversée (aller) | 380 € | Facture de l'armateur | | 4 104 |
| Traversée (retour) | 360 € | Facture de l'armateur | | 3 888 |
| Douane / transitaire | 800 MAD | Saisie | Export | 800 |
| Douane / transitaire | 900 MAD | Saisie | Import | 900 |
| Inspection sanitaire | 120 € | Saisie | Algeciras | 1 296 |
| Parking sécurisé | 50 € | Saisie | 2 nuits | 540 |
| Hébergement | 70 € | Saisie | Repos hebdomadaire | 756 |
| **Coûts directs** | | | | **48 905** |

| | MAD |
|---|---|
| Chiffre d'affaires (6 000 €) | 64 800 |
| **Marge directe** | **15 895** |
| Charges fixes du camion (16 300 × 12 / 30,4375) | − 6 426 |
| Loyer (6 000, au kilomètre : 3 980 km sur 10 280) | − 2 323 |
| Comptable (2 500, à parts égales entre 3 voyages) | − 833 |
| **Marge nette** | **6 313 (9,7 %)** |
| Coût complet au km / au km chargé | 14,70 / 16,57 MAD |
| Coût des 450 km à vide | ≈ 6 613 MAD |

**Le même voyage sans fret de retour** (aller seul à 3 600 €, 2 390 km à vide) : le conseil « retour à vide » affiche **« en dessous de 1 736 € de fret de retour (18 751 MAD), cet aller-retour perd de l'argent »**.

## 5. Où le voir dans l'application

Fiche du voyage (pastille de marge et sa courbe, dépenses, marge nette), page Rentabilité (charges fixes, charges générales, échéances), page Direction (résultat de l'entreprise). Tests : `tests/noyau.test.js` (schéma 7, lignes, répartition, amortissement, marge).
