# Runner Arena — Game Design

> **Fantasme central :** *« Cours pour conquérir ta ville. »*
> Ta course réelle revendique du territoire hexagonal sur une vraie carte. Monde
> partagé asynchrone, saisons/ligues, collection & découverte urbaine — financé
> par des zones sponsorisées et des partenaires. Le vrai KPI : **un maximum de
> runners** (densité = jeu vivant + valeur publicitaire).

## Piliers (décidés)

| Pilier | Choix |
|---|---|
| Boucle | **Saisons & ligues** (cycles ~14 j) + TTL de possession 15 j |
| Monde | **Ouvert asynchrone** (même carte réelle, vols en différé) |
| Capture | **Hybride** : traversée (le fil) + **encerclement** (surface intérieure) |
| Progression | **Collection & découverte** (badges de lieux, POI, quartiers) |
| Rétention | **Défis quotidiens + Séries + Notifications intelligentes + Parrainage** |
| Monétisation | **Zones sponsorisées + Récompenses partenaires + Skins de marque + Pub récompensée** |
| Accessibilité | **Cartes multi-modes** (Rapidité, Endurance, Handicap dynamique…) |

---

## 1. Boucles de jeu

- **Micro (une course)** : cours → *traversée* capture le fil du tracé + *encerclement*
  capture une surface → cinématique de fin + **bilan** (fait) → gains (XP, badges, points de saison).
- **Méso (jour/semaine)** : défis quotidiens, série (streak), **défendre** tes zones avant
  expiration (TTL 15 j), notifications portées par Hexo.
- **Macro (saison ~14 j)** : grimper la ligue de ton mode, compléter des collections de
  quartier, événements partenaires, **reset partiel** → fraîcheur à chaque saison.

## 2. Territoire & capture (hybride)

Grille hexagonale ancrée au sol (déjà en place). **Une tuile** = unité de jeu, déjà modélisée :
`instance_id · tile_id · owner · acquired_at · expires_at · passes · best_speed · mode`.

- **Traversée** — passer sur une tuile la revendique (fil du parcours).
- **Encerclement** — si le parcours **referme une boucle**, toutes les tuiles intérieures
  sont capturées d'un coup (flood-fill) → **gros bonus de surface**. Récompense les tracés malins.
- **Vol (contact 2 couleurs)** — capturer une tuile **déjà tenue** par un adversaire →
  **onde de choc WOW + son d'impact** (amorcé). *Aucun* FX sur une zone neutre (déjà appliqué).
- **TTL 15 j** — sans repassage, la tuile redevient neutre (remise en jeu). Cœur de la rétention.
- **Arbitrage des conflits** — tranché **selon le mode de la carte** (voir §3).

## 3. Cartes multi-modes (accessibilité) — *idée maîtresse*

Plusieurs **arènes** (calques de règles) sur la même géographie. Chaque mode a son **critère
d'arbitrage**, son **classement** et sa **couche de territoire** → un runner lent peut **dominer**
la carte Endurance/Handicap. Élargir la base = plus d'utilisateurs = plus de valeur pub.

| Mode | Critère qui tranche | Public visé |
|---|---|---|
| **Blitz (Rapidité)** | vitesse la plus haute | rapides / compétiteurs |
| **Endurance** | distance / occupation / nb de passages | fondeurs, marcheurs |
| **Handicap dynamique** | score ajusté au niveau du joueur | débutants, inclusif |
| *(extensible)* | Trail (dénivelé), Marche/Famille, Sprint-segments | niches |

> Le paramètre `?mode=speed|passes` déjà prototypé dans `replay-service.js` est la première
> brique de ce système.

## 4. Progression : collection & découverte

- **Badges de lieux** — capturer une tuile contenant un POI (monument, parc, place) débloque
  une **carte à collectionner** (« Panini urbain »). Source POI : OSM / Overpass ou tuiles vectorielles.
- **Complétion de quartier** — contrôler X % d'un quartier/arrondissement → titre + badge + récompense.
- **Atlas personnel** — carte des lieux découverts, monuments « flashés », stats cumulées.
- **Niveaux d'explorateur** — XP par nouveaux lieux / km / zones ; **Hexo évolue** cosmétiquement.
- **Lien partenaires** — les POI sponsorisés donnent des **badges sponsorisés** (collection co-brandée).

## 5. Rétention & croissance (les 4 leviers)

