import type { ReactNode } from "react";
import { cx } from "../lib/cx";

const CHECK = <path fill="currentColor" d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />;

/** MD3 checkbox with a 48px touch target and its label. */
export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="group relative -ml-3 flex min-h-12 w-full cursor-pointer items-center gap-1 text-body-m">
      <input type="checkbox" className="peer absolute size-12 cursor-pointer opacity-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative grid size-12 flex-none place-items-center rounded-full before:absolute before:inset-1 before:rounded-full before:bg-on-surface before:opacity-0 before:transition-opacity group-hover:before:opacity-8 peer-focus-visible:before:opacity-12 peer-focus-visible:outline-2 peer-focus-visible:outline-primary">
        <i
          className={cx(
            "relative grid size-[18px] place-items-center rounded-[2px] border-2 border-solid transition-colors duration-150 ease-standard",
            checked ? "border-primary bg-primary text-on-primary" : "border-on-variant text-transparent",
          )}
        >
          <svg viewBox="0 -960 960 960" className="absolute size-[18px]" aria-hidden="true">
            {CHECK}
          </svg>
        </i>
      </span>
      <span>{children}</span>
    </label>
  );
}

/** Compact 22px checkbox used inside list rows (plates). */
export function RowCheckbox({ checked, disabled, onChange, label, danger }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; danger?: boolean }) {
  return (
    <span className="relative grid size-[22px] flex-none place-items-center">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cx(
          "m-0 size-[22px] cursor-pointer appearance-none rounded border-0 disabled:cursor-not-allowed disabled:opacity-38",
          checked ? (danger ? "bg-error" : "bg-primary") : "bg-transparent shadow-[inset_0_0_0_2px_var(--md-outline)]",
        )}
      />
      <svg viewBox="0 -960 960 960" className={cx("pointer-events-none absolute size-4", danger ? "text-on-error" : "text-on-primary", !checked && "hidden")} aria-hidden="true">
        {CHECK}
      </svg>
    </span>
  );
}
