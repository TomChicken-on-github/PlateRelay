import { useMemo } from "react";
import { encode } from "uqr";

/* Corner radii, in modules. Gently rounded: lone modules read as rounded squares, not dots. */
const R = 0.3;
const FINDER = { outer: 1.6, hole: 0.9, eye: 0.8 };
/* blank modules around the code so scanners find its edges */
const QUIET = 4;

/** A rounded rectangle as a path; `r` is [top-left, top-right, bottom-right, bottom-left]. */
function rect(x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  const [a, b, c, d] = r;
  const arc = (rr: number, dx: number, dy: number) => (rr ? `a${rr} ${rr} 0 0 1 ${dx * rr} ${dy * rr}` : "");
  return `M${x + a} ${y}h${w - a - b}${arc(b, 1, 1)}v${h - b - c}${arc(c, -1, 1)}h${-(w - c - d)}${arc(d, -1, -1)}v${-(h - d - a)}${arc(a, 1, -1)}z`;
}
const round = (x: number, y: number, s: number, r: number) => rect(x, y, s, s, [r, r, r, r]);

/**
 * The pickup code as a QR code: quartile error correction (a scuffed or glare-washed phone screen still
 * scans), rounded modules and finder patterns. Always dark on white so scanners read it in dark mode too.
 */
export function QrCode({ text, size = 232, className }: { text: string; size?: number; className?: string }) {
  const { modules, finders, n } = useMemo(() => {
    /* uppercase keeps the payload in the compact alphanumeric mode, so a pickup code fits the smallest version */
    const qr = encode(text.toUpperCase(), { ecc: "Q", border: 0 });
    const n = qr.size;
    const origins: [number, number][] = [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ];
    const inFinder = (x: number, y: number) => origins.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && qr.data[y][x] && !inFinder(x, y);

    let modules = "";
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!on(x, y)) continue;
        /* a corner is rounded only where neither neighbour touching it is dark */
        const up = on(x, y - 1),
          down = on(x, y + 1),
          left = on(x - 1, y),
          right = on(x + 1, y);
        modules += rect(x, y, 1, 1, [!up && !left ? R : 0, !up && !right ? R : 0, !down && !right ? R : 0, !down && !left ? R : 0]);
      }
    let finders = "";
    for (const [x, y] of origins) {
      finders += round(x, y, 7, FINDER.outer) + round(x + 1, y + 1, 5, FINDER.hole);
      modules += round(x + 2, y + 2, 3, FINDER.eye);
    }
    return { modules, finders, n };
  }, [text]);
  const v = n + QUIET * 2;
  return (
    <svg viewBox={`${-QUIET} ${-QUIET} ${v} ${v}`} role="img" aria-label="取件二维码" className={className} style={{ width: size, height: size, display: "block" }}>
      <path d={modules} className="fill-neutral-900" />
      <path d={finders} fillRule="evenodd" className="fill-neutral-900" />
    </svg>
  );
}
