import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import type { S3Config } from "../storage/s3.storage.js";

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
  /** Object storage: local disk under dataDir, or an S3-compatible service such as Aliyun OSS. */
  storage: { kind: "local" } | ({ kind: "s3" } & S3Config);
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
    storage: storageConfig(env),
  };
}

/**
 * PLATERELAY_STORAGE=oss (or s3) switches to the S3-compatible backend,
 * configured by OSS_* variables. Anything else, or unset, is local disk.
 * Credentials only ever come from the environment.
 */
function storageConfig(env: NodeJS.ProcessEnv): AppConfig["storage"] {
  const kind = env.PLATERELAY_STORAGE ?? "local";
  if (kind === "local") return { kind: "local" };
  if (kind !== "oss" && kind !== "s3") throw new Error(`PLATERELAY_STORAGE must be local, oss or s3, not ${kind}`);
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`PLATERELAY_STORAGE=${kind} needs ${k}`);
    return v;
  };
  const endpoint = need("OSS_ENDPOINT");
  return {
    kind: "s3",
    endpoint,
    publicEndpoint: env.OSS_PUBLIC_ENDPOINT || null,
    /* Aliyun signs with the endpoint's first label, e.g. oss-cn-beijing */
    region: env.OSS_REGION || new URL(endpoint).hostname.split(".")[0],
    bucket: need("OSS_BUCKET"),
    accessKeyId: need("OSS_ACCESS_KEY_ID"),
    secretAccessKey: need("OSS_ACCESS_KEY_SECRET"),
    forcePathStyle: env.OSS_PATH_STYLE === "1",
  };
}
