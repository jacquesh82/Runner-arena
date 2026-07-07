# Runner Arena — Stratégie : badges, merveilles & monétisation

> Périmètre : l'app Android/iOS **affiche et joue**. Toute la logique gaming
> « sérieuse » (validation, attribution, économie) et la logique **commerciale**
> vivent sur un **backend web séparé**. Ce document décrit *comment générer les
> badges, gérer les merveilles et monétiser une tuile*, et l'architecture qui
> le porte.

---

## 1. Principe directeur : le serveur fait autorité

L'app est un **client**. Elle envoie une course (trace GPS + tuiles capturées) ;
le backend **valide, calcule et renvoie** le résultat (XP, badges, territoire,
combat). Raisons :

- **Anti-triche** : la position peut être falsifiée (mock GPS). Le serveur
  vérifie la plausibilité (vitesse, téléportation, précision, cohérence
  temporelle) avant d'accorder quoi que ce soit.
- **Économie contrôlée** : prix des tuiles, sponsors, soldes → jamais côté client.
- **Évolutivité** : on ajoute un badge ou une merveille **sans publier** de MAJ
  du store (données servies dynamiquement).

Dans le code actuel, `src/api/backend.js` matérialise cette frontière : un
`RemoteBackend` (fetch REST) et un `MockBackend` (démo locale) partagent la
**même interface**. On bascule via `VITE_API_BASE`.

---

## 2. Badges — stratégie de génération

### 2.1 Taxonomie (axes)
Un badge = une **famille** × un **palier** × une **rareté**.

| Famille | Exemples de déclencheurs |
| --- | --- |
| Distance | 1er km, 10 km, 42 km cumulés, 10 km en une course |
| Conquête | 10 / 50 / 500 zones possédées, 10 zones en une course |
| Exploration | 5 villes différentes, 3 pays, 1 nouvelle zone/jour × 7 |
| Merveilles | 1re merveille, 5 merveilles, un tier‑3, un quartier entier |
| Combat | 0 perte, 20 zones volées, tenir une merveille 7 jours |
| Régularité | 5 courses, série de 7 jours, run avant 7 h |
| Social | inviter un ami, battre un rival, top 10 d'un quartier |
| Saison | podium de saison, badge événementiel (daté) |

### 2.2 Génération : **data-driven, pas codée en dur**
Un badge est une **ligne de données** (JSON) évaluée par un moteur de règles,
pas du code. Schéma :

```json
{
  "id": "conqueror",
  "name": "Conquérant", "icon": "crown",
  "rarity": "rare", "xp": 60,
  "rule": { "metric": "lifetime.territory", "op": ">=", "value": 50 },
  "season": null, "hidden": false
}
```

Le backend expose des **métriques** (`lifetime.*`, `run.*`, `streak.*`,
`merveille.*`) ; une règle combine métrique + opérateur + seuil (et des `AND/OR`
pour les cas composés). Avantages :
- créer/équilibrer un badge = éditer une ligne dans la **console admin** ;
- **paliers automatiques** : un même modèle (`distance_cumulée`) génère
  Bronze/Argent/Or par simple table de seuils ;
- rétro-attribution : rejouer les règles sur l'historique existant.

> Le fichier `src/data/badges.js` est la **version de référence** de ce moteur,
> exécutée localement en démo. En prod, les règles vivent en base et sont
> évaluées côté serveur.

### 2.3 Génération des **visuels**
- **Système de composition** : un badge = *forme* (médaille/écusson/étoile) +
  *icône* (jeu d'icônes maison, style du logo) + *cadre de rareté* (couleur +
  effet). On génère les PNG/SVG par script (templating SVG → export), pas à la
  main → cohérence + coût quasi nul par nouveau badge.
- Rareté = couleur : Commun `#8aa0c8`, Rare `#34ad69`, Épique `#ec7a1c`,
  Légendaire `#f2c400` (déjà en place).
