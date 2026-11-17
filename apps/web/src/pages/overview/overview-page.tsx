import { ChevronRight, List, Upload } from "lucide-react";
import { type DragEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { NotificationBell, PageHeader } from "@/components/page-header";
import { PrinterCard } from "@/components/printer/printer-card";
import { StatusText } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { duration, waitRange } from "@/lib/format";
import { ORDER_STATUS, orderName, orderNo } from "@/lib/order-status";
import { setPendingFile } from "@/lib/pending-file";
import { type OrderSummary, useMyOrders, useOrder, useOverview } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

export function OverviewPage() {
  const me = useMe();
  const overview = useOverview();
  const printers = overview.data?.printers ?? [];
  const mayOrder = can(me, "order:submit");

  return (
    <>
      <PageHeader title="概况" actions={<NotificationBell />} />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 lg:gap-4">
        {mayOrder && <MyOrdersCard />}
        <SiteCard idle={printers.filter((p) => p.state === "AVAILABLE").length} waiting={overview.data?.queue.waiting} />
        {mayOrder && <DropZone />}
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="m-0 text-[15px] leading-[22px] font-semibold text-muted-foreground">打印机</h2>
          {overview.data && <span className="text-[13px] text-faint">{printers.length}</span>}
        </div>
        <div className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {overview.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[260px] rounded-2xl bg-card" />)}
          {printers.map((p) => (
            <PrinterCard key={p.id} printer={p} />
          ))}
        </div>
      </section>
    </>
  );
}

/* Which order the card shows: one to pick up first, then one printing, then one waiting. */
const PRIORITY: OrderSummary["status"][] = ["READY", "PRINTING", "DISPATCHED", "PRINTED", "QUEUED", "PENDING_REVIEW", "FAILED"];

function MyOrdersCard() {
  const orders = useMyOrders();
  const items = orders.data?.items ?? [];
  const live = items.filter((o) => PRIORITY.includes(o.status)).sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status));
  const top = live[0];
  const detail = useOrder(top?.status === "READY" ? top.id : undefined).data;
  const card = "flex min-w-0 flex-col gap-3 rounded-2xl bg-card pt-3.5 pr-3.5 pb-4 pl-4";

  if (orders.isPending) return <Skeleton className="min-h-[150px] rounded-2xl bg-card" />;
  if (!top)
    return (
      <section className={card}>
        <span className="text-[15px] leading-[22px] font-semibold">我的订单</span>
        <span className="text-sm leading-5 text-muted-foreground">暂无订单</span>
        <Button size="sm" className="mt-auto self-start" asChild>
          <Link to="/submit">提交文件</Link>
        </Button>
      </section>
    );

  const st = ORDER_STATUS[top.status];
  const counts = new Map<string, number>();
  for (const o of live.slice(1)) {
    const k = o.status === "READY" ? "待取件" : o.status === "PRINTING" ? "打印中" : o.status === "QUEUED" ? "排队中" : null;
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const more = [...counts].map(([k, n]) => `${n} ${k}`).join(" · ");

  return (
    <Link to={`/orders/${top.id}`} className={cn(card, "text-inherit no-underline")}>
      <span className="flex items-center justify-between text-[15px] leading-[22px] font-semibold">
        我的订单
        <ChevronRight className="size-[18px] text-faint" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <StatusText tone={st.tone} label={top.status === "READY" ? "可取件" : st.label} />
        <span className="font-mono text-xl leading-[26px] font-bold tracking-[-0.2px]">{orderNo(top.number)}</span>
        <span className="truncate text-[13px] leading-[18px] text-subtle-foreground">{orderName(top)}</span>
        <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{orderLine(top, detail?.storage?.slot)}</span>
      </span>
      {more && <span className="mt-auto text-xs leading-[18px] text-faint">另有 {more}</span>}
    </Link>
  );
}

function orderLine(o: OrderSummary, slot?: string): string {
  if (o.status === "READY") return slot ? `存放于 ${slot}` : "";
  if (o.printer && o.progress?.remainingSeconds != null) return `${o.printer.name} · 剩余 ${duration(o.progress.remainingSeconds)}`;
  if (o.printer) return o.printer.name;
  if (o.queue) return o.queue.wait ? `第 ${o.queue.position} 位 · 约等 ${waitRange(o.queue.wait.minSeconds, o.queue.wait.maxSeconds)}` : `第 ${o.queue.position} 位`;
  return "";
}

function SiteCard({ idle, waiting }: { idle: number; waiting?: number }) {
  const row = "flex items-center gap-2 text-sm leading-5 font-medium whitespace-nowrap text-subtle-foreground [&>svg]:size-[18px] [&>svg]:text-muted-foreground";
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl bg-card pt-3.5 pr-3.5 pb-4 pl-4">
      <span className="text-[15px] leading-[22px] font-semibold">现场</span>
      <span className="flex flex-col gap-1.5">
        <span className={row}>
          <PrinterGlyph />
          {idle} 台空闲
        </span>
        {waiting != null && (
          <span className={row}>
            <List aria-hidden="true" />
            {waiting} 单排队
          </span>
        )}
      </span>
    </section>
  );
}

/* the logo's printer, drawn as a plain line icon */
function PrinterGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M4 7.2L7.6 3.6A2 2 0 0 1 9 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-.6 1.4L17 19.8M16.6 7.4L20.4 3.6" />
      <path d="M4 11.5h12M6.5 18.6h7" />
    </svg>
  );
}

/** Desktop only: drop a .gcode.3mf here (or click) to start a submission. */
function DropZone() {
  const navigate = useNavigate();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setPendingFile(f);
    navigate("/submit");
  };
  return (
    <Link
      to="/submit"
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("hidden min-w-0 flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-faint p-4 text-inherit no-underline lg:flex", over && "border-foreground bg-card")}
    >
      <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
      <span className="text-[15px] leading-[22px] font-semibold">提交文件</span>
      <span className="text-[13px] leading-[18px] text-muted-foreground">拖入 .gcode.3mf 或点击选择</span>
    </Link>
  );
}
