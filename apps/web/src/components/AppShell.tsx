import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { cx } from "../lib/cx";
import { duration, easing } from "../lib/motion";
import { adminOrders } from "../mock/adminOrders";
import { tasks } from "../mock/todo";
import { FigmaIcon } from "./icons/FigmaIcon";
import { Icon } from "./icons/Icon";

type Item = { to: string; label: string; icon: string; badge?: number; end?: boolean };

function useNav(): (Item | string)[] {
  const pending = adminOrders.use().filter((o) => o.st === "pending").length;
  const todo = tasks.use().length;
  return [
    { to: "/", label: "概况", icon: "dashboard", end: false },
    "我的打印",
    { to: "/submit", label: "提交订单", icon: "upload_file" },
    { to: "/orders", label: "我的订单", icon: "receipt_long" },
    "现场",
    { to: "/todo", label: "待办", icon: "pending_actions", badge: todo || undefined },
    { to: "/scan", label: "扫码核销", icon: "qr_code_scanner" },
    "管理",
    { to: "/review", label: "审核队列", icon: "fact_check", badge: pending || undefined },
    { to: "/manage/orders", label: "订单管理", icon: "list_alt" },
    { to: "/manage/printers", label: "打印机管理", icon: "print" },
    { to: "/settings", label: "系统设置", icon: "settings" },
  ];
}

/* 概况 also owns the device detail route */
const isActive = (to: string, path: string) => (to === "/" ? path === "/" || path.startsWith("/printers/") : path === to || path.startsWith(to + "/"));

/** MD3 navigation drawer: 56px items, full-round active indicator, filled icon on the selected item. */
function Drawer({ modal, onNavigate }: { modal?: boolean; onNavigate?: () => void }) {
  const nav = useNav();
  const { pathname } = useLocation();
  return (
    <nav aria-label="主导航" className={cx("flex flex-col overflow-y-auto px-3 py-7", !modal && "sticky top-[env(safe-area-inset-top,0px)] h-dvh self-start")}>
      <div className="mb-3 flex h-12 items-center gap-2.5 px-3 text-title-m font-semibold">
        <FigmaIcon name="brand" className="h-8 w-[35px] text-primary" />
        <span>PlateRelay</span>
      </div>
      {nav.map((it) =>
        typeof it === "string" ? (
          <span key={it} className="px-4 pt-[18px] pb-2 text-label-l font-medium text-on-variant">
            {it}
          </span>
        ) : (
          <NavLink
            key={it.to}
            to={it.to}
            onClick={onNavigate}
            aria-current={isActive(it.to, pathname) ? "page" : undefined}
            className={() => {
              const on = isActive(it.to, pathname);
              return cx(
                "relative flex h-14 flex-none items-center gap-3 rounded-[28px] pr-6 pl-4 text-label-l font-medium no-underline",
                on ? "text-on-secondary-container" : "text-on-variant hover:bg-on-surface/8",
              );
            }}
          >
            {isActive(it.to, pathname) && (
              <motion.span
                layoutId={modal ? "nav-ind-modal" : "nav-ind"}
                className="absolute inset-0 -z-0 rounded-[28px] bg-secondary-container"
                transition={{ duration: duration.medium2, ease: easing.emphasized }}
              />
            )}
            <span className="relative flex items-center gap-3">
              <Icon name={it.icon} fill={isActive(it.to, pathname)} />
              <span>{it.label}</span>
            </span>
            {it.badge != null && <span className="relative ml-auto text-label-l font-medium">{it.badge}</span>}
          </NavLink>
        ),
      )}
    </nav>
  );
}

function titleOf(path: string) {
  if (path.startsWith("/printers/")) return "设备详情";
  const map: Record<string, string> = {
    "/": "概况", "/submit": "提交订单", "/orders": "我的订单", "/todo": "待办", "/scan": "扫码核销",
    "/review": "审核队列", "/manage/orders": "订单管理", "/manage/printers": "打印机管理", "/settings": "系统设置",
  };
  const k = Object.keys(map).filter((k) => k !== "/" && path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return map[k ?? "/"] ?? "PlateRelay";
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)]">
      <div className="hidden xl:block">
        <Drawer />
      </div>

      {/* below 1100px the drawer turns into a modal opened from a top app bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 bg-surface px-2 text-title-m font-medium xl:hidden">
        <button type="button" aria-label="菜单" onClick={() => setOpen(true)} className="state-layer grid size-10 place-items-center rounded-full border-0 bg-transparent">
          <Icon name="menu" />
        </button>
        <span>{titleOf(pathname)}</span>
      </header>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70] xl:hidden">
            <motion.div
              className="absolute inset-0 bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: duration.medium2, ease: easing.standard } }}
              exit={{ opacity: 0, transition: { duration: duration.short4, ease: easing.standard } }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="absolute top-0 bottom-0 left-0 w-[280px] max-w-[84vw] overflow-auto rounded-r-2xl bg-sc"
              initial={{ x: "-100%" }}
              animate={{ x: 0, transition: { duration: duration.medium4, ease: easing.emphasizedDecelerate } }}
              exit={{ x: "-100%", transition: { duration: duration.short4, ease: easing.emphasizedAccelerate } }}
            >
              <Drawer modal onNavigate={() => setOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="mx-auto w-full max-w-[2200px] max-xl:pt-14">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname.startsWith("/settings") ? "/settings" : pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.medium2, ease: easing.emphasizedDecelerate } }}
            exit={{ opacity: 0, transition: { duration: duration.short2, ease: easing.emphasizedAccelerate } }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
