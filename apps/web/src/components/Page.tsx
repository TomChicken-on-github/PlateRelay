import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { ME } from "../mock/session";
import { Avatar } from "./Avatar";
import { FigmaIcon } from "./icons/FigmaIcon";

/** Page column: 28px workspace padding, 24px gap (16 on phones), as in the Figma frame. */
export function Page({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cx(
        "mx-auto flex w-full flex-col gap-6 py-7 pr-[max(28px,env(safe-area-inset-right,0px))] pl-[max(28px,env(safe-area-inset-left,0px))] max-sm:gap-4 max-sm:py-4 max-sm:pr-[max(16px,env(safe-area-inset-right,0px))] max-sm:pl-[max(16px,env(safe-area-inset-left,0px))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Account() {
  return (
    <button type="button" aria-label="账户" className="state-layer flex h-12 min-w-40 items-center gap-2.5 rounded-3xl border-0 bg-sc-high py-1.5 pr-4 pl-1.5 text-left max-sm:min-w-0 max-sm:pr-1.5">
      <Avatar name={ME.name} size={36} />
      <span className="max-sm:hidden">
        <b className="block text-label-l font-medium">{ME.name}</b>
        <small className="block text-body-s text-on-variant">{ME.role}</small>
      </span>
    </button>
  );
}

export function BellButton({ className }: { className?: string }) {
  return (
    <button type="button" aria-label="通知" className={cx("state-layer grid size-12 flex-none place-items-center rounded-full border-0 bg-transparent text-on-variant", className)}>
      <FigmaIcon name="bell" className="size-6" />
    </button>
  );
}

export const VSep = ({ className }: { className?: string }) => <span className={cx("mx-1 h-6 w-px bg-outline-variant", className)} />;

/** Page header (48px): title on the left, page actions, then notifications and the account. */
export function PageHeader({
  title,
  lead,
  after,
  actions,
  keepAccount,
}: {
  title: ReactNode;
  lead?: ReactNode;
  after?: ReactNode;
  actions?: ReactNode;
  /** the overview keeps the bell and account on small screens */
  keepAccount?: boolean;
}) {
  const hide = keepAccount ? undefined : "max-lg:hidden";
  return (
    <header className="flex min-h-12 flex-wrap items-center gap-3">
      {lead}
      <h1 className="m-0 flex-none font-cjk text-headline-l font-bold tracking-normal max-sm:text-[26px] max-sm:leading-8">{title}</h1>
      {after}
      <span className="flex-1" />
      {actions && (
        <>
          {actions}
          <VSep className="max-lg:hidden" />
        </>
      )}
      <BellButton className={hide} />
      <span className={hide}>
        <Account />
      </span>
    </header>
  );
}
