import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type Schema = typeof schema;
/** Either driver: node-postgres in production, PGlite for development and tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export const DB = Symbol("DB");

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

const MIGRATIONS = join(__dirname, "../../../drizzle");

/**
 * Opens the database and applies pending migrations.
 * url: postgres:// for a real server; "memory" or a directory path for PGlite.
 */
export async function openDb(url: string): Promise<DbHandle> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (url !== "memory") new Logger("Db").warn(`DATABASE_URL is not set: using the embedded development database in ${url}`);
  if (url !== "memory") await mkdir(url, { recursive: true });
  const client = url === "memory" ? new PGlite() : new PGlite(url);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}
