import type { ReactNode } from "react";

/** Sign-in and register: one narrow column, the switch link pinned near the bottom. */
export function AuthLayout({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col px-6">{children}</div>
      <p className="m-0 pt-8 pb-10 text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm leading-5 font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
