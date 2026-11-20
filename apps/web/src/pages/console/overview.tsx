import { ChevronRight, List, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { NotificationBell } from "@/components/page-header";
import { PrinterCard } from "@/components/printer/printer-card";
import { Skeleton } from "@/components/ui/skeleton";
import { orderNo } from "@/lib/order-status";
import { type TodoItem, useAllOrders, useOverview, useTodo } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";

const card = "flex min-w-0 flex-col gap-3 rounded-2xl bg-card pt-3.5 pr-3.5 pb-4 pl-4";

/** How long since, in the todo list's short form: "8 分钟", "1 天". */
function since(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`;
  return `${Math.floor(s / 86400)} 天`;
}

const ATTENTION: Record<string, string> = { ERROR: "报错", JUDGE: "等待人工裁定", SEND_FAILED: "发送文件失败", DAEMON_UPGRADE: "连接程序需要升级", OFFLINE: "离线", MAINTENANCE: "维护中" };

type Line = { dot: "alert" | "wait" | "idle" | "busy"; name: string; text: string };

/** One todo row: a coloured dot, the printer name or order number, and what is wrong. */
export function todoLine(t: TodoItem, printer: (id: string | null) => string | undefined): Line {
  const d = t.data as Record<string, unknown>;
  const no = typeof d.number === "number" ? orderNo(d.number) : "";
  const pn = printer(t.printerId) ?? (typeof d.name === "string" ? d.name : "");
  switch (t.kind) {
    case "REVIEW":
      return { dot: "idle", name: no, text: d.revision ? "待审核 · 修改" : "待审核" };
    case "STORE":
      return { dot: "wait", name: no, text: "待铲件入库" };
    case "ATTENTION":
      return { dot: "alert", name: pn, text: ((d.reasons as string[] | undefined) ?? []).map((r) => ATTENTION[r] ?? r).join("、") || "异常" };
    case "CLEAR_BED":
      return { dot: "wait", name: pn, text: "待清板" };
    case "PAUSED_TOO_LONG":
      return { dot: "wait", name: pn || no, text: "暂停太久" };
    case "START_UNCONFIRMED":
      return { dot: "wait", name: pn || no, text: "开始打印未确认" };
    case "BYPASSED":
      return { dot: "idle", name: no, text: "排队被跳过" };
    case "UNCLAIMED":
      return { dot: "idle", name: no, text: "待取件超时" };
    case "LOW_FILAMENT":
      return { dot: "wait", name: pn, text: "料位克数不足" };
  }
}

export const DOT = { alert: "bg-alert-dot", wait: "bg-wait-dot", idle: "bg-idle-dot", busy: "bg-busy-dot" } as const;

/** Console landing: what needs doing, how the review queue looks, and the printer wall. */
export function ConsoleOverview() {
  const me = useMe();
  const overview = useOverview();
  const todo = useTodo();
  const mayReview = can(me, "order:review");
  const pending = useAllOrders({ status: "PENDING_REVIEW", limit: 100 });
  const printers = overview.data?.printers ?? [];
  const items = todo.data ?? [];
  const printerName = (id: string | null) => printers.find((p) => p.id === id)?.name;
  const waiting = overview.data?.queue.waiting;
  const idle = printers.filter((p) => p.state === "AVAILABLE").length;
  const queue = pending.data?.items ?? [];
  const revisions = items.filter((t) => t.kind === "REVIEW" && (t.data as { revision?: boolean }).revision).length;
  const oldest = queue.length ? queue.reduce((a, b) => (a.submittedAt < b.submittedAt ? a : b)) : null;

  return (
    <ConsolePage title="概况" actions={<NotificationBell />} className="mx-auto w-full max-w-[1040px] flex-none">
      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4">
        <Link to="/legacy/todo" className={cn(card, "text-inherit no-underline lg:min-h-[168px]")}>
          <span className="flex items-center justify-between text-[15px] leading-[22px] font-semibold">
            <span>待办{items.length > 0 && ` · ${items.length}`}</span>
            <ChevronRight className="size-[18px] text-faint" aria-hidden="true" />
          </span>
          {todo.isPending ? (
            <Skeleton className="h-16" />
          ) : items.length === 0 ? (
            <span className="text-sm leading-5 text-muted-foreground">没有待办</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {items.slice(0, 3).map((t, i) => {
                const l = todoLine(t, printerName);
                return (
                  <li key={i} className="flex min-w-0 items-center gap-2.5 text-sm leading-5">
                    <i className={cn("size-2 shrink-0 rounded-full", DOT[l.dot])} />
                    <span className="shrink-0 font-mono text-[13px] font-semibold">{l.name}</span>
                    <span className="min-w-0 flex-1 truncate text-subtle-foreground">{l.text}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{since(t.since)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 3 && <span className="mt-auto text-xs leading-[18px] text-faint">另有 {items.length - 3} 项</span>}
        </Link>

        {mayReview && (
          <Link to="/console/review" className={cn(card, "text-inherit no-underline")}>
            <span className="flex items-center justify-between text-[15px] leading-[22px] font-semibold">
              待审核
              <ChevronRight className="size-[18px] text-faint" aria-hidden="true" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[28px] leading-[34px] font-bold tracking-[-0.3px]">{queue.length} 单</span>
              {oldest && <span className="text-[13px] leading-[18px] text-muted-foreground">最早一单已等 {since(oldest.submittedAt)}</span>}
            </span>
            {revisions > 0 && <span className="mt-auto text-xs leading-[18px] text-faint">其中 {revisions} 单为修改</span>}
          </Link>
        )}

        <section className={card}>
          <span className="text-[15px] leading-[22px] font-semibold">现场</span>
          <span className="flex flex-col gap-1.5 text-sm leading-5 font-medium whitespace-nowrap text-subtle-foreground [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&_svg]:size-[18px] [&_svg]:text-muted-foreground">
            <span>
              <PrinterGlyph />
              {idle} 台空闲
            </span>
            {waiting != null && (
              <span>
                <List aria-hidden="true" />
                {waiting} 单排队
              </span>
            )}
            {overview.data && (
              <span>
                <TriangleAlert aria-hidden="true" />
                {overview.data.printers.filter((p) => p.state === "ATTENTION").length} 台异常
              </span>
            )}
          </span>
        </section>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="m-0 text-[15px] leading-[22px] font-semibold text-muted-foreground">打印机</h2>
          {overview.data && <span className="text-[13px] text-faint">{printers.length}</span>}
        </div>
        <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {overview.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[260px] rounded-2xl bg-card" />)}
          {printers.map((p) => (
            <PrinterCard key={p.id} printer={p} to={`/console/printers/${p.id}`} />
          ))}
        </div>
      </section>
    </ConsolePage>
  );
}

export function PrinterGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M4 7.2L7.6 3.6A2 2 0 0 1 9 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-.6 1.4L17 19.8M16.6 7.4L20.4 3.6" />
      <path d="M4 11.5h12M6.5 18.6h7" />
    </svg>
  );
}
