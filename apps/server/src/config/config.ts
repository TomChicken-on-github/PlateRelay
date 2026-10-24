import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";

/**
 * Settings come from the environment only. Secrets (database password,
 * signing secret) go in env vars, never in a file in the repo.
 */
export interface AppConfig {
  /** postgres:// URL. Unset: an embedded PGlite database under dataDir (development only). */
  databaseUrl: string | null;
  /** Local disk storage root and embedded database live here. */
  dataDir: string;
  /** HMAC key for signed file links and pickup codes. */
  secret: Buffer;
  /** Mark cookies Secure (set behind HTTPS). */
  secureCookies: boolean;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let secret: Buffer;
  if (env.PLATERELAY_SECRET) secret = Buffer.from(env.PLATERELAY_SECRET, "utf8");
  else {
    new Logger("Config").warn("PLATERELAY_SECRET is not set: using a random one, signed links stop working after a restart");
    secret = randomBytes(32);
  }
  return {
    databaseUrl: env.DATABASE_URL || null,
    dataDir: resolve(env.PLATERELAY_DATA_DIR || "var"),
    secret,
    secureCookies: env.PLATERELAY_SECURE_COOKIES === "1",
  };
}
