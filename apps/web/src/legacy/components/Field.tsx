import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from "react";
import { cx } from "../lib/cx";

const CONTROL =
  "w-full box-border rounded-lg border-0 bg-transparent px-3.5 py-3 text-[16px] leading-6 text-on-surface outline-0 shadow-[inset_0_0_0_1px_var(--md-outline)] focus:shadow-[inset_0_0_0_2px_var(--md-primary)] disabled:opacity-50";
const BAD = "shadow-[inset_0_0_0_2px_var(--md-error)] hover:shadow-[inset_0_0_0_2px_var(--md-error)] focus:shadow-[inset_0_0_0_2px_var(--md-error)]";
const OUTLINED_CONTROL =
  "h-14 min-w-0 rounded-sm px-4 py-4 hover:shadow-[inset_0_0_0_1px_var(--md-on-surface)] focus:shadow-[inset_0_0_0_2px_var(--md-primary)]";

/** Shared field; outline labels use the MD3 56dp container on a surface-container card. */
export function Field({
  label,
  required,
  error,
  hint,
  counter,
  className,
  labelPlacement = "above",
  children,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  counter?: ReactNode;
  className?: string;
  labelPlacement?: "above" | "outline";
  children: (id: string, cls: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("group relative flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className={cx(
          labelPlacement === "outline"
            ? "absolute -top-2 left-3 z-10 max-w-[calc(100%-24px)] bg-sc px-1 text-body-s transition-[top,font-size,line-height,color] duration-150 ease-standard group-focus-within:text-primary group-has-[input:placeholder-shown:not(:focus)]:top-4 group-has-[input:placeholder-shown:not(:focus)]:bg-transparent group-has-[input:placeholder-shown:not(:focus)]:text-[16px] group-has-[input:placeholder-shown:not(:focus)]:leading-6 motion-reduce:transition-none"
            : "text-note font-medium tracking-[0.1px]",
          error ? "text-error group-focus-within:text-error" : "text-on-variant",
        )}>
          {label}
          {required && <em className="not-italic text-error"> *</em>}
        </label>
      )}
      {children(id, cx(CONTROL, labelPlacement === "outline" && OUTLINED_CONTROL, error && BAD))}
      {(error || hint || counter) && (
        <div id={`${id}-support`} className={cx("flex justify-between gap-2 text-body-s tracking-normal text-on-variant", labelPlacement === "outline" && "px-4")}>
          <span className={cx(error && "text-error")}>{error || hint}</span>
          {counter && <span>{counter}</span>}
        </div>
      )}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className} autoComplete="off" {...rest} />;
}

export function Select({ options, placeholder, className, ...rest }: { options: readonly string[]; placeholder?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={className} {...rest}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(className, "min-h-24 resize-y")} {...rest} />;
}
