import { LIVE, api } from "./api";
import { liveCode, pickupCodes, pickupOrders, redeemed } from "../mock/pickup";
import { ME as SESSION } from "../mock/session";

/*
 * Pickup API, as agreed with the backend order module. One code per order, valid for 10 minutes, so a
 * screenshot handed to someone else goes stale (user decision, 2026-10-24):
 *   POST /api/orders/:id/pickup-code     owner only, STORED_READY_PICKUP -> {code, expiresAt}; supersedes the old code
 *   GET  /api/pickup/:code               look up, no state change (order:redeem, Staff+)
 *   POST /api/pickup/:code/redeem        STORED_READY_PICKUP -> COMPLETED, audit logged, re-checks expiry
 *   GET  /api/pickup/redemptions?since=  redemptions since an ISO time
 * Errors are {code, message, ...}. Codes are PR1-XXXX-XXXX: 8 chars from CODE_CHARS, which leaves out
 * 0/O/1/I/L so nothing on screen can be misread (user decision, 2026-10-25); case-insensitive.
 * The QR payload is the full "PR1-XXXX-XXXX", people type the XXXX-XXXX part.
 *
 * Pages talk to `pickupApi`: the mock store, or the real endpoints when built with VITE_API=http.
 */

export type PickupOrder = {
  orderId: number;
  fileName: string;
  plateIndex: number;
  printerModel: string;
  weightG: number;
  filaments: { color: string; type: string }[];
  owner: { name: string; role: string };
  slot: string;
  storedAt: string;
  thumbUrl: string | null;
};

export type PickupError =
  | { code: "pickup-code-invalid"; message?: string }
  | { code: "pickup-already-redeemed"; message?: string; orderId: number; owner: { name: string }; redeemedAt: string; redeemedBy: { name: string } }
  | { code: "pickup-code-expired"; message?: string; orderId: number; expiresAt: string }
  | { code: "order-not-ready"; message?: string; orderId: number; status: string }
  | { code: "network"; message: string };

export type Issued = { code: string; expiresAt: string };
export type Redeemed = { orderId: number; redeemedAt: string; redeemedBy: { name: string } };
export type Redemption = { orderId: number; fileName: string; owner: { name: string }; redeemedAt: string };
export type Res<T> = { ok: true; data: T } | { ok: false; error: PickupError };

export interface PickupApi {
  issue(orderId: number): Promise<Res<Issued>>;
  lookup(code: string): Promise<Res<PickupOrder>>;
  redeem(code: string): Promise<Res<Redeemed>>;
  redemptions(since: string): Promise<Redemption[]>;
}

export const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Bare 8-char code: uppercase, drop non-alphanumerics and a "PR1" prefix (a code itself never holds a 1). */
export function bareCode(s: string) {
  let v = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (v.length > 8 && v.startsWith("PR1")) v = v.slice(3);
  return v.slice(0, 8);
}

/** True when the input holds a character no code has (0, O, 1, I, L). */
export const hasForeignChars = (s: string) => /[01OIL]/.test(bareCode(s));

/** What people type and read: "XXXX-XXXX" (partial input keeps its dash once past four characters). */
export function showCode(s: string) {
  const v = bareCode(s);
  return v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v;
}

/** The QR payload. */
export const qrPayload = (code: string) => `PR1-${showCode(code)}`;

/** A scanned QR is a pickup code only if it is exactly "PR1-XXXX-XXXX" (dashes optional). */
export function codeFromScan(text: string) {
  const t = text.trim().toUpperCase().replace(/-/g, "");
  return /^PR1[2-9A-HJKMNP-Z]{8}$/.test(t) ? bareCode(t) : null;
}

const call = <T>(url: string, init?: { method: string }) => api<T, PickupError>(url, init) as Promise<Res<T>>;

const httpApi: PickupApi = {
  issue: (id) => call(`/api/orders/${id}/pickup-code`, { method: "POST" }),
  lookup: (c) => call(`/api/pickup/${encodeURIComponent(qrPayload(c))}`),
  redeem: (c) => call(`/api/pickup/${encodeURIComponent(qrPayload(c))}/redeem`, { method: "POST" }),
  redemptions: async (since) => {
    const r = await call<Redemption[]>(`/api/pickup/redemptions?since=${encodeURIComponent(since)}`);
    return r.ok ? r.data : [];
  },
};

const ME = SESSION.name;
const TTL = 10 * 60e3;

const mockApi: PickupApi = {
  async issue(orderId) {
    const o = pickupOrders.get()[orderId];
    if (!o) return { ok: false, error: { code: "network", message: "没有这个订单" } };
    if (o.status !== "STORED_READY_PICKUP") return { ok: false, error: { code: "order-not-ready", orderId, status: o.status } };
    let code = "";
    /* bytes 248-255 are dropped so every character is equally likely */
    while (code.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(8))) if (b < 248 && code.length < 8) code += CODE_CHARS[b % 31];
    const expiresAt = new Date(Date.now() + TTL).toISOString();
    pickupCodes.set((s) => ({ ...s, [code]: { orderId, expiresAt } }));
    liveCode.set((s) => ({ ...s, [orderId]: code }));
    return { ok: true, data: { code: `PR1-${showCode(code)}`, expiresAt } };
  },
  /* Same precedence as the server: redeemed, superseded, expired, not stocked in. */
  async lookup(c) {
    const code = bareCode(c);
    const k = pickupCodes.get()[code];
    const o = k && pickupOrders.get()[k.orderId];
    if (!k || !o) return { ok: false, error: { code: "pickup-code-invalid" } };
    if (o.redeemed) return { ok: false, error: { code: "pickup-already-redeemed", orderId: k.orderId, owner: { name: o.order.owner.name }, redeemedAt: o.redeemed.at, redeemedBy: { name: o.redeemed.by } } };
    if (liveCode.get()[k.orderId] !== code) return { ok: false, error: { code: "pickup-code-invalid" } };
    if (Date.parse(k.expiresAt) <= Date.now()) return { ok: false, error: { code: "pickup-code-expired", orderId: k.orderId, expiresAt: k.expiresAt } };
    if (o.status !== "STORED_READY_PICKUP") return { ok: false, error: { code: "order-not-ready", orderId: k.orderId, status: o.status } };
    return { ok: true, data: o.order };
  },
  async redeem(c) {
    const r = await mockApi.lookup(c);
    if (!r.ok) return r;
    const o = r.data;
    const at = new Date().toISOString();
    pickupOrders.set((s) => ({ ...s, [o.orderId]: { ...s[o.orderId], status: "COMPLETED", redeemed: { at, by: ME } } }));
    redeemed.set((s) => [{ orderId: o.orderId, fileName: o.fileName, owner: { name: o.owner.name }, redeemedAt: at }, ...s]);
    return { ok: true, data: { orderId: o.orderId, redeemedAt: at, redeemedBy: { name: ME } } };
  },
  /* mock rows count as today's whatever the clock says */
  async redemptions() {
    return redeemed.get();
  },
};

export const pickupApi: PickupApi = LIVE ? httpApi : mockApi;
