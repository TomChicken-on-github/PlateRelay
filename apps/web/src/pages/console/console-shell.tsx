import { ClipboardCheck, Ellipsis, ListChecks, LayoutGrid, LogOut, Package, QrCode, ScanLine, Settings, Printer, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/logo";
import { Dialog } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { useOverview } from "@/lib/queries";
import { can, useMe, useSessionActions, type Permission } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Permissions that open the console at all. */
export const CONSOLE_PERMS: Permission[] = ["order:review", "order:view:any", "printer:operate", "order:redeem", "order:store", "order:dispatch"];

type Item = { to: string; label: string; icon: typeof LayoutGrid; perms: Permission[]; end?: boolean; legacy?: boolean; badge?: "review" };

const ITEMS: Item[] = [
  { to: "/console", label: "概况", icon: LayoutGrid, perms: CONSOLE_PERMS, end: true },
  { to: "/legacy/todo", label: "待办", icon: ListChecks, perms: ["order:store", "printer:operate", "order:dispatch", "order:review"], legacy: true },
];
const SITE: Item[] = [
  { to: "/console/review", label: "审核", icon: ClipboardCheck, perms: ["order:review"], badge: "review" },
  { to: "/console/orders", label: "订单", icon: Package, perms: ["order:view:any"] },
  { to: "/console/printers", label: "打印机", icon: Printer, perms: ["printer:operate"] },
  { to: "/console/pickup", label: "取件", icon: ScanLine, perms: ["order:redeem"] },
];
const CONFIG: Item[] = [{ to: "/legacy/settings", label: "系统设置", icon: Settings, perms: ["settings:manage", "form:configure", "user:manage", "daemon:manage", "audit:view"], legacy: true }];

const row = "flex h-[38px] items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-subtle-foreground hover:bg-secondary/60 aria-[current=page]:bg-secondary aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

function Badge({ n, tone }: { n: number; tone: "ink" | "alert" }) {
  if (!n) return null;
  return <span className={cn("ml-auto h-5 min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold", tone === "alert" ? "bg-alert-dot text-white" : "bg-primary text-primary-foreground")}>{n}</span>;
}

/** The staff and admin shell: its own sidebar on desktop, a bottom bar on phones. Pages inside decide their own width. */
export function ConsoleShell() {
  const me = useMe();
  const { pathname } = useLocation();
  const overview = useOverview();
  const [more, setMore] = useState(false);
  const { logout } = useSessionActions();
  if (!can(me, ...CONSOLE_PERMS)) return <Navigate to="/" replace />;
  const pending = overview.data?.queue.pendingReview ?? 0;
  const visible = (xs: Item[]) => xs.filter((i) => can(me, ...i.perms));
  const link = (i: Item) => {
    const inner = (
      <>
        <i.icon className="size-5" aria-hidden="true" />
        {i.label}
        {i.badge === "review" && <Badge n={pending} tone="ink" />}
      </>
    );
    return i.legacy ? (
      <a key={i.to} href={i.to} className={row}>
        {inner}
      </a>
    ) : (
      <NavLink key={i.to} to={i.to} end={i.end} className={row}>
        {inner}
      </NavLink>
    );
  };
  const site = visible(SITE);
  const config = visible(CONFIG);

  return (
    <div className="min-h-dvh lg:flex">
      <nav aria-label="控制台导航" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-card px-3 pt-6 pb-4 shadow-[1px_0_0_var(--border)] lg:flex">
        <div className="mb-4 flex h-10 items-center gap-2.5 px-2">
          <Logo size={36} />
          <span className="text-base font-bold tracking-[-0.2px]">PlateRelay</span>
          <span className="ml-auto h-[22px] rounded-full bg-muted px-2 text-xs leading-[22px] font-semibold text-muted-foreground">控制台</span>
        </div>
        {visible(ITEMS).map(link)}
        {site.length > 0 && <span className="px-3 pt-3.5 pb-1.5 text-xs leading-4 font-semibold text-faint">现场</span>}
        {site.map(link)}
        {config.length > 0 && <span className="px-3 pt-3.5 pb-1.5 text-xs leading-4 font-semibold text-faint">配置</span>}
        {config.map(link)}
        <Link to="/me" className="mt-auto flex items-center gap-2.5 rounded-xl p-2 hover:bg-secondary/60">
          <UserAvatar id={me.user.id} name={me.user.displayName} url={me.user.avatarUrl} size={32} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm leading-5 font-semibold">{me.user.displayName}</span>
            <span className="truncate text-xs leading-4 text-muted-foreground">{me.user.role === "ADMIN" ? "管理员" : "现场人员"}</span>
          </span>
        </Link>
      </nav>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto lg:px-8 lg:pt-7 lg:pb-8">
        <Outlet />
      </main>

      <nav aria-label="控制台导航" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 bg-card px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-1px_0_var(--border)] lg:hidden">
        {(
          [
            ["/console", "概况", LayoutGrid, true],
            ["/legacy/todo", "待办", ListChecks, false],
            ["/console/orders", "订单", Package, false],
            ["/console/pickup", "取件", QrCode, false],
          ] as const
        ).map(([to, label, I, end]) => {
          const active = to.startsWith("/console") && (end ? pathname === to : pathname.startsWith(to));
          const cls = cn("flex flex-col items-center gap-1 py-1.5 text-[11px]", active ? "font-semibold text-foreground" : "font-medium text-muted-foreground");
          return to.startsWith("/legacy") ? (
            <a key={to} href={to} className={cls}>
              <I className="size-6" aria-hidden="true" />
              {label}
            </a>
          ) : (
            <NavLink key={to} to={to} className={cls}>
              <I className="size-6" aria-hidden="true" />
              {label}
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setMore(true)} className="flex flex-col items-center gap-1 py-1.5 text-[11px] font-medium text-muted-foreground">
          <Ellipsis className="size-6" aria-hidden="true" />
          更多
        </button>
      </nav>

      <MoreSheet open={more} onClose={() => setMore(false)} pending={pending} onLogout={() => void logout()} items={[...site.filter((i) => i.to !== "/console/orders" && i.to !== "/console/pickup"), ...config]} />
    </div>
  );
}

function MoreSheet({ open, onClose, items, pending, onLogout }: { open: boolean; onClose: () => void; items: Item[]; pending: number; onLogout: () => void }) {
  const cls = "flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-secondary/60";
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-1 rounded-t-3xl bg-card px-4 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] outline-none">
          <Dialog.Title className="sr-only">更多</Dialog.Title>
          <span aria-hidden="true" className="mb-2 h-1 w-9 self-center rounded-full bg-neutral-300 dark:bg-neutral-700" />
          {items.map((i) =>
            i.legacy ? (
              <a key={i.to} href={i.to} className={cls}>
                <i.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                {i.label}
              </a>
            ) : (
              <Link key={i.to} to={i.to} onClick={onClose} className={cls}>
                <i.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                {i.label}
                {i.badge === "review" && <Badge n={pending} tone="ink" />}
              </Link>
            ),
          )}
          <Link to="/" className={cls}>
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            选手端
          </Link>
          <button type="button" onClick={onLogout} className={cn(cls, "text-left")}>
            <LogOut className="size-5 text-muted-foreground" aria-hidden="true" />
            退出登录
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Page frame inside the console: a title row, then the body. */
export function ConsolePage({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-5", className)}>
      <header className="flex min-h-11 shrink-0 items-center gap-3">
        <h1 className="m-0 shrink-0 text-[28px] leading-9 font-bold tracking-[-0.5px]">{title}</h1>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
        {actions && <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}


