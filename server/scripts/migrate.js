/* Applique les migrations SQL de db/migrations dans l'ordre.  node scripts/migrate.js */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const dir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

async function run() {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    process.stdout.write(`→ ${f} … `);
    await pool.query(readFileSync(dir + f, "utf8"));
    console.log("ok");
  }
  await pool.end();
  console.log(`${files.length} migration(s) appliquée(s).`);
}

run().catch((e) => { console.error(e); process.exit(1); });
