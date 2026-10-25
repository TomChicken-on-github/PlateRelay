import { mkdir, rm } from "node:fs/promises";
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
  const logger = new Logger("Db");
  if (url !== "memory") logger.warn(`DATABASE_URL is not set: using the embedded development database in ${url}`);
  if (url !== "memory") await mkdir(url, { recursive: true });

  const init = async (targetPath: string) => {
    const client = targetPath === "memory" ? new PGlite() : new PGlite(targetPath);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, close: () => client.close() };
  };

  try {
    return await init(url);
  } catch (err) {
    // If an embedded disk database was corrupted by an unclean shutdown or killed process (WAL panic abort), recreate it cleanly.
    const isWasmAbort = err instanceof Error && (/aborted/i.test(err.message) || (err.cause instanceof Error && /aborted/i.test(err.cause.message)));
    if (url === "memory" || !isWasmAbort) throw err;

    logger.error(`Embedded development database at ${url} was corrupted by an unclean shutdown. Resetting...`);
    await rm(url, { recursive: true, force: true });
    await mkdir(url, { recursive: true });
    return await init(url);
  }
}
