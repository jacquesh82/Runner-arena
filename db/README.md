# Backend — Runner Arena

Infra cible (via **Stripe Projects**) : **Neon** (Postgres) + **Upstash** (Redis).
Push mobile hors catalogue Projects → **FCM / OneSignal** côté Capacitor (plus tard).

> ⚠️ Provisionnement en attente : le compte Stripe doit être activé pour Projects
> (https://projects.dev) ou basculé (`stripe projects switch-account`). Ensuite :
> `stripe projects init` puis ajout de Neon et Upstash Redis.

## Postgres (Neon) — source de vérité

Appliquer le schéma une fois `DATABASE_URL` disponible :

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

Tables : `players`, `seasons`, `map_modes`, `partners`, `tiles`, `runs`,
`captures_log`, `badges`, `player_badges` (voir `0001_init.sql`).

Points clés :
- **Tuile** = `(instance_id, tile_id, mode)` → `owner_id`, `acquired_at`,
  `expires_at` (= +15 j), `passes`, `best_speed`.
- Index `idx_tiles_expires` pour le **job TTL** : `WHERE expires_at < now()`.

## Redis (Upstash) — vitesse & temps réel

Design des clés :

| Usage | Clé | Type | Opérations |
|---|---|---|---|
| Classement saison/mode | `lb:{season}:{mode}` | ZSET | `ZINCRBY` à la soumission, `ZREVRANGE 0 N WITHSCORES` |
| Cache propriété tuile | `tile:{instance}:{mode}:{tile}` | STRING + `EXPIRE` 15 j | lecture rapide ; vérité = Postgres |
| Session | `sess:{token}` | STRING | `SET EX`, `GET` |
| Anti-triche (débit) | `rl:{player}:{window}` | STRING/INCR | `INCR` + `EXPIRE` |

Le classement vit dans Redis (lecture O(log n)), reconstruit depuis Postgres si besoin.

## Job d'expiration TTL (→ tâche #8)

Deux options :
1. Cron applicatif : `UPDATE tiles SET owner_id=NULL WHERE expires_at < now()` +
   `INSERT captures_log(kind='expire')`, puis purge des clés Redis correspondantes.
2. **Upstash QStash** (messaging) : planifier le déclenchement du endpoint d'expiration.

## API (→ tâche #8)

`POST /runs` : reçoit le tracé → valide (anti-spoof) → applique les captures selon
le `mode` (traversée / encerclement / vol, arbitrage) → met à jour `tiles`,
`captures_log`, `runs`, classements Redis → renvoie les deltas.
La logique de conquête est déjà écrite côté client dans
`src/services/territory-service.js` et pourra être partagée/portée serveur.

## Push (hors Stripe Projects)

FCM (Android) / APNs via **Firebase** ou **OneSignal**, intégrés au plugin
Capacitor Push. Déclenché par le job TTL et les évènements de vol/attaque.
