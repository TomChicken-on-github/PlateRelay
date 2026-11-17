import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./icons/Icon";

export type Tone = "neutral" | "ok" | "warn" | "err";

const TONE: Record<Tone, string> = {
  neutral: "bg-sc-high text-on-variant",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  err: "bg-err-bg text-err",
};

/** Small status chip (24px). */
export function StatusChip({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 flex-none items-center gap-1 whitespace-nowrap rounded-lg px-2 text-body-s font-medium", TONE[tone], className)}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** MD3 filter chips used as status tabs (40px, r8). */
export function FilterTabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { key: K; label: string; count?: number; dot?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar -m-0.5 flex gap-2 overflow-x-auto p-0.5">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(it.key)}
            className={cx(
              "state-layer inline-flex h-10 flex-none items-center gap-2 overflow-hidden rounded-lg border-0 px-4 text-label-l font-medium transition-colors duration-150 ease-standard",
              on ? "bg-secondary-container text-on-secondary-container" : "bg-transparent text-on-surface shadow-[inset_0_0_0_1px_var(--md-outline)]",
            )}
          >
            {it.label}
            {it.count != null && <small className={cx("font-num text-body-s font-medium tracking-normal", on ? "text-inherit" : "text-on-variant")}>{it.count}</small>}
            {it.dot && <span className="size-2 rounded-full bg-primary" aria-label="有待处理" />}
          </button>
        );
      })}
    </div>
  );
}

/** Selectable chip with leading check, as in the overview filter (32px, r8). */
export function SelectChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "state-layer inline-flex h-8 items-center gap-2 rounded-lg border-0 py-1.5 text-label-l font-medium transition-colors duration-150 ease-standard",
        selected ? "bg-secondary-container pl-2 pr-4 text-on-secondary-container" : "bg-transparent px-4 text-on-variant shadow-[inset_0_0_0_1px_var(--md-outline-variant)]",
      )}
    >
      {selected && <Icon name="check" size={18} />}
      {children}
    </button>
  );
}
