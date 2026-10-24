import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** Opaque random token, base64url. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
