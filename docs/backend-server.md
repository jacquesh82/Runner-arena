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

Voir aussi `db/README.md` et `docs/strategy-badges-merveilles-monetisation.md`.
