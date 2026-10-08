import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PgPool } from "./pool";

/** Exécute les migrations SQL (ordre lexical) non encore appliquées. Idempotent. */
export async function runMigrations(pool: PgPool, dir: string, opts: { appPassword?: string; log?: (m: string) => void } = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("select pg_advisory_lock(727001)");
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r: { name: string }) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [f]);
        await client.query("commit");
        applied.push(f);
        log(`migration appliquée : ${f}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Échec de la migration ${f} : ${(err as Error).message}`);
      }
    }
    if (opts.appPassword) {
      await client.query(`alter role selio_app with password '${opts.appPassword.replace(/'/g, "''")}'`);
      log("mot de passe du rôle applicatif mis à jour");
    }
    await client.query("select pg_advisory_unlock(727001)");
  } finally {
    client.release();
  }
  return applied;
}

export const MIGRATIONS_DIR = new URL("../migrations", import.meta.url).pathname;
