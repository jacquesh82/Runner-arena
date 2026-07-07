import pg from "pg";

const { Pool } = pg;

// Neon exige SSL. PGSSL=disable pour un Postgres local sans TLS.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
});

export const q = (text, params) => pool.query(text, params);
