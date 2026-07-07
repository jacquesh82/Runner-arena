-- ======================================================================
-- Runner Arena — état persistant PAR TUILE + top 10 par tuile.
-- Chaque tuile a un id global stable "{instance}:{q,r}" (q,r relatifs à
-- l'origine fixe de l'instance). Owner + attributs vivent dans `tiles` ;
-- le classement par tuile (top 10) est adossé à `tile_holders` (durable)
-- et à un sorted set Redis `t:{instance}:{mode}:{q,r}` (rapide).
-- Appliquer : psql "$DATABASE_URL" -f db/migrations/0002_tile_state.sql
-- ======================================================================

-- ---- Instances / arènes : origine + taille hex (config des ids) ------
CREATE TABLE IF NOT EXISTS instances (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  origin_lat DOUBLE PRECISION NOT NULL,
  origin_lng DOUBLE PRECISION NOT NULL,
  hex_size   REAL NOT NULL DEFAULT 55
);
INSERT INTO instances (id, name, origin_lat, origin_lng, hex_size)
VALUES ('paris', 'Paris', 48.8566, 2.3522, 55)
ON CONFLICT (id) DO NOTHING;

-- ---- Attributs additionnels par tuile --------------------------------
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS capture_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS contest_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS first_owned_at TIMESTAMPTZ;

-- ---- Détenteurs par tuile (durable) : back le « top 10 » -------------
-- 1 ligne par (tuile, mode, joueur) : passages, captures, points cumulés.
CREATE TABLE IF NOT EXISTS tile_holders (
  instance_id TEXT NOT NULL,
  tile_id     TEXT NOT NULL,
  mode        TEXT NOT NULL,
  player_id   UUID NOT NULL REFERENCES players(id),
  passes      INTEGER NOT NULL DEFAULT 0,
  captures    INTEGER NOT NULL DEFAULT 0,
  points      INTEGER NOT NULL DEFAULT 0,
  best_speed  REAL,
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, tile_id, mode, player_id)
);
-- top 10 d'une tuile : ORDER BY points DESC LIMIT 10
CREATE INDEX IF NOT EXISTS idx_tile_holders_top
  ON tile_holders(instance_id, tile_id, mode, points DESC);
CREATE INDEX IF NOT EXISTS idx_tile_holders_player
  ON tile_holders(player_id, last_at DESC);
