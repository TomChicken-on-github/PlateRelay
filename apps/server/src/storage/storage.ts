import type { Readable } from "node:stream";

/**
 * Object storage, kept thin on purpose (brief §0.5): only what the panel
 * uses. Keys are "/"-separated paths under a prefix per kind of file:
 * uploads/, plates/, store-photos/, avatars/. The S3-compatible backend
 * (Aliyun OSS, MinIO…) implements this same interface later.
 */
export interface ObjectStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  /** Short-lived link a browser can open. Permission checks happen before calling this. */
  signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string>;
}

export const STORAGE = Symbol("STORAGE");

const KEY = /^[a-z0-9-]+(\/[A-Za-z0-9._-]+)+$/;

/** Rejects keys that could escape the storage root or that the S3 backend would treat differently. */
export function assertKey(key: string): void {
  if (!KEY.test(key) || key.split("/").some((p) => p === "." || p === "..")) throw new Error(`bad storage key: ${key}`);
}
