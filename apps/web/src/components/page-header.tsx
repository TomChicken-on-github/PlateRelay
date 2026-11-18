import { ArrowLeft, Bell } from "lucide-react";
import type { ReactNode } from "react";

/** Page title row: a 28px title on the left, actions (usually the notification bell) on the right. */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-11 items-center justify-between gap-3">
      <h1 className="m-0 truncate text-[28px] leading-9 font-bold tracking-[-0.5px]">{title}</h1>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Bell in the page header. The red dot shows when there is something unread. */
export function NotificationBell({ unread = false }: { unread?: boolean }) {
  return (
    <button type="button" aria-label={unread ? "通知，有未读" : "通知"} className="relative grid size-10 place-items-center rounded-full bg-card text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Bell className="size-5" aria-hidden="true" />
      {unread && <i className="absolute top-2 right-[9px] size-2 rounded-full bg-alert-dot shadow-[0_0_0_2px_var(--card)]" />}
    </button>
  );
}

/** Sub-page title row: a back arrow, then a 20px title. */
export function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="-ml-2 flex h-11 items-center gap-2">
      <button type="button" aria-label="返回" onClick={onBack} className="grid size-10 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ArrowLeft className="size-5" />
      </button>
      <h1 className="m-0 text-xl leading-7 font-semibold">{title}</h1>
    </header>
  );
}
