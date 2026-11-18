import { LayoutGrid, Package, Upload, User } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { OverviewPage } from "@/pages/overview/overview-page";
import { Button } from "./ui/button";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { UserAvatar } from "./user-avatar";

const MAIN = [
  { to: "/", label: "概况", icon: LayoutGrid },
  { to: "/submit", label: "提交", icon: Upload },
  { to: "/orders", label: "我的订单", icon: Package },
] as const;

/* Staff and admin pages are still the old ones under /legacy; links open them as separate pages. */
const LEGACY: { to: string; label: string; perms: string[] }[] = [
  { to: "/legacy/todo", label: "待办", perms: ["order:store", "printer:operate", "order:dispatch"] },
  { to: "/legacy/scan", label: "扫码核销", perms: ["order:redeem"] },
  { to: "/legacy/review", label: "审核队列", perms: ["order:review"] },
  { to: "/legacy/manage/orders", label: "订单管理", perms: ["order:view:any"] },
  { to: "/legacy/manage/printers", label: "打印机管理", perms: ["printer:manage"] },
  { to: "/legacy/settings", label: "系统设置", perms: ["settings:manage", "form:configure", "user:manage", "daemon:manage", "audit:view"] },
];

const isActive = (to: string, path: string) => (to === "/" ? path === "/" || path.startsWith("/printers/") : path === to || path.startsWith(to + "/"));

/** Desktop: 232px sidebar on the left. Phone: bottom tab bar. Content is centred, at most 1040 wide. */
export function AppShell() {
  const me = useMe();
  const { pathname } = useLocation();
  const legacy = LEGACY.filter((l) => can(me, ...l.perms));

  return (
    <div className="min-h-dvh lg:flex">
      <nav aria-label="主导航" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-1 bg-card px-3 py-6 shadow-[1px_0_0_var(--border)] lg:flex">
        <div className="mb-5 flex h-10 items-center gap-2.5 px-2">
          <Logo size={36} />
          <span className="text-base font-bold tracking-[-0.2px]">PlateRelay</span>
        </div>
        {MAIN.map(({ to, label, icon: I }) => (
          <NavLink
            key={to}
            to={to}
            aria-current={isActive(to, pathname) ? "page" : undefined}
            className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-subtle-foreground aria-[current=page]:bg-secondary aria-[current=page]:font-semibold aria-[current=page]:text-foreground hover:bg-secondary/60"
          >
            <I className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        {legacy.length > 0 && (
          <div className="mt-4 flex flex-col gap-1 border-t pt-4">
            {legacy.map((l) => (
              <a key={l.to} href={l.to} className="flex h-10 items-center rounded-[10px] px-3 text-sm font-medium text-subtle-foreground hover:bg-secondary/60">
                {l.label}
              </a>
            ))}
          </div>
        )}
        <NavLink to="/me" aria-current={pathname.startsWith("/me") ? "page" : undefined} className="mt-auto flex items-center gap-2.5 rounded-xl p-2 hover:bg-secondary/60 aria-[current=page]:bg-secondary">
          <UserAvatar id={me.user.id} name={me.user.displayName} url={me.user.avatarUrl} size={32} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{me.user.displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{me.user.username}</span>
          </span>
        </NavLink>
      </nav>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] lg:px-10 lg:pt-7 lg:pb-10">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
          <Outlet />
        </div>
      </main>

      <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 bg-card px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-1px_0_var(--border)] lg:hidden">
        {[...MAIN, { to: "/me", label: "我的", icon: User }].map(({ to, label, icon: I }) => {
          const active = isActive(to, pathname);
          return (
            <NavLink key={to} to={to} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 py-1.5 text-[11px] text-muted-foreground", active ? "font-semibold text-foreground" : "font-medium")}>
              <I className="size-6" aria-hidden="true" />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

/** A visitor who is not signed in, on the public overview: only 概况 in the sidebar and a 登录 button; no tab bar on phones. */
export function GuestShell() {
  return (
    <div className="min-h-dvh lg:flex">
      <nav aria-label="主导航" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-1 bg-card px-3 py-6 shadow-[1px_0_0_var(--border)] lg:flex">
        <div className="mb-5 flex h-10 items-center gap-2.5 px-2">
          <Logo size={36} />
          <span className="text-base font-bold tracking-[-0.2px]">PlateRelay</span>
        </div>
        <NavLink to="/" aria-current="page" className="flex h-10 items-center gap-3 rounded-[10px] bg-secondary px-3 text-sm font-semibold text-foreground">
          <LayoutGrid className="size-5" aria-hidden="true" />
          概况
        </NavLink>
        <Button asChild className="mt-auto">
          <Link to="/login">登录</Link>
        </Button>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-[max(32px,env(safe-area-inset-bottom))] lg:px-10 lg:pt-7 lg:pb-10">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
          <OverviewPage />
        </div>
      </main>
    </div>
  );
}
