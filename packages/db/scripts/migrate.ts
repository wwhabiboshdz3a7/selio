import { createPool } from "../src/pool";
import { MIGRATIONS_DIR, runMigrations } from "../src/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante (ex. postgres://selio:selio@127.0.0.1:5432/selio)");
  process.exit(1);
}
const pool = createPool(url, { max: 2 });
runMigrations(pool, MIGRATIONS_DIR, { appPassword: process.env.APP_DB_PASSWORD, log: (m) => console.info(m) })
  .then((applied) => {
    console.info(applied.length ? `${applied.length} migration(s) appliquée(s).` : "Base à jour.");
    return pool.end();
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
