import { useEffect, useState } from "react";

/** Whether the desktop layout (lg, 1024px and up) is showing. */
export function useDesktop() {
  const q = "(min-width: 1024px)";
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}
