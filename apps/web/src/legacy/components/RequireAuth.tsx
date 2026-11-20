import { type ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { loadMe, session } from "../lib/session";

/** Sends signed-out visitors to /login, keeping where they were headed in ?next=. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const s = session.use();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (s.st === "loading") loadMe();
  }, [s.st]);
  if (s.st === "loading") return <div className="min-h-dvh bg-surface" aria-busy="true" />;
  if (s.st === "out") return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return children;
}
