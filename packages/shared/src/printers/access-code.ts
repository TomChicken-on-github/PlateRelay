/*
 * Printer access codes (brief §0.9 #10). The panel never sees one in the clear:
 *
 * 1. Each daemon makes an RSA key pair, keeps the private key on its own computer and reports the
 *    public key (SPKI DER, base64) to the panel.
 * 2. When someone adds or edits a printer, the browser encrypts the code with that daemon's public key
 *    (RSA-OAEP with SHA-256) and sends only the ciphertext and the key id.
 * 3. The panel stores the ciphertext and hands it to the daemon when the daemon is online. The daemon
 *    decrypts it, checks the serial and uses the code to reach the printer on the LAN.
 *
 * The field is write-only: no response carries the ciphertext back to a browser. A daemon that
 * reinstalls makes a new key, and every code stored for it has to be entered again.
 */

export const ACCESS_CODE_ALGORITHM = { name: "RSA-OAEP", hash: "SHA-256" } as const;
/** Daemons make 3072-bit keys; the panel refuses keys under 2048 bits. */
export const ACCESS_CODE_KEY_BITS = 3072;
export const ACCESS_CODE_MIN_KEY_BITS = 2048;

/**
 * What is encrypted: UTF-8 JSON of this object. The serial ties the code to one printer, so a
 * ciphertext copied onto another printer row is refused by the daemon.
 */
export interface AccessCodePlaintext {
  v: 1;
  serial: string;
  code: string;
}

/** Sent in POST/PATCH /api/printers as `accessCode`. */
export interface EncryptedAccessCode {
  keyId: string;
  /** base64 RSA-OAEP ciphertext, as long as the key's modulus. */
  ciphertext: string;
}

/** GET /api/daemon-keys: daemons a printer can be put under, and the key to encrypt its code with. */
export interface DaemonKeyView {
  id: string;
  name: string;
  network: string | null;
  /** null until the daemon has connected and reported its key. */
  keyId: string | null;
  publicKey: string | null;
}

/** On PrinterView for people with printer:manage. Never includes the ciphertext. */
export interface AccessCodeState {
  setAt: string;
  /** The daemon has picked it up. */
  delivered: boolean;
  /** Encrypted with the daemon's current key; false after the daemon made a new one. */
  current: boolean;
}

/** One entry the daemon receives for its printers. */
export interface DaemonAccessCode {
  printerId: string;
  serial: string;
  ip: string;
  keyId: string;
  ciphertext: string;
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** keyId: the first 16 hex characters of SHA-256 over the SPKI DER bytes. */
export async function accessCodeKeyId(publicKeyB64: string): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const h = new Uint8Array(await subtle.digest("SHA-256", unb64(publicKeyB64)));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Browser side (Web Crypto; needs HTTPS or localhost). */
export async function encryptAccessCode(
  key: { keyId: string; publicKey: string },
  serial: string,
  code: string,
): Promise<EncryptedAccessCode> {
  const subtle = globalThis.crypto.subtle;
  const pub = await subtle.importKey("spki", unb64(key.publicKey), ACCESS_CODE_ALGORITHM, false, ["encrypt"]);
  const plain: AccessCodePlaintext = { v: 1, serial, code };
  const ct = await subtle.encrypt({ name: "RSA-OAEP" }, pub, new TextEncoder().encode(JSON.stringify(plain)));
  return { keyId: key.keyId, ciphertext: b64(new Uint8Array(ct)) };
}
