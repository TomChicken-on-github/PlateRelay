import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./icons/Icon";
import { FilamentDots, ModelThumb } from "./ModelThumb";

/** Clickable order card (my orders, todo, review queue). Thumbnail on top at 5:2 above 640px, compact row on phones. */
export function OrderCard({ interactive = true, className, children, ...rest }: { interactive?: boolean } & HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-xl bg-sc px-5 py-4 transition-colors duration-150 ease-standard max-sm:px-4 max-sm:py-3.5 sm:gap-3.5",
        interactive && "cursor-pointer hover:bg-[color-mix(in_srgb,var(--md-on-surface)_4%,var(--md-sc))]",
        className,
      )}
      {...rest}
    >
      {children}
    </article>
  );
}

export function OrderHead({ id, chip, right }: { id: number; chip: ReactNode; right: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <b className="font-num text-[15px] leading-5 font-semibold">#{id}</b>
      {chip}
      <span className="ml-auto text-body-s tracking-normal text-on-variant">{right}</span>
    </div>
  );
}

export function OrderBody({ thumb, name, meta }: { thumb: ReactNode; name: string; meta: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3.5 sm:grid-cols-[minmax(0,1fr)] sm:items-start sm:gap-3">
      <div className="size-16 overflow-hidden rounded-[10px] bg-sc-high sm:aspect-[5/2] sm:h-auto sm:w-full sm:rounded-xl">{thumb}</div>
      <div className="min-w-0">
        <div className="overflow-hidden text-label-l font-medium tracking-normal text-ellipsis whitespace-nowrap">{name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-body-s tracking-normal text-on-variant">{meta}</div>
      </div>
    </div>
  );
}

export function Thumb({ fil }: { fil: [string, string][] }) {
  return <ModelThumb c1={fil[0][0]} c2={fil[1]?.[0]} />;
}

export function PlateMeta({ parts, fil }: { parts: string[]; fil: [string, string][] }) {
  return (
    <>
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
      <FilamentDots fil={fil} />
    </>
  );
}

/** Status block inside an order card. */
export function StatusBlock({ tone = "neutral", icon, title, right, children }: { tone?: "neutral" | "ok" | "err"; icon?: string; title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-2 rounded-xl px-3.5 py-3 text-note", tone === "ok" ? "bg-ok-bg" : tone === "err" ? "bg-err-bg" : "bg-sc-high")}>
      <div className={cx("flex items-center gap-2", tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : "text-on-surface")}>
        {icon && <Icon name={icon} size={18} className={tone === "neutral" ? "text-on-variant" : ""} />}
        <b className="font-medium">{title}</b>
        {right && <span className="ml-auto text-on-variant tnum">{right}</span>}
      </div>
      {children && <div className={cx(tone === "neutral" ? "text-on-variant" : "text-on-surface")}>{children}</div>}
    </div>
  );
}

export function OrderActions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">{children}</div>;
}

export const OrderGrid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))] items-stretch gap-4">{children}</div>;

export function Empty({ icon, title, children, ok }: { icon: string; title?: string; children?: ReactNode; ok?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-on-variant">
      <Icon name={icon} size={ok ? 48 : 40} className={ok ? "text-ok" : "opacity-60"} />
      {title && <b className="font-medium">{title}</b>}
      {children && <div>{children}</div>}
    </div>
  );
}
