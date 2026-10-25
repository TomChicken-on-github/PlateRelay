/*
 * Panel API client. The pages run on mock stores until built with VITE_API=http; then sign-in and the
 * pages wired so far (including audit) talk to apps/server. Errors from the server are {code, message, ...}.
 */
export const LIVE = import.meta.env.VITE_API === "http";

export type ApiErr = { code: string; message: string };
export type Res<T, E = ApiErr> = { ok: true; data: T } | { ok: false; error: E | { code: "network"; message: string } };

let onUnauthenticated = () => {};
/** Called when the server says the session is gone, so the app can send the user to sign in. */
export const setUnauthenticatedHandler = (f: () => void) => (onUnauthenticated = f);

/** `json` sends a JSON body; a FormData `body` goes as multipart. */
export async function api<T, E = ApiErr>(url: string, init?: RequestInit & { json?: unknown }): Promise<Res<T, E>> {
  const { json, ...rest } = init ?? {};
  try {
    const r = await fetch(url, {
      credentials: "include",
      ...rest,
      ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok) return { ok: true, data: body as T };
    if (body && typeof body.code === "string") {
      if (r.status === 401 && body.code === "unauthenticated") onUnauthenticated();
      return { ok: false, error: body as E };
    }
    return { ok: false, error: { code: "network", message: `服务器返回 ${r.status}` } };
  } catch {
    return { ok: false, error: { code: "network", message: "连不上面板服务器" } };
  }
}
