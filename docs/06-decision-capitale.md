# 06 — Acheter un camion : le simulateur

Page Direction → « Simuler un achat de camion ». Le simulateur ne remplace pas l'avis de votre banque ou de votre comptable ; il répond vite à une question précise : **ce camion couvrira-t-il sa charge sur mes corridors, avec mes marges réelles ?**

## 1. Ce qu'on saisit

- Prix du camion ; financement : **comptant** (amortissement sur N années, valeur de revente), **crédit** (apport, taux, durée) ou **leasing** (loyer, durée) ; charges annexes par mois (assurance, taxe, salaire fixe).
- Kilomètres par mois à pleine charge (proposé : la moyenne de votre flotte) et **taux de charge** attendu.
- Jusqu'à trois corridors et leur part : leur **marge directe par kilomètre est celle observée sur vos voyages des 12 derniers mois** (retours à vide compris). Sans historique : une marge saisie.

## 2. Calculs

- Crédit : mensualité constante `K·t / (1 − (1 + t)^−n)`, `t` = taux mensuel ; tableau d'amortissement complet (intérêts dégressifs, capital entièrement remboursé).
- Charge fixe ajoutée = mensualité (ou loyer, ou amortissement) + annexes.
- Marge attendue par mois = km par mois × taux de charge × marge par km (moyenne des corridors pondérée par leur part).
- **Taux de charge d'équilibre** = charge fixe / (km par mois × marge par km). Au-delà de 100 % : le camion ne peut pas se payer avec ces marges.
- Trésorerie mois par mois : mise de départ (prix comptant, ou apport), puis marge − sorties d'argent (l'amortissement n'est pas une sortie d'argent) ; **délai de retour** = premier mois où le cumul redevient positif ; état à 36 mois et point bas.
- **Sensibilité** : résultat mensuel pour un taux de charge de 50 à 100 %, pour la répartition prévue et pour chaque corridor seul.

## 3. Exemple : un deuxième camion sur Casablanca → Perpignan

Marge directe observée sur ce corridor : **3,99 MAD/km** (le voyage du document 05 : 15 895 MAD sur 3 980 km). Camion à 1 150 000 MAD, crédit avec 250 000 MAD d'apport, 7 % sur 60 mois, annexes 4 500 MAD/mois, 9 500 km/mois, taux de charge 85 %. Résultats du moteur :

| | |
|---|---|
| Mensualité / intérêts totaux | 17 821 MAD / 169 265 MAD |
| Charge fixe ajoutée | 22 321 MAD par mois |
| Marge attendue (9 500 × 85 % × 3,99) | 32 250 MAD par mois |
| Résultat mensuel | **+ 9 929 MAD** |
| **Taux de charge d'équilibre** | **58,8 %** |
| Délai de retour de l'apport | 26 mois |
| Trésorerie à 36 mois | + 107 433 MAD (point bas − 250 000 au départ) |

| Taux de charge | 50 % | 60 % | 70 % | 80 % | 90 % | 100 % |
|---|---|---|---|---|---|---|
| Résultat mensuel (milliers de MAD) | − 3,4 | + 0,4 | + 4,2 | + 8,0 | + 11,8 | + 15,6 |

**Lecture** : sous 59 % de charge, le camion perd de l'argent. Les retours à vide pèsent lourd dans les 3,99 MAD/km : trouver du fret de retour (conseil « retour à vide ») relève directement le résultat. Sur un corridor à 13,4 MAD/km (Agadir → Lyon dans le même jeu de données), l'équilibre tomberait autour de 18 %.

## 4. Limites

Marge directe seulement (les charges générales ne changent pas avec un camion de plus) ; pas d'inflation, de revente anticipée ni de fiscalité. Tests : `tests/noyau.test.js` (crédit, équilibre, sensibilité, marges observées).
