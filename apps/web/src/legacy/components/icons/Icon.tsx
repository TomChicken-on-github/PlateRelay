import { cx } from "../../lib/cx";

/** Material Symbols Rounded (wght 400). `fill` switches the FILL axis, used for selected states. */
export function Icon({ name, fill, size = 24, className }: { name: string; fill?: boolean; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("ms", fill && "fill", className)} style={{ fontSize: size, width: size, height: size }}>
      {name}
    </span>
  );
}
