import { mkdir, rename } from "node:fs/promises";
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
    /*
     * An embedded database left broken by an unclean shutdown makes PGlite's WASM abort ("Aborted()").
     * Only that is handled, and the old directory is kept aside, never deleted: an ordinary SQL error
     * such as "current transaction is aborted" during a migration must not cost the data.
     */
    if (url === "memory" || !isWasmAbort(err)) throw err;
    const aside = `${url}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    logger.error(`Embedded development database at ${url} cannot be opened (WASM abort). Moved it to ${aside} and starting an empty one.`);
    await rename(url, aside);
    await mkdir(url, { recursive: true });
    return await init(url);
  }
}

/** PGlite's WASM runtime aborting, as opposed to an error raised by PostgreSQL itself. */
function isWasmAbort(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if ((e instanceof WebAssembly.RuntimeError || e.name === "RuntimeError") && /^Aborted\(/.test(e.message)) return true;
  }
  return false;
}
