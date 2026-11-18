import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn as SVG modules. Always dark on white so scanners read it in dark mode too. */
export function QrCode({ text, size = 208, className }: { text: string; size?: number; className?: string }) {
  const { d, n } = useMemo(() => {
    /* ecc M leaves room for a scuffed or glare-washed phone screen */
    const qr = encode(text, { ecc: "M", border: 0 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { d, n: qr.size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label="取件二维码" shapeRendering="crispEdges" className={className} style={{ width: size, height: size, display: "block" }}>
      <path d={d} className="fill-neutral-900" />
    </svg>
  );
}
