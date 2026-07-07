# Backend serveur (gaming) — `server/`

API Node/Express (travail d'hier, branche `feat/backend-api`) qui applique les
**captures côté serveur** (anti-triche), gère **classements** (Redis), **saisons**
et **TTL des tuiles**. Postgres (+ schéma `tiles/runs/seasons/partners/badges`) et
Redis (Upstash).

## Endpoints

| Méthode | Route | Rôle |
| --- | --- | --- |
| `GET`  | `/health` | ping |
| `POST` | `/runs` | soumet une course `{player, mode, track, origin}` → `{runId, score, gained, steal, enclosed, tiles, distance_m}` |
| `GET`  | `/leaderboard?mode=&season=` | top 20 (Redis sorted set) |
| `GET`  | `/tiles?bbox=&mode=` | tuiles possédées dans une bbox |

## Lancer

```bash
cd server
cp .env.example .env        # renseigner DATABASE_URL + UPSTASH_REDIS_REST_*
npm install
npm run migrate             # applique db/migrations/0001_init.sql
npm start                   # http://localhost:8787
npm run expire              # (cron) remet en jeu les tuiles expirées (TTL 15 j)
```

## Brancher l'app dessus

L'app utilise par défaut le **mock local** (hors-ligne). Pour taper le vrai
serveur, définir l'URL au build :

```bash
VITE_API_BASE=http://localhost:8787 npm run build
```

`src/api/backend.js` bascule alors sur `RemoteBackend` :
- `POST /runs` reçoit la **trace brute** + le profil (le serveur recalcule les
  captures) ; `GET /leaderboard` sert le classement.
- Les **badges / merveilles / monétisation** restent gérés localement en
  attendant leur exposition serveur (tables `badges` / `partners` déjà au schéma).

## État persistant par tuile (owner · top 10 · attributs)

Chaque tuile a un **id global stable** : `"{instance}:{q},{r}"`, où `(q,r)` sont
les coordonnées axiales calculées depuis l'**origine fixe de l'instance** (même
endroit → toujours le même id). La config d'instance (origine + taille hex) est
la **source de vérité partagée** : `server/instances.js` ↔ `src/tiles.js`
(migration : table `instances`). ⚠️ La taille hex est unifiée à **55 m** des deux
côtés (le serveur utilisait 46 auparavant).

**Où vit l'état** (migration `db/migrations/0002_tile_state.sql`) :

| Donnée | Stockage |
| --- | --- |
| Owner + attributs (passes, best_speed, `capture_count`, acquired/expires, lat/lng) | Postgres `tiles` (PK `instance_id, tile_id, mode`) |
| **Top 10 par tuile** (durable) | Postgres `tile_holders` (PK `…, player_id`, colonne `points`) |
| **Top 10 par tuile** (rapide) | Redis sorted set `t:{instance}:{mode}:{q,r}` (`zincrby` / `zrange rev 0 9`) |
| Historique des prises | Postgres `captures_log` |

À la soumission d'une course (`POST /runs` → `server/capture.js`), pour chaque
tuile parcourue : upsert `tiles` (owner, passes, `capture_count`), upsert
`tile_holders` (points/passes/captures du joueur sur CETTE tuile) et
`zincrby` du sorted set Redis de la tuile.

**Lire l'état d'une tuile** : `GET /tiles/:id?mode=endurance`
→ `{ id, instance, tile, mode, owner, attributes, top10 }`
(le client tape cet endpoint via `backend.getTile(id)` ; en mock local il renvoie
l'état mis en cache dans le store). Dans l'app : **tap sur une tuile** de l'écran
Territoire → fiche (id, propriétaire, captures, top 10).

Côté app, l'état par tuile est aussi **caché localement** (`store.tiles()`,
indexé par id global) pour un fonctionnement hors-ligne ; il se synchronisera
avec le serveur une fois `VITE_API_BASE` défini.

Voir aussi `db/README.md` et `docs/strategy-badges-merveilles-monetisation.md`.
