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

/**
 * Multipart upload with byte progress (R-SUB-14). fetch cannot report upload progress, so this one call
 * uses XHR; responses and errors are handled the same way as `api`.
 */
export function upload<T, E = ApiErr>(url: string, body: FormData, onProgress: (sent: number, total: number) => void): Promise<Res<T, E>> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.withCredentials = true;
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    x.onerror = () => resolve({ ok: false, error: { code: "network", message: "连不上面板服务器" } });
    x.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* not JSON */
      }
      if (x.status >= 200 && x.status < 300) return resolve({ ok: true, data: data as T });
      const b = data as { code?: unknown } | null;
      if (b && typeof b.code === "string") {
        if (x.status === 401 && b.code === "unauthenticated") onUnauthenticated();
        return resolve({ ok: false, error: b as E });
      }
      resolve({ ok: false, error: { code: "network", message: `服务器返回 ${x.status}` } });
    };
    x.send(body);
  });
}
