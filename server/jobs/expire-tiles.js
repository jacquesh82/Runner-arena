/* Job TTL : remet en jeu les tuiles expirées (owner → neutre) et journalise.
 * À planifier (cron applicatif ou Upstash QStash) :  node jobs/expire-tiles.js */

import { pool } from "../db.js";

export async function expireTiles() {
  const { rows } = await pool.query(
    `WITH expired AS (
       SELECT instance_id, tile_id, mode, owner_id AS prev
       FROM tiles WHERE expires_at IS NOT NULL AND expires_at < now()
     ), upd AS (
       UPDATE tiles t SET owner_id = NULL, acquired_at = NULL, expires_at = NULL
       FROM expired e
       WHERE t.instance_id = e.instance_id AND t.tile_id = e.tile_id AND t.mode = e.mode
       RETURNING e.instance_id, e.tile_id, e.mode, e.prev
     )
     INSERT INTO captures_log (instance_id, tile_id, mode, player_id, prev_owner_id, kind)
     SELECT instance_id, tile_id, mode, NULL, prev, 'expire' FROM upd
     RETURNING tile_id`
  );
  return rows.length; // nombre de tuiles remises en jeu
}

// Exécution directe en CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  expireTiles()
    .then((n) => { console.log(`${n} tuile(s) remise(s) en jeu.`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
