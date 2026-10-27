import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./icons/Icon";

/** MD3 segmented button (36px, fully rounded); the selected segment carries a check. */
export function Segmented<K extends string>({ items, value, onChange, label, radio }: { items: { key: K; label: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void; label: string; radio?: boolean }) {
  return (
    <div role={radio ? "radiogroup" : "group"} aria-label={label} className="inline-flex h-9 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_var(--md-outline)]">
      {items.map((it, i) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role={radio ? "radio" : undefined}
            aria-checked={radio ? on : undefined}
            aria-pressed={on}
            onClick={() => onChange(it.key)}
            className={cx(
              "state-layer relative inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 px-4 text-label-l font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
              i > 0 && "shadow-[inset_1px_0_0_var(--md-outline)]",
              on ? "bg-secondary-container text-on-secondary-container" : "bg-transparent text-on-surface",
            )}
          >
            {on && <Icon name="check" size={18} />}
            {it.label}
            {it.count != null && <small className={cx("font-num text-body-s font-medium", on ? "text-inherit" : "text-on-variant")}>{it.count}</small>}
          </button>
        );
      })}
    </div>
  );
}
