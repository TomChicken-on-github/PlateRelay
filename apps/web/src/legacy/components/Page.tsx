import { type ReactNode, useState } from "react";
import { cx } from "../lib/cx";
import { logout, useMe } from "../lib/session";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
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
  const me = useMe();
  const [ask, setAsk] = useState(false);
  return (
    <>
    <button type="button" aria-label="账户" onClick={() => setAsk(true)} className="state-layer flex h-12 min-w-40 items-center gap-2.5 rounded-3xl border-0 bg-sc-high py-1.5 pr-4 pl-1.5 text-left max-sm:min-w-0 max-sm:pr-1.5">
      <Avatar name={me.name} size={36} />
      <span className="max-sm:hidden">
        <b className="block text-label-l font-medium">{me.name}</b>
        <small className="block text-body-s text-on-variant">{me.role}</small>
      </span>
    </button>
    <Sheet
      open={ask}
      onClose={() => setAsk(false)}
      icon="logout"
      title="退出登录？"
      footer={
        <>
          <Button variant="text" onClick={() => setAsk(false)}>取消</Button>
          <Button variant="text" onClick={logout}>退出登录</Button>
        </>
      }
    >
      <div className="text-label-l font-normal text-on-variant">
        当前登录：<b className="font-medium text-on-surface">{me.name}</b>
        {me.username && ` (${me.username})`} · {me.role}
      </div>
    </Sheet>
    </>
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
