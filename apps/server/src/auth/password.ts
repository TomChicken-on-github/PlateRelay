import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/* scrypt from node:crypto: no native addon to build on Windows. */
const N = 16384, R = 8, P = 1, LEN = 32;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, fail) => scrypt(password.normalize("NFKC"), salt, LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}
