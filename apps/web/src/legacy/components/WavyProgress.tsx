import { cx } from "../lib/cx";

/** MD3 wavy linear progress (4dp). Inactive or finished jobs use a flat bar; 0% shows only the track. */
export function WavyProgress({ pct, active = true, className }: { pct: number; active?: boolean; className?: string }) {
  const full = pct >= 100;
  return (
    <div className={cx("flex h-3 items-center pl-0.5", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      {pct > 0 && (
        <i
          className={cx("flex-none bg-primary transition-[width] duration-500 ease-standard", active && !full ? "wave-fill h-3" : "h-1 rounded-sm")}
          style={{ width: `calc(${pct}% - ${full ? 0 : 6}px)` }}
        />
      )}
      {!full && (
        <i className={cx("relative h-1 flex-1 rounded-sm bg-secondary-container after:absolute after:top-0 after:right-0 after:size-1 after:rounded-full after:bg-primary", pct > 0 && "ml-1.5")} />
      )}
    </div>
  );
}

/**
 * MD3 indeterminate linear progress (4dp, flat), used while a file is being parsed: two indicators run
 * across the track with a 4px gap to it. The gap is painted in the surface colour behind the bar.
 */
export function LinearIndeterminate({ label = "正在解析", gap = "var(--md-sc-high)" }: { label?: string; gap?: string }) {
  return (
    <div role="progressbar" aria-label={label} className="relative mt-1.5 h-1 overflow-hidden rounded-sm bg-secondary-container" style={{ ["--lind-gap" as string]: gap }}>
      <i className="lind-1 absolute inset-y-0 rounded-sm bg-primary" />
      <i className="lind-2 absolute inset-y-0 rounded-sm bg-primary" />
    </div>
  );
}

/** MD3 determinate linear progress (4dp, flat): indicator, 4px gap, track with a stop dot. Used for upload bytes. */
export function LinearDeterminate({ pct, label }: { pct: number; label: string }) {
  const full = pct >= 100;
  return (
    <div className="mt-1.5 flex h-1 items-center" role="progressbar" aria-label={label} aria-valuenow={Math.floor(pct)} aria-valuemin={0} aria-valuemax={100}>
      {pct > 0 && <i className="h-1 flex-none rounded-sm bg-primary" style={{ width: `calc(${pct}% - ${full ? 0 : 4}px)` }} />}
      {!full && <i className={cx("relative h-1 flex-1 rounded-sm bg-secondary-container after:absolute after:top-0 after:right-0 after:size-1 after:rounded-full after:bg-primary", pct > 0 && "ml-1")} />}
    </div>
  );
}
