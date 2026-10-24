import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "./icons/Icon";

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "danger" | "error-outlined" | "error-tonal";

const VARIANT: Record<ButtonVariant, string> = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "bg-transparent text-primary shadow-[inset_0_0_0_1px_var(--md-outline)]",
  text: "bg-transparent text-primary",
  danger: "bg-error text-on-error",
  "error-outlined": "bg-transparent text-error shadow-[inset_0_0_0_1px_var(--md-outline)]",
  "error-tonal": "bg-error-container text-error",
};

/* Filled-type buttons follow MD3 disabled colours; outlined and text buttons only dim their content. */
const DISABLED_FILL = "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none";
const DISABLED_LINE = "disabled:text-on-surface/38 disabled:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--md-on-surface)_12%,transparent)]";

/** MD3 common button. Buttons in this panel are 36px high and fully rounded (user decision). */
export function Button({
  variant = "filled",
  icon,
  iconFill,
  className,
  children,
  type = "button",
  ...rest
}: { variant?: ButtonVariant; icon?: string; iconFill?: boolean; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const isText = variant === "text";
  const lined = variant === "outlined" || variant === "error-outlined" || isText;
  return (
    <button
      type={type}
      className={cx(
        "state-layer inline-flex h-9 min-h-9 flex-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border-0 text-label-l font-medium transition-[background-color,color,box-shadow] duration-150 ease-standard disabled:cursor-not-allowed",
        isText ? "min-w-16 px-3" : icon ? "pl-4 pr-6" : "px-6",
        VARIANT[variant],
        lined ? DISABLED_LINE : DISABLED_FILL,
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} fill={iconFill} size={18} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  size = 48,
  fill,
  className,
  type = "button",
  ...rest
}: { icon: ReactNode | string; label: string; size?: 40 | 48; fill?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "state-layer grid flex-none place-items-center rounded-full border-0 bg-transparent text-on-variant",
        size === 48 ? "size-12" : "size-10",
        className,
      )}
      {...rest}
    >
      {typeof icon === "string" ? <Icon name={icon} fill={fill} size={size === 48 ? 24 : 20} /> : icon}
    </button>
  );
}
