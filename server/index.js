/* API Runner Arena — soumission de course, classements, lecture de tuiles.
 * Démarrage : node index.js  (nécessite DATABASE_URL + UPSTASH_REDIS_REST_*). */

import express from "express";
import { applyRun } from "./capture.js";
import { pool } from "./db.js";
import { redis } from "./redis.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

async function currentSeason() {
  const { rows } = await pool.query(
    `SELECT id FROM seasons WHERE active AND now() BETWEEN starts_at AND ends_at ORDER BY id DESC LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

/* Soumettre une course : le serveur applique les captures selon le mode. */
app.post("/runs", async (req, res) => {
  try {
    const { instanceId = "paris", origin = [48.8566, 2.3522], mode = "endurance", track, player } = req.body || {};
    if (!player?.id || !Array.isArray(track) || track.length < 2) {
      return res.status(400).json({ error: "player.id et un track d'au moins 2 points sont requis" });
    }
    const seasonId = req.body.seasonId ?? (await currentSeason());
    const result = await applyRun({ instanceId, origin, player, mode, seasonId, track });
    res.json(result);
  } catch (e) {
    console.error("[/runs]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* Classement d'un mode pour la saison courante (ou ?season=). */
app.get("/leaderboard", async (req, res) => {
  try {
    const mode = req.query.mode || "endurance";
    const season = req.query.season ?? (await currentSeason());
    if (season == null) return res.json({ season: null, mode, top: [] });
    const top = await redis.zrange(`lb:${season}:${mode}`, 0, 19, { rev: true, withScores: true });
    res.json({ season, mode, top });
  } catch (e) {
    console.error("[/leaderboard]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* Tuiles possédées dans une bbox (pour dessiner la carte). bbox=minLng,minLat,maxLng,maxLat */
app.get("/tiles", async (req, res) => {
  try {
    const mode = req.query.mode || "endurance";
    const [w, s, e, n] = String(req.query.bbox || "").split(",").map(Number);
    if ([w, s, e, n].some((v) => !isFinite(v))) return res.status(400).json({ error: "bbox=minLng,minLat,maxLng,maxLat requis" });
    const { rows } = await pool.query(
      `SELECT tile_id, owner_id, expires_at FROM tiles
       WHERE mode=$1 AND owner_id IS NOT NULL AND lng BETWEEN $2 AND $3 AND lat BETWEEN $4 AND $5`,
      [mode, w, e, s, n]
    );
    res.json({ mode, tiles: rows });
  } catch (e) {
    console.error("[/tiles]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* État complet d'une tuile : owner + attributs + top 10. id = "{instance}:{q,r}" */
app.get("/tiles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const mode = req.query.mode || "endurance";
    const i = id.indexOf(":");
    if (i < 0) return res.status(400).json({ error: "id de tuile invalide (attendu instance:q,r)" });
    const instanceId = id.slice(0, i), tileKey = id.slice(i + 1);

    const { rows } = await pool.query(
      `SELECT t.owner_id, p.display_name AS owner_name, t.passes, t.best_speed, t.capture_count,
              t.acquired_at, t.expires_at, t.lat, t.lng
       FROM tiles t LEFT JOIN players p ON p.id = t.owner_id
       WHERE t.instance_id=$1 AND t.tile_id=$2 AND t.mode=$3`,
      [instanceId, tileKey, mode]
    );
    const tile = rows[0] || null;

    // Top 10 : Redis (rapide) puis repli Postgres (durable).
    let top10 = [];
    try {
      const z = await redis.zrange(`t:${instanceId}:${mode}:${tileKey}`, 0, 9, { rev: true, withScores: true });
      const ids = [], score = {};
      for (let k = 0; k < z.length; k += 2) { ids.push(z[k]); score[z[k]] = Number(z[k + 1]); }
      if (ids.length) {
        const pr = await pool.query(`SELECT id, display_name FROM players WHERE id = ANY($1)`, [ids]);
        const nameById = new Map(pr.rows.map((r) => [r.id, r.display_name]));
        top10 = ids.map((pid) => ({ player: nameById.get(pid) || pid, points: score[pid] }));
      }
    } catch (_) { /* Redis indispo → repli */ }
    if (!top10.length) {
      const hr = await pool.query(
        `SELECT h.points, h.passes, p.display_name FROM tile_holders h JOIN players p ON p.id=h.player_id
         WHERE h.instance_id=$1 AND h.tile_id=$2 AND h.mode=$3 ORDER BY h.points DESC LIMIT 10`,
        [instanceId, tileKey, mode]
      );
      top10 = hr.rows.map((r) => ({ player: r.display_name, points: r.points, passes: r.passes }));
    }

    res.json({
      id, instance: instanceId, tile: tileKey, mode,
      owner: tile?.owner_id ? { id: tile.owner_id, name: tile.owner_name } : null,
      attributes: tile
        ? { passes: tile.passes, best_speed: tile.best_speed, capture_count: tile.capture_count, acquired_at: tile.acquired_at, expires_at: tile.expires_at, lat: tile.lat, lng: tile.lng }
        : {},
      top10,
    });
  } catch (e) {
    console.error("[/tiles/:id]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Runner Arena API — http://localhost:${port}`));