- Option IA : génération d'icônes assistée pour les badges événementiels, puis
  passage dans le gabarit maison pour l'unité visuelle.

### 2.4 Attribution (flux)
```
course terminée → POST /runs → validation anti-triche →
maj métriques → moteur de règles → badges débloqués → XP → réponse à l'app
```
L'app ne fait qu'**afficher** le résultat (écran Résumé → « Nouveaux badges »).

---

## 3. Merveilles — quartiers & monuments

### 3.1 Source de données (POI réels)
Une merveille = un **POI réel** projeté sur une ou plusieurs tuiles hexagonales.

- **Monuments / lieux** : OpenStreetMap via **Overpass API**
  (`historic=*`, `tourism=attraction`, `amenity`, `leisure=park`…) +
  **Wikidata** (notoriété, image, description, multilingue).
- **Quartiers** : polygones administratifs OSM (`boundary=administrative`,
  `place=neighbourhood/suburb`) → ensemble de tuiles couvrant le polygone.
- **Pipeline** (offline, périodique) : Overpass/Wikidata → filtrage &
  scoring de notoriété → **tiling** (rasterisation du POI sur la grille hex,
  même maths que `hexgrid.js`) → table `merveilles` (tuiles, tier, image).

### 3.2 Tier & gameplay
- **Tier** (1–3) selon la notoriété/superficie → points, bonus de contrôle,
  visibilité sur la carte.
- **Contrôle** : posséder la/les tuile(s) de la merveille = la « contrôler » →
  bonus (XP passif, multiplicateur de capture autour, cosmétique).
- **Quartier** = merveille multi-tuiles : il faut contrôler **X %** de ses
  tuiles pour le revendiquer (objectif d'équipe, rejouabilité forte).
- **Siège / decay** : une merveille non défendue s'affaiblit (perd son bonus
  après N jours) → incite à revenir courir. Résolue lors du **Combat de
  territoire** de fin de course (déjà en place côté animation).
- **Saisons** : reset partiel du territoire à chaque saison ; les merveilles
  contrôlées en fin de saison rapportent des récompenses (badge + cosmétique).

### 3.3 Dans l'app (déjà implémenté)
`src/data/merveilles.js` (catalogue servi par le backend) + rendu doré sur le
plateau (`GameEngine._drawMerveille`) + revendication à la capture + onglet
**Merveilles** dans la Collection.

---

## 4. Monétisation d'une tuile (et au-delà)

Objectif : monétiser **sans casser l'équité** (pas de « pay-to-win » brutal).
Modèles combinables :

