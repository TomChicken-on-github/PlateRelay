import { useEffect } from "react";
import type { Res } from "./api";
import { createStore } from "./store";

/*
 * Server data a page shows, kept in a shared store so pages that show the same rows stay in sync. It
 * loads when a page using it mounts, again when the tab comes back into view, and after the page's own
 * actions call refresh(). There is no push from the server yet (SSE is not built), so pages that
 * change without anyone touching them can ask for a poll.
 */
export type Live<T> = { data: T | null; error: string | null; loading: boolean };

export function resource<T>(load: () => Promise<Res<T>>) {
  const store = createStore<Live<T>>({ data: null, error: null, loading: false });
  let inflight: Promise<void> | null = null;

  const refresh = () =>
    (inflight ??= (async () => {
      store.set((s) => ({ ...s, loading: true }));
      const r = await load();
      store.set((s) => (r.ok ? { data: r.data, error: null, loading: false } : { data: s.data, error: r.error.message, loading: false }));
    })().finally(() => (inflight = null)));

  /** Loads on mount and when the tab is shown again; `pollMs` also reloads on a timer while visible. */
  const use = (pollMs?: number) => {
    useEffect(() => {
      void refresh();
      const onShow = () => document.visibilityState === "visible" && void refresh();
      document.addEventListener("visibilitychange", onShow);
      const id = pollMs ? window.setInterval(() => document.visibilityState === "visible" && void refresh(), pollMs) : 0;
      return () => {
        document.removeEventListener("visibilitychange", onShow);
        window.clearInterval(id);
      };
    }, [pollMs]);
    return store.use();
  };

  /** Local change ahead of the server's answer (dragging the queue). */
  const patch = (f: (d: T) => T) => store.set((s) => (s.data === null ? s : { ...s, data: f(s.data) }));

  return { use, refresh, patch, get: () => store.get().data };
}

/** Signed preview links change on every response; keep the first one while it is fresh so images do not reload. */
const links = new Map<string, { url: string; at: number }>();
export function stableLink(key: string, url: string | null | undefined, ttlMs = 8 * 60e3): string | null {
  if (!url) return null;
  const hit = links.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.url;
  links.set(key, { url, at: Date.now() });
  return url;
}
