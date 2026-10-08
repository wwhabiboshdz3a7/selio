import pg from "pg";
import { objectToColumns, rowToObject } from "./mapping";

const { Pool } = pg;
export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

/** Dates renvoyées en objets Date (converties en ISO par rowToObject) ; int8 → number. */
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(connectionString: string, opts: { max?: number } = {}): PgPool {
  return new Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

export class DbError extends Error {
  constructor(public readonly code: "not_found" | "conflict" | "validation" | "internal", message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "DbError";
  }
}

/** Transaction scopée à une organisation : RLS activée via app.org_id. */
export class Tx {
  constructor(public readonly client: PgClient, public readonly orgId: string | null) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const res = await this.client.query(sql, params);
      return res.rows.map((r) => rowToObject<T>(r));
    } catch (err) {
      throw mapPgError(err);
    }
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = [], label = "Enregistrement"): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length === 0) throw new DbError("not_found", `${label} introuvable`);
    return rows[0]!;
  }
  async maybeOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
  async insert<T = Record<string, unknown>>(table: string, obj: Record<string, unknown>): Promise<T> {
    const { columns, values } = objectToColumns(obj);
    const placeholders = values.map((_, i) => `$${i + 1}`);
    return this.one<T>(`insert into ${table} (${columns.join(", ")}) values (${placeholders.join(", ")}) returning *`, values);
  }
  async update<T = Record<string, unknown>>(table: string, id: string, patch: Record<string, unknown>, label = "Enregistrement"): Promise<T> {
    const { columns, values } = objectToColumns({ ...patch, updatedAt: new Date().toISOString() });
    if (columns.length === 0) return this.one<T>(`select * from ${table} where id = $1`, [id], label);
    const sets = columns.map((c, i) => `${c} = $${i + 2}`);
    return this.one<T>(`update ${table} set ${sets.join(", ")} where id = $1 returning *`, [id, ...values], label);
  }
  async count(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await this.query<{ count: number }>(sql, params);
    return Number(rows[0]?.count ?? 0);
  }
}

function mapPgError(err: unknown): Error {
  const e = err as { code?: string; message?: string; detail?: string };
  if (e?.code === "23505") return new DbError("conflict", "Cet enregistrement existe déjà (contrainte d'unicité).", err);
  if (e?.code === "23503") return new DbError("conflict", "Référence invalide ou enregistrement encore utilisé.", err);
  if (e?.code === "23514" || e?.code === "22P02") return new DbError("validation", "Valeur invalide pour la base de données.", err);
  if (e?.code === "42501") return new DbError("internal", "Accès refusé par les politiques de sécurité de la base.", err);
  return err instanceof Error ? err : new Error(String(err));
}

export class Db {
  constructor(public readonly pool: PgPool) {}

  /** Transaction isolée à une organisation (RLS). */
  async withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const result = await fn(new Tx(client, orgId));
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  /** Transaction globale (tables sans org : users, sessions, organizations, memberships…). */
  async withGlobal<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(new Tx(client, null));
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.pool.query("select 1");
    return Date.now() - started;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
