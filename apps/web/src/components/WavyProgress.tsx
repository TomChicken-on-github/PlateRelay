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

/** Indeterminate linear progress used while a file is being parsed. */
export function LinearIndeterminate() {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-secondary-container">
      <i className="lbar-run block h-full w-2/5 rounded-sm bg-primary" />
    </div>
  );
}
