import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  if (url === "memory") {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, close: () => client.close() };
  }
  await mkdir(url, { recursive: true });
  const unlock = await lockDataDir(url);
  try {
    const client = new PGlite(url);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return {
      db: db as unknown as Db,
      close: async () => {
        await client.close();
        await unlock();
      },
    };
  } catch (e) {
    await unlock();
    throw e;
  }
}

/**
 * PGlite is single-process: a second process opening the same directory
 * corrupts it or aborts inside wasm. Refuse with a clear message instead.
 */
async function lockDataDir(dir: string): Promise<() => Promise<void>> {
  const lock = `${dir}.lock`;
  for (;;) {
    try {
      await writeFile(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = Number.parseInt(await readFile(lock, "utf8").catch(() => ""), 10);
    if (holder && isAlive(holder)) {
      throw new Error(
        `The embedded database ${dir} is in use by process ${holder}. ` +
          "Stop the other server or CLI first, or set DATABASE_URL / PLATERELAY_DATA_DIR.",
      );
    }
    // Left by a process that was killed before it could close the database.
    await rm(lock, { force: true });
  }
  return () => rm(lock, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
