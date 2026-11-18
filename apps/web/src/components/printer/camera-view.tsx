import { CameraOff } from "lucide-react";
import { useId, useState } from "react";
import { clockSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Open-frame models; everything else is drawn as a closed case. */
const OPEN_FRAME = /\bA1\b/i;

/**
 * The printer's latest snapshot, or a line drawing of the machine when there is no picture
 * (no camera, offline, or the snapshot failed to load).
 */
export function CameraView({ printerId, name, modelName, snapshotAt, className }: { printerId: string; name: string; modelName?: string | null; snapshotAt: string | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (snapshotAt && broken !== snapshotAt)
    return (
      <div className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-900", className)}>
        <img
          src={`/api/v1/printers/${printerId}/camera/snapshot?at=${encodeURIComponent(snapshotAt)}`}
          alt={`${name} 摄像头画面`}
          onError={() => setBroken(snapshotAt)}
          className="size-full object-cover"
        />
        {/* when the picture was taken (the snapshot's own time, not now): stills can be minutes old */}
        <time dateTime={snapshotAt} className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 font-mono text-[11px] leading-[18px] text-white">
          {clockSeconds(snapshotAt)}
        </time>
      </div>
    );
  const open = OPEN_FRAME.test(modelName ?? "");
  return (
    <div role="img" aria-label={`${name} 暂无画面`} className={cn("relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-xl bg-muted px-1 pt-1.5 text-faint", className)}>
      {open ? <OpenFrame /> : <ClosedCase />}
      <CameraOff className="absolute right-2 bottom-[7px] size-3.5" aria-hidden="true" />
    </div>
  );
}

/* Face / side / glass fills follow the theme: white, neutral-200, neutral-50 (dark: 700, 900, 900). */
const face = "fill-white dark:fill-neutral-700";
const side = "fill-neutral-200 dark:fill-neutral-900";
const glass = "fill-neutral-50 dark:fill-neutral-900";
const line = { stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round", vectorEffect: "non-scaling-stroke" } as const;

function ClosedCase() {
  const clip = useId();
  const outline = "M43.5 104 Q40 104 40 100.5 L40 39.5 Q40 36 42.97 34.15 L53.03 27.85 Q56 26 59.5 26 L112.5 26 Q116 26 116 29.5 L116 90.5 Q116 94 113.03 95.85 L102.97 102.15 Q100 104 96.5 104 Z";
  return (
    <svg viewBox="0 0 160 120" width="100%" height="100%" aria-hidden="true">
      <clipPath id={clip}>
        <path d={outline} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <path d="M40 36 H100 V104 H40 Z" className={face} />
        <path d="M40 36 L56 26 H116 L100 36 Z" className={face} />
        <path d="M100 36 L116 26 V94 L100 104 Z" className={side} />
        <path d="M40 36 H100 L116 26 M100 36 V104" fill="none" {...line} />
      </g>
      <path d={outline} fill="none" {...line} />
      <rect x="45" y="41" width="50" height="53" rx="2.5" className={glass} {...line} />
      <path d="M48 52 H92" fill="none" {...line} />
      <rect x="63" y="45" width="13" height="15" rx="2" className={face} {...line} />
    </svg>
  );
}

function OpenFrame() {
  return (
    <svg viewBox="0 0 160 120" width="100%" height="100%" aria-hidden="true">
      <path d="M50.5 94 Q48 94 48 91.5 L48 34.5 Q48 32 50.5 32 L55.5 32 Q58 32 58 34.5 L58 38.5 Q58 41 60.5 41 L107.5 41 Q110 41 110 43.5 L110 44.5 Q110 47 107.5 47 L60.5 47 Q58 47 58 49.5 L58 91.5 Q58 94 55.5 94 Z" className={face} {...line} />
      <rect x="64" y="85" width="48" height="5" rx="1.5" className={glass} {...line} />
      <rect x="40" y="90" width="80" height="11" rx="3" className={face} {...line} />
      <rect x="76" y="36" width="16" height="20" rx="2.5" className={face} {...line} />
    </svg>
  );
}
