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

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Runner Arena API — http://localhost:${port}`));
