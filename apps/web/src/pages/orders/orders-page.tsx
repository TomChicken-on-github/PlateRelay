import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, useReactTable } from "@tanstack/react-table";
import { Package, QrCode, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { OrderThumb } from "@/components/order-thumb";
import { NotificationBell, PageHeader } from "@/components/page-header";
import { TONE } from "@/components/printer/status";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, duration, shortDateTime, waitRange } from "@/lib/format";
import { ENDED, ORDER_STATUS, orderName, orderNo } from "@/lib/order-status";
import { type OrderDetail, type OrderSummary, useMyOrders, useOrders } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PickupDialog } from "./pickup-dialog";

/* Ongoing orders: the ones that need the applicant first. */
const ACTIVE_ORDER: OrderSummary["status"][] = ["READY", "FAILED", "PRINTING", "DISPATCHED", "QUEUED", "PRINTED", "PENDING_REVIEW"];
/* Statuses whose line needs the order's details (storage slot, finish time, rejection reason). */
const NEEDS_DETAIL: OrderSummary["status"][] = ["READY", "PRINTED", "REJECTED"];

type Row = OrderSummary & { name: string; line: string; lineTone?: "alert" };

export function OrdersPage() {
  const orders = useMyOrders();
  const items = orders.data?.items ?? [];
  const details = useOrders(items.filter((o) => NEEDS_DETAIL.includes(o.status)).map((o) => o.id));
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [pickup, setPickup] = useState<Row | null>(null);

  const rows: Row[] = items.map((o) => ({ ...o, name: orderName(o), ...line(o, details.get(o.id)) }));
  const q = query.trim().toLowerCase().replace(/^#0*/, "");
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.fileName ?? "").toLowerCase().includes(q) || String(r.number) === q) : rows;
  const active = shown.filter((o) => !ENDED.includes(o.status)).sort((a, b) => ACTIVE_ORDER.indexOf(a.status) - ACTIVE_ORDER.indexOf(b.status));
  const ended = shown.filter((o) => ENDED.includes(o.status)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  const searchField = (
    <label className="flex h-10 w-full items-center gap-2 rounded-full bg-card px-3.5 text-sm text-muted-foreground lg:w-[260px]">
      <Search className="size-[18px] shrink-0" aria-hidden="true" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件名或单号" aria-label="搜索文件名或单号" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
      {query && (
        <button type="button" aria-label="清除" onClick={() => setQuery("")} className="grid size-5 place-items-center rounded-full">
          <X className="size-4" />
        </button>
      )}
    </label>
  );

  return (
    <>
      <PageHeader
        title="我的订单"
        actions={
          <>
            {items.length > 0 && <div className="hidden lg:block">{searchField}</div>}
            {items.length > 0 && (
              <button
                type="button"
                aria-label="搜索订单"
                aria-expanded={searching}
                onClick={() => (setSearching(!searching), setQuery(""))}
                className="grid size-10 place-items-center rounded-full bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden"
              >
                {searching ? <X className="size-5" /> : <Search className="size-5" />}
              </button>
            )}
            <NotificationBell />
          </>
        }
      />
      {searching && <div className="-mt-3 lg:hidden">{searchField}</div>}

      {orders.isPending ? (
        <Skeleton className="h-[320px] rounded-2xl bg-card" />
      ) : items.length === 0 ? (
        <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-muted-foreground lg:h-[480px] lg:rounded-2xl lg:bg-card">
          <Package className="size-10 text-faint" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-[15px] leading-[22px]">暂无订单</span>
          <Button asChild>
            <Link to="/submit">提交文件</Link>
          </Button>
        </div>
      ) : (
        <>
          <Section title="进行中" count={active.length} rows={active} onPickup={setPickup} />
          <Section title="已结束" count={ended.length} rows={ended} onPickup={setPickup} />
        </>
      )}

      {pickup && <PickupDialog orderId={pickup.id} name={pickup.name} slot={details.get(pickup.id)?.storage?.slot} open onOpenChange={(o) => !o && setPickup(null)} />}
    </>
  );
}

