import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./migration";
export interface DB {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
type Connection = Pool | PGlite;
const globalDB = globalThis as typeof globalThis & {
  hrConnection?: Connection;
  hrReady?: Promise<void>;
};
export async function connection(): Promise<Connection> {
  if (!globalDB.hrConnection) {
    if (process.env.DATABASE_URL)
      globalDB.hrConnection = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 10000,
      });
    else {
      if (process.env.VERCEL || process.env.NODE_ENV === "production")
        throw new Error(
          "DATABASE_URL is required in production. Local disk is not a production database.",
        );
      globalDB.hrConnection = new PGlite(
        process.env.HRMS_DATA_DIR || ".data/hrms",
      );
    }
  }
  const conn = globalDB.hrConnection;
  if (!globalDB.hrReady)
    globalDB.hrReady = (async () => {
      if (conn instanceof Pool) {
        const client = await conn.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(7498213)");
          await client.query(migration);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } else await conn.exec(migration);
    })().catch((e) => {
      globalDB.hrReady = undefined;
      throw e;
    });
  await globalDB.hrReady;
  return conn;
}
export const db: DB = {
  async query<T>(sql: string, params: unknown[] = []) {
    const conn = await connection();
    const result =
      conn instanceof Pool
        ? await conn.query(sql, params)
        : await conn.query(sql, params);
    return { rows: result.rows as T[] };
  },
};
export async function transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
  const conn = await connection();
  if (conn instanceof Pool) {
    const client = await conn.connect();
    try {
      await client.query("BEGIN");
      const result = await fn({
        query: async <R>(sql: string, params: unknown[] = []) => ({
          rows: (await client.query(sql, params)).rows as R[],
        }),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return conn.transaction(async (tx) =>
    fn({
      query: async <R>(sql: string, params: unknown[] = []) => ({
        rows: (await tx.query(sql, params)).rows as R[],
      }),
    }),
  );
}
