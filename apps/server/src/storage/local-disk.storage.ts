import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";
import { assertKey, type ObjectStorage } from "./storage.js";

/**
 * Stores objects as files under a root directory. Signed links point at the
 * panel's own /api/files route, which checks the HMAC and expiry.
 */
export class LocalDiskStorage implements ObjectStorage {
  constructor(
    private readonly root: string,
    private readonly secret: Buffer,
    /** Path prefix of the download route, e.g. "/api/files". */
    private readonly routePrefix: string,
  ) {}

  private path(key: string) {
    assertKey(key);
    return join(this.root, ...key.split("/"));
  }

  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
  }

  async get(key: string): Promise<Readable> {
    const p = this.path(key);
    await access(p);
    return createReadStream(p);
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string) {
    try {
      await access(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string) {
    const base = join(this.root, ...prefix.split("/").filter(Boolean));
    try {
      const entries = await readdir(base, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith(".tmp"))
        .map((e) => relative(this.root, join(e.parentPath, e.name)).split(sep).join("/"))
        .sort();
    } catch {
      return [];
    }
  }

  private sign(key: string, exp: number, name: string) {
    return createHmac("sha256", this.secret).update(`file\n${key}\n${exp}\n${name}`).digest("base64url");
  }

  async signedUrl(key: string, ttlSeconds: number, downloadName = "") {
    assertKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const q = new URLSearchParams({ k: key, e: String(exp), s: this.sign(key, exp, downloadName) });
    if (downloadName) q.set("n", downloadName);
    return `${this.routePrefix}?${q}`;
  }

  /** For the download route: true when the link is genuine and not expired. */
  verify(key: string, exp: number, sig: string, downloadName = ""): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const want = Buffer.from(this.sign(key, exp, downloadName));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
