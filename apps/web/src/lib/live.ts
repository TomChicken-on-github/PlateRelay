import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { API_PREFIX } from "@platerelay/shared/api";

/*
 * Server push (SSE). The server sends whole resources after each change, so pages just refetch what
 * they show. `resync` (sent after a reconnect, missed events are not replayed) refetches everything.
 */
const EVENTS: Record<string, (qc: QueryClient, data: unknown) => void> = {
  resync: (qc) => void qc.invalidateQueries(),
  "order.updated": (qc, d) => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    const id = (d as { id?: string })?.id;
    if (id) void qc.invalidateQueries({ queryKey: ["order", id] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
  },
  "printer.updated": (qc) => {
    void qc.invalidateQueries({ queryKey: ["printers"] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
  },
  "queue.changed": (qc) => {
    void qc.invalidateQueries({ queryKey: ["overview"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  },
};

/** Keeps one event stream open while signed in. */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`${API_PREFIX}/stream`, { withCredentials: true });
    const off = Object.entries(EVENTS).map(([name, f]) => {
      const h = (e: MessageEvent) => {
        let data: unknown = null;
        try {
          data = JSON.parse(e.data);
        } catch {
          /* not JSON */
        }
        f(qc, data);
      };
      es.addEventListener(name, h);
      return () => es.removeEventListener(name, h);
    });
    return () => {
      off.forEach((f) => f());
      es.close();
    };
  }, [enabled, qc]);
}
