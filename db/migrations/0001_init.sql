-- ======================================================================
-- Runner Arena — schéma initial (PostgreSQL, compatible Neon)
-- Modèle : joueurs, saisons/ligues, modes de carte, tuiles (propriété +
-- TTL 15 j), historique de captures, courses, badges (collection), partenaires.
-- Appliquer : psql "$DATABASE_URL" -f db/migrations/0001_init.sql
-- ======================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---- Joueurs ---------------------------------------------------------
CREATE TABLE players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  color         TEXT,                       -- couleur d'équipe (hex)
  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  referral_code TEXT UNIQUE,                 -- parrainage / viral
  referred_by   UUID REFERENCES players(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Saisons / ligues (cycles ~14 j) --------------------------------
CREATE TABLE seasons (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT true
);

-- ---- Modes de carte (critère d'arbitrage des zones disputées) --------
CREATE TABLE map_modes (
  key     TEXT PRIMARY KEY,                  -- 'blitz' | 'endurance' | 'handicap'
  label   TEXT NOT NULL,
  arbiter TEXT NOT NULL                      -- 'speed' | 'passes' | 'handicap'
);
INSERT INTO map_modes (key, label, arbiter) VALUES
  ('blitz',     'Blitz',     'speed'),
  ('endurance', 'Endurance', 'passes'),
  ('handicap',  'Handicap',  'handicap');

-- ---- Partenaires (zones sponsorisées, récompenses, skins) ------------
CREATE TABLE partners (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL,                     -- 'sponsored_zone' | 'reward' | 'skin'
  lat     DOUBLE PRECISION,
  lng     DOUBLE PRECISION,
  reward  TEXT,
  active  BOOLEAN NOT NULL DEFAULT true
);

-- ---- Tuiles : 1 ligne par tuile possédée/disputée, par (instance, mode)
-- instance_id = shard/arène géographique ; tile_id = "q,r".
CREATE TABLE tiles (
  instance_id TEXT NOT NULL,
  tile_id     TEXT NOT NULL,
  mode        TEXT NOT NULL REFERENCES map_modes(key),
  owner_id    UUID REFERENCES players(id),
  acquired_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,                   -- acquired_at + 15 j (remise en jeu)
  passes      INTEGER NOT NULL DEFAULT 0,
  best_speed  REAL,                          -- m/s (arbitrage Blitz)
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  PRIMARY KEY (instance_id, tile_id, mode)
);
CREATE INDEX idx_tiles_owner   ON tiles(owner_id);
CREATE INDEX idx_tiles_expires ON tiles(expires_at);  -- job TTL : SELECT ... WHERE expires_at < now()
CREATE INDEX idx_tiles_mode    ON tiles(mode);

-- ---- Courses soumises ------------------------------------------------
CREATE TABLE runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id),
  mode             TEXT NOT NULL REFERENCES map_modes(key),
  season_id        INTEGER REFERENCES seasons(id),
  distance_m       REAL,
  duration_s       REAL,
  elevation_gain_m REAL,
  zones_gained     INTEGER NOT NULL DEFAULT 0,
  zones_stolen     INTEGER NOT NULL DEFAULT 0,
  zones_enclosed   INTEGER NOT NULL DEFAULT 0,
  score            INTEGER NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_runs_player ON runs(player_id, submitted_at DESC);
CREATE INDEX idx_runs_season ON runs(season_id, mode);

-- ---- Historique des prises / pertes ---------------------------------
CREATE TABLE captures_log (
  id            BIGSERIAL PRIMARY KEY,
  instance_id   TEXT NOT NULL,
  tile_id       TEXT NOT NULL,
  mode          TEXT NOT NULL,
  player_id     UUID REFERENCES players(id),
  prev_owner_id UUID REFERENCES players(id),
  kind          TEXT NOT NULL,               -- 'trail' | 'enclosed' | 'steal' | 'expire'
  run_id        UUID REFERENCES runs(id),
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_captures_player ON captures_log(player_id, at DESC);
CREATE INDEX idx_captures_tile   ON captures_log(instance_id, tile_id, mode, at DESC);

-- ---- Badges (collection & découverte : POI, quartiers, jalons) -------
CREATE TABLE badges (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                  -- 'poi' | 'district' | 'milestone'
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  partner_id INTEGER REFERENCES partners(id) -- badge sponsorisé (optionnel)
);
CREATE TABLE player_badges (
  player_id UUID NOT NULL REFERENCES players(id),
  badge_id  INTEGER NOT NULL REFERENCES badges(id),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, badge_id)
);

-- ---- Saison de démarrage (14 jours) ----------------------------------
INSERT INTO seasons (name, starts_at, ends_at)
VALUES ('Saison 1', now(), now() + INTERVAL '14 days');