/** The status line under the name, and the 进展 column on desktop. */
function line(o: OrderSummary, d: OrderDetail | undefined): { line: string; lineTone?: "alert" } {
  const p = o.printer?.name;
  switch (o.status) {
    case "READY":
      return { line: d?.storage ? `存放于 ${d.storage.slot}` : "" };
    case "FAILED":
      return { line: "等待现场人员处理" };
    case "PRINTING":
      return { line: [p, o.progress?.remainingSeconds != null ? `剩余 ${duration(o.progress.remainingSeconds)}` : null].filter(Boolean).join(" · ") };
    case "DISPATCHED":
      return { line: [p, "准备中"].filter(Boolean).join(" · ") };
    case "QUEUED":
      if (!o.queue) return { line: "" };
      return { line: o.queue.wait ? `第 ${o.queue.position} 位 · 预计等待 ${waitRange(o.queue.wait.minSeconds, o.queue.wait.maxSeconds)}` : `第 ${o.queue.position} 位` };
    case "PRINTED": {
      const end = d?.printJobs?.[0]?.endedAt;
      return { line: [p ?? d?.printJobs?.[0]?.printerName, end ? `${clock(end)} 完成打印` : null, "等待入库"].filter(Boolean).join(" · ") };
    }
    case "REJECTED":
      return d?.activeVersion.reason ? { line: `驳回原因：${d.activeVersion.reason}`, lineTone: "alert" } : { line: "" };
    default:
      return { line: "" };
  }
}

function Section({ title, count, rows, onPickup }: { title: string; count: number; rows: Row[]; onPickup: (r: Row) => void }) {
  if (!rows.length && title === "已结束") return null;
  return (
    <section className="flex flex-col gap-2 lg:gap-2.5">
      <h2 className="m-0 flex items-baseline gap-1.5 px-1 text-[15px] leading-[22px] font-semibold">
        {title}
        <span className="font-medium text-faint">{count}</span>
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground">暂无订单</div>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:hidden">
            {rows.map((r) => (
              <OrderCard key={r.id} row={r} onPickup={() => onPickup(r)} />
            ))}
          </div>
          <OrderTable label={`${title}的订单`} rows={rows} onPickup={onPickup} />
        </>
      )}
    </section>
  );
}

/** Long names lose their middle, so the start and the end (often a version) both stay. */
function midTrim(name: string, max = 40): string {
  if (name.length <= max) return name;
  const k = Math.floor((max - 1) / 2);
  return name.slice(0, k) + "…" + name.slice(name.length - (max - 1 - k));
}

const pct = (r: Row) => (r.status === "PRINTING" && r.progress ? r.progress.percent : null);

function OrderCard({ row: r, onPickup }: { row: Row; onPickup: () => void }) {
  const st = ORDER_STATUS[r.status];
  const p = pct(r);
  return (
    <article className="relative flex flex-col gap-2.5 rounded-2xl bg-card p-4">
      <div className="flex items-start gap-3">
        <OrderThumb url={r.plate.thumbnailUrl} className="size-16" />
        <div className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex items-start gap-2">
            <Link to={`/orders/${r.id}`} className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-[22px] font-semibold [overflow-wrap:anywhere] text-inherit no-underline after:absolute after:inset-0 after:rounded-2xl">
              {midTrim(r.name)}
            </Link>
            <StatusPill tone={st.tone} label={st.label} />
          </div>
          {r.line && <span className={cn("truncate text-[13px] leading-[18px]", r.lineTone ? TONE[r.lineTone].text : "text-muted-foreground")}>{r.line}</span>}
          <span className="truncate text-xs leading-[18px] text-faint">
            {orderNo(r.number)} · {shortDateTime(r.submittedAt)} 提交 · 预计 {duration(r.plate.printSeconds)}
          </span>
        </div>
      </div>
      {p != null && <Progress value={p} tone={st.tone} />}
      {r.status === "READY" && (
        <Button size="lg" className="relative z-10 h-11" onClick={onPickup}>
          <QrCode className="size-[18px]" aria-hidden="true" />
          出示取件码
        </Button>
      )}
    </article>
  );
}

