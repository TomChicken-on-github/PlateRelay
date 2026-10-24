import { cx } from "../lib/cx";

/** MD3 switch, 52x32; the selected handle carries a check icon. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        "relative h-8 w-[52px] flex-none rounded-2xl border-0 p-0 transition-colors duration-200 ease-standard disabled:cursor-not-allowed disabled:opacity-38",
        checked ? "bg-primary" : "bg-sc-highest shadow-[inset_0_0_0_2px_var(--md-outline)]",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-all duration-200 ease-standard",
          checked ? "left-6 size-6 bg-on-primary text-primary" : "left-2 size-4 bg-outline text-transparent",
        )}
      >
        <svg viewBox="0 -960 960 960" className={cx("size-4 transition-opacity duration-150", checked ? "opacity-100" : "opacity-0")} aria-hidden="true">
          <path fill="currentColor" d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
        </svg>
      </span>
    </button>
  );
}
