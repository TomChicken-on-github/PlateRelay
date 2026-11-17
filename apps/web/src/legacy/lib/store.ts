import { useSyncExternalStore } from "react";

/** Tiny shared store so mock data survives route changes and pages that share data stay in sync. */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  const get = () => state;
  const set = (next: T | ((s: T) => T)) => {
    state = typeof next === "function" ? (next as (s: T) => T)(state) : next;
    subs.forEach((f) => f());
  };
  const subscribe = (f: () => void) => {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  };
  const use = () => useSyncExternalStore(subscribe, get, get);
  return { get, set, use };
}