function Progress({ value, tone, thin }: { value: number; tone: keyof typeof TONE; thin?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn("flex-1 overflow-hidden rounded-full bg-track", thin ? "h-1" : "h-1.5")}>
        <div className={cn("h-full rounded-full", TONE[tone].dot)} style={{ width: `${value}%` }} />
      </div>
      <span className={cn("font-semibold", thin ? "text-xs" : "text-[13px]")}>{value}%</span>
    </div>
  );
}

const col = createColumnHelper<Row>();
const GRID = "grid grid-cols-[56px_minmax(0,1.4fr)_104px_minmax(0,2fr)_112px_72px] items-center gap-4 px-4";

/** Desktop: one table per section. */
function OrderTable({ label, rows, onPickup }: { label: string; rows: Row[]; onPickup: (r: Row) => void }) {
  const columns = [
    col.display({ id: "thumb", header: "", cell: (c) => <OrderThumb url={c.row.original.plate.thumbnailUrl} className="size-14 rounded-[10px]" /> }),
    col.accessor("name", {
      header: "文件",
      cell: (c) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link to={`/orders/${c.row.original.id}`} title={c.getValue()} className="truncate text-sm leading-5 font-semibold text-inherit no-underline after:absolute after:inset-0">
            {midTrim(c.getValue())}
          </Link>
          <span className="font-mono text-xs leading-4 text-faint">{orderNo(c.row.original.number)}</span>
        </span>
      ),
    }),
    col.accessor("status", { header: "状态", cell: (c) => <StatusPill tone={ORDER_STATUS[c.getValue()].tone} label={ORDER_STATUS[c.getValue()].label} /> }),
    col.display({
      id: "progress",
      header: "进展",
      cell: (c) => {
        const r = c.row.original;
        const p = pct(r);
        return (
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className={cn("min-w-0 truncate text-[13px] leading-[18px]", r.lineTone ? TONE[r.lineTone].text : "text-muted-foreground")}>{r.line}</span>
              {r.status === "READY" && (
                <button
                  type="button"
                  onClick={() => onPickup(r)}
                  className="relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <QrCode className="size-3.5" aria-hidden="true" />
                  取件码
                </button>
              )}
            </span>
            {p != null && <Progress value={p} tone={ORDER_STATUS[r.status].tone} thin />}
          </span>
        );
      },
    }),
    col.accessor("submittedAt", { header: "提交时间", cell: (c) => <span className="text-[13px] whitespace-nowrap text-muted-foreground">{shortDateTime(c.getValue())}</span> }),
    col.accessor((r) => r.plate.printSeconds, { id: "est", header: () => <span className="block text-right">预计用时</span>, cell: (c) => <span className="block text-right text-[13px] whitespace-nowrap text-muted-foreground">{duration(c.getValue())}</span> }),
  ];
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel() });

  return (
    <div role="table" aria-label={label} className="hidden overflow-hidden rounded-2xl bg-card lg:block">
      {table.getHeaderGroups().map((g) => (
        <div role="row" key={g.id} className={cn(GRID, "h-10 text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]")}>
          {g.headers.map((h) => (
            <span role="columnheader" key={h.id}>
              {flexRender(h.column.columnDef.header, h.getContext()) as ReactNode}
            </span>
          ))}
        </div>
      ))}
      {table.getRowModel().rows.map((row) => (
        <div role="row" key={row.id} className={cn(GRID, "relative min-h-[72px] py-2.5 shadow-[inset_0_-1px_0_var(--border)] last:shadow-none hover:bg-muted/50")}>
          {row.getVisibleCells().map((c) => (
            <span role="cell" key={c.id} className="min-w-0">
              {flexRender(c.column.columnDef.cell, c.getContext()) as ReactNode}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
