import { useMemo } from "react";
import { encode } from "uqr";

/** The pickup code as a real QR code. The payload is the dashed code itself, e.g. "7K3Q-92". */
export function PickupQR({ code, size = 200 }: { code: string; size?: number }) {
  const { d, n } = useMemo(() => {
    /* ecc M leaves room for a scuffed or glare-washed phone screen; border 2 is enough on the white card. */
    const qr = encode(code, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { d, n: qr.size };
  }, [code]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label={`取件二维码 ${code}`} shapeRendering="crispEdges" className="block" style={{ width: size, height: size }}>
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