- **Défis quotidiens** — 3/jour (ex. capture 5 zones neuves, cours 3 km, vole 1 zone, referme 1 boucle).
- **Séries (streaks)** — jours consécutifs actifs ; paliers 7 / 30 / 100 j ; **« gel de série »** via pub récompensée.
- **Notifications intelligentes** (voix de **Hexo**) — « 3 zones expirent demain », « Nyx a repris 2 tuiles »,
  « défi du jour », « ta série va se casser ». Contextuelles, **jamais spammy**.
- **Parrainage / viral** — **partage de la cinématique de fin** (GIF/vidéo) = moteur d'acquisition n°1 ;
  code de parrainage (les deux gagnent) ; défis d'amis.

## 6. Monétisation (non intrusive, native au géolocalisé)

- **Zones sponsorisées** — un commerce partenaire = une tuile/POI de marque ; la capturer donne un
  bonus + expose le produit (droit d'exposition géolocalisé).
- **Récompenses partenaires** — objectifs → bons/produits (« cours 5 km cette semaine → réduction chez X »).
  Revenu par **commission** ou **droit d'exposition**.
- **Habillages de marque** — skins Hexo / effets de capture / couleurs sponsorisés (éditions limitées).
- **Pub récompensée** — vidéos **optionnelles** → gel de série, bouclier de zone, boost XP.
- **Règle d'or** : jamais pay-to-win dur, tout opt-in ou natif au monde (le produit *fait partie* de la carte).

## 7. Monde social asynchrone

Carte réelle partagée ; tu vois l'état au **chargement** et à la **fin de course** (la cinématique
montre déjà prises/vols « pendant ton absence »). Pas de temps réel requis → **scalable**. La
résolution des conflits se fait **côté serveur** au moment de la soumission, selon le mode.
*(Clans/factions : compatibles, en extension.)*

## 8. Onboarding & première course

- 1re course **guidée par Hexo**, capture facile (traversée), bilan WOW → accroche immédiate.
- **Pas de compte requis** pour la première course (réduire la friction d'acquisition).

## 9. Équité & anti-triche

- Détection de spoofing GPS (vitesse irréaliste, téléportation). Le garde-fou anti-saut de
  `LocationService` (`_ingest`) est le point de départ à durcir.
- Handicap dynamique et divisions comme équilibrage social.

---

## Roadmap d'implémentation

**Phase 0 — Proto visuel (fait / en cours)**
Vite + MapLibre + Pixi + Capacitor ; `replay-service.js` : cinématique, modèle de tuile côté client,
Hexo + Nyx, bilan, FX de conquête. *Reste à câbler : les appels son (`_sfxSteal/_sfxCapture/_sfxWin`
sont écrits mais pas encore déclenchés dans `_hexoUpdate`).*

**Phase 1 — Fondations jouables (solo/local, sans backend)**
- Capture **hybride en live** : traversée + **détection de boucle fermée** → flood-fill de l'intérieur.
- **Multi-modes** (calque de règles) sur la carte live.
- **XP + badges POI** (source POI OSM/Overpass), atlas local, bilan enrichi.

**Phase 2 — Backend & monde async**
- Schéma : `players`, `tiles(instance_id, tile_id, owner_id, mode, acquired_at, expires_at, passes, best_speed)`,
  `captures_log`, `seasons`, `badges`, `partners`.
- API : *soumettre une course* → le serveur rejoue/valide le tracé → applique les captures selon le mode →
  renvoie les deltas. **Job TTL** (expiration → neutre). Classements par mode/saison. Auth légère.
- *Provisionnable via Stripe Projects (Postgres + Redis + push) — proposable à la demande.*

**Phase 3 — Rétention & croissance**
Défis quotidiens, séries, **notifications push** (Capacitor), **export/partage** de la cinématique, parrainage.

**Phase 4 — Monétisation**
Zones sponsorisées (table `partners` + POI sponsorisés), récompenses, skins, pub récompensée (SDK).

**Phase 5 — Social & durcissement**
Clans/factions, événements de saison, anti-triche renforcé, modération.

---

## Vérification (comment tester chaque phase)

- **Phase 1** : lancer `npm run dev`, faire une course simulée (`?sim=1`), vérifier capture live +
  encerclement + bascule de mode ; puis `?replay=1` pour la cinématique/bilan.
- **Phase 2** : soumettre un GPX à l'API, vérifier les deltas de tuiles + l'expiration TTL + les classements.
- **Rétention/monétisation** : scénarios de défis/streak/notifs et affichage des zones sponsorisées sur la carte.