### 4.1 Sponsoring de tuile / merveille (B2B) — **levier principal**
Un commerce local **sponsorise** la tuile qui couvre son établissement (ou une
merveille) : logo/pin sur la carte, offre « visite = bonus », défi sponsorisé
(« cours jusqu'ici cette semaine → récompense »). Vendu via la **console
commerciale** (self-service + régie). Revenu récurrent, ancré dans le réel,
sans pénaliser les joueurs — au contraire ça crée des objectifs.

### 4.2 Cosmétique (B2C) — **volume**
- **Skins de territoire** (couleur/motif de tes hexagones), traînées de runner,
  effets de capture, cadres de badge. Non-P2W, forte marge.
- **Skins de merveille** contrôlée (bannière à ton effigie).

### 4.3 Boosts & confort (B2C) — **avec garde-fous**
- Double XP week-end, bouclier anti-siège 24 h, portée de capture +1 pendant une
  course. Plafonnés et cosmétiquement visibles pour rester « fair ».
- **Pass saison** (battle pass) : piste de récompenses cosmétiques + badges
  exclusifs. Meilleur ratio rétention/revenu.

### 4.4 Acquisition directe d'une tuile — **rare/premium**
Acheter le **droit d'affichage** d'une tuile (message/pin perso, ex. « demande
en mariage »). Encadré (modération), prix dynamique selon la valeur (centralité,
merveille proche). C'est un *droit cosmétique/social*, pas un avantage de jeu.

### 4.5 Recommandation
Socle **cosmétique + pass saison** (volume B2C) financé au long cours par le
**sponsoring local** (B2B, marge et ancrage réel). Boosts limités et
non‑P2W. L'acquisition de tuile reste un produit premium de niche.

### 4.6 Flux commercial (serveur only)
```
console commerciale → crée offre (tuile/merveille, période, prix)
app → GET /tiles/:id (prix, sponsor, en vente ?)
achat → POST /tiles/:id/purchase → PSP (Stripe / Google Play / App Store) →
webhook paiement → activation → l'app rafraîchit l'affichage
```
Le contrat est déjà stubé dans `backend.js` (`getTile`, `purchaseTile`).

---

## 5. Architecture backend (web, hors app)

Voir `docs/backend-architecture.svg`.

- **API Gateway / Auth** : comptes, sessions, tokens (OAuth social + email).
- **Game Service** : validation de course (anti-triche), capture, combat,
  territoire, saisons.
- **Badge Service** : moteur de règles + attribution + catalogue.
- **Merveille/POI Service** : catalogue + contrôle + **pipeline POI**
  (Overpass/Wikidata → tiling) en tâche planifiée.
- **Commerce Service** : offres, sponsors, paiements (PSP), reçus, facturation.
- **Leaderboard/Social** : classements (par quartier/ville/saison), amis, défis.
- **Console Admin & Commerciale** (web) : éditer badges/merveilles, gérer
  sponsors et offres, modération, analytics.
- **Data** : Postgres (+ **PostGIS** pour la géo/tiling), Redis (classements,
  cache), stockage objet (assets badges/merveilles).
- **Tech conseillée** : Node/TypeScript (mêmes modèles partagés que l'app) ou
  Go pour le Game Service ; Postgres/PostGIS ; Redis ; file de tâches pour le
  pipeline POI ; PSP = Stripe + facturation in‑app store.

### Modèle de données (extrait)
```
users(id, handle, level, xp, created_at)
runs(id, user_id, started_at, distance, duration, geojson, valid)
tiles(id, hex_q, hex_r, city, owner_id, merveille_id, sponsor_id)
merveilles(id, name, type, tier, wikidata_id, geom, tile_ids[])
badges(id, name, rarity, xp, rule_json, season, art_url)
user_badges(user_id, badge_id, earned_at)
sponsors(id, name, tile_id|merveille_id, starts_at, ends_at, price, status)
orders(id, user_id, sku, amount, psp_ref, status)
```

### Contrat API (rappel)
`GET /me` · `POST /runs` · `GET /badges` · `GET /merveilles?bbox=` ·
`POST /merveilles/:id/claim` · `GET /tiles/:id` · `POST /tiles/:id/purchase` ·
`GET /leaderboard` — implémenté côté client dans `src/api/backend.js`.

---

## 6. Feuille de route

1. **MVP backend** : Auth + `POST /runs` (validation basique) + `GET /badges`
   (règles data-driven) + `GET /merveilles`. L'app remplace le mock par l'URL.
2. **Pipeline POI** : Overpass/Wikidata → tiling PostGIS → merveilles d'une ville.
3. **Commerce** : console sponsors + PSP + `tiles/:id` (sponsoring d'abord).
4. **Cosmétique + Pass saison** ; classements par quartier ; siège/decay.
5. **Anti-triche avancé** (modèles de plausibilité), multi-villes, événements.

---

## 7. État côté app (déjà livré)

- Badges : catalogue + moteur de règles de référence + attribution + écran
  Collection + encart « Nouveaux badges » au Résumé.
- Merveilles : catalogue + rendu sur le plateau + revendication + onglet dédié.
- Frontière backend : `src/api/backend.js` (contrat REST + mock local).
- Persistance locale (cache) : `src/store.js`.
