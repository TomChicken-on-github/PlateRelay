import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from "react";
import { cx } from "../lib/cx";

const CONTROL =
  "w-full box-border rounded-lg border-0 bg-transparent px-3.5 py-3 text-[16px] leading-6 text-on-surface outline-0 shadow-[inset_0_0_0_1px_var(--md-outline)] focus:shadow-[inset_0_0_0_2px_var(--md-primary)] disabled:opacity-50";
const BAD = "shadow-[inset_0_0_0_2px_var(--md-error)] focus:shadow-[inset_0_0_0_2px_var(--md-error)]";

/** Outlined field with the label above it (prototype `.field`). */
export function Field({
  label,
  required,
  error,
  hint,
  counter,
  className,
  children,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  counter?: ReactNode;
  className?: string;
  children: (id: string, cls: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-note font-medium tracking-[0.1px] text-on-variant">
          {label}
          {required && <em className="not-italic text-error"> *</em>}
        </label>
      )}
      {children(id, cx(CONTROL, error && BAD))}
      {(error || hint || counter) && (
        <div className="flex justify-between gap-2 text-body-s tracking-normal text-on-variant">
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
