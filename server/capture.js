/* Applique une course soumise : rasterise le tracé, calcule traversée +
 * encerclement + vols (arbitrés par le mode), persiste (tiles, captures_log,
 * runs) et met à jour le classement Redis. Miroir serveur de
 * src/services/territory-service.js. */

import { pool } from "./db.js";
import { redis } from "./redis.js";
import { rasterize, enclosed, centerLatLng, trackStats } from "./hex.js";

const TTL_MS = 15 * 86400000;   // TTL possession : 15 jours
const SIZE = 46;                // rayon hexagone (m) — doit matcher la config d'instance

// Le challenger (course courante) prend-il la tuile déjà tenue par un adversaire ?
function challengerWins(mode, mine, held) {
  const ms = mine.speed ?? 0, hs = held.best_speed ?? 0;
  const mp = mine.passes ?? 1, hp = held.passes ?? 1;
  if (mode === "blitz") return ms > hs;        // le plus rapide
  if (mode === "handicap") return ms < hs;     // l'outsider (plus lent) l'emporte
  return mp >= hp;                             // endurance : le plus assidu
}

export async function applyRun({ instanceId = "paris", origin = [48.8566, 2.3522], player, mode = "endurance", seasonId, track }) {
  const { order, passes } = rasterize(track, origin, SIZE);
  const interior = enclosed(order);
  const claimed = [...new Set([...order, ...interior])];
  const stats = trackStats(track);
  const runSpeed = stats.speed;               // m/s (null si GPX non horodaté)
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_MS);

  const client = await pool.connect();
  const d = { trail: 0, steal: 0, enclosed: 0, kept: 0, tiles: [] };
  try {
    await client.query("BEGIN");

    // propriétaires actuels des tuiles revendiquées
    const { rows } = await client.query(
      `SELECT tile_id, owner_id, passes, best_speed FROM tiles WHERE instance_id=$1 AND mode=$2 AND tile_id = ANY($3)`,
      [instanceId, mode, claimed]
    );
    const cur = new Map(rows.map((r) => [r.tile_id, r]));

    for (const k of claimed) {
      const isInterior = interior.has(k);
      const held = cur.get(k);
      const prevOwner = held?.owner_id || null;
      const myPasses = passes.get(k) || (isInterior ? 0 : 1);
      let kind;

      if (prevOwner && prevOwner !== player.id) {
        // tuile adverse : le vol dépend de l'arbitrage du mode
        if (!challengerWins(mode, { speed: runSpeed, passes: myPasses }, held)) { d.kept++; continue; }
        kind = "steal";
      } else if (prevOwner === player.id) {
        kind = "trail"; // déjà à moi : renforcement (passes/vitesse), pas de log
      } else {
        kind = isInterior ? "enclosed" : "trail";
      }

      const c = centerLatLng(k, origin, SIZE);
      await client.query(
        `INSERT INTO tiles (instance_id, tile_id, mode, owner_id, acquired_at, expires_at, passes, best_speed, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (instance_id, tile_id, mode) DO UPDATE SET
           owner_id = EXCLUDED.owner_id,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at,
           passes = tiles.passes + EXCLUDED.passes,
           best_speed = GREATEST(COALESCE(tiles.best_speed, 0), COALESCE(EXCLUDED.best_speed, 0))`,
        [instanceId, k, mode, player.id, now, expires, myPasses, runSpeed, c.lat, c.lng]
      );

      if (prevOwner !== player.id) {
        await client.query(
          `INSERT INTO captures_log (instance_id, tile_id, mode, player_id, prev_owner_id, kind) VALUES ($1,$2,$3,$4,$5,$6)`,
          [instanceId, k, mode, player.id, prevOwner, kind]
        );
        if (kind === "steal") d.steal++; else if (kind === "enclosed") d.enclosed++; else d.trail++;
        d.tiles.push({ tile: k, kind });
      }
    }

    const gained = d.trail + d.steal + d.enclosed;
    const score = gained * 10 + d.steal * 15 + d.enclosed * 5;
    const run = await client.query(
      `INSERT INTO runs (player_id, mode, season_id, distance_m, duration_s, elevation_gain_m, zones_gained, zones_stolen, zones_enclosed, score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [player.id, mode, seasonId, stats.distance, stats.duration, stats.gain, gained, d.steal, d.enclosed, score]
    );

    await client.query("COMMIT");

    // classement de saison (Redis sorted set)
    if (seasonId != null) await redis.zincrby(`lb:${seasonId}:${mode}`, score, player.id);

    return { runId: run.rows[0].id, mode, score, gained, ...d, distance_m: Math.round(stats.distance) };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
