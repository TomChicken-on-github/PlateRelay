import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";

export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("rounded-xl bg-sc", className)} {...rest} />;
}

export function PanelTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cx("m-0 text-title-m font-medium", className)}>{children}</h2>;
}
