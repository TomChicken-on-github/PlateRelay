import { Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { OrderThumb } from "@/components/order-thumb";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { clock, duration } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus, orderName, orderNo } from "@/lib/order-status";
import { type OrderSummary, useAllOrders } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";
import { PrintDialog } from "./print-dialog";

const TABS: { key: string; label: string; statuses?: OrderStatus[]; count?: boolean }[] = [
  { key: "all", label: "全部" },
  { key: "review", label: "待审核", statuses: ["PENDING_REVIEW"], count: true },
  { key: "queued", label: "排队中", statuses: ["QUEUED"], count: true },
  { key: "printing", label: "打印中", statuses: ["DISPATCHED", "PRINTING"], count: true },
  { key: "store", label: "待入库", statuses: ["PRINTED"], count: true },
  { key: "ready", label: "待取件", statuses: ["READY"], count: true },
  { key: "ended", label: "已结束", statuses: ["COMPLETED", "REJECTED", "CANCELLED", "DISPOSED", "FAILED"] },
];

/* Staff wording: where the order stands right now. */
const STAFF_STATUS: Partial<Record<OrderStatus, string>> = { PENDING_REVIEW: "待审核", PRINTED: "待入库", PRINTING: "打印中", DISPATCHED: "打印中" };

function dayOrClock(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? clock(d) : days === 1 ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}`;
}

function extra(o: OrderSummary) {
  if (o.status === "QUEUED" && o.queue) return `第 ${o.queue.position} 位`;
  if ((o.status === "PRINTING" || o.status === "DISPATCHED") && o.printer) return `${o.printer.name}${o.progress ? ` · ${o.progress.percent}%` : ""}`;
  if (o.status === "PRINTED" && o.printer) return o.printer.name;
  return "";
}

/** Order management: tabs by status, one table, and the single 打印 button that starts the dispatch dialog. */
export function ConsoleOrders() {
  const me = useMe();
  const all = useAllOrders({ limit: 200 });
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [printing, setPrinting] = useState(false);
  const orders = all.data?.items ?? [];
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, t.statuses ? orders.filter((o) => t.statuses!.includes(o.status)).length : orders.length])), [orders]);
  const cur = TABS.find((t) => t.key === tab)!;
  const needle = q.trim().toLowerCase();
  const rows = orders.filter((o) => (!cur.statuses || cur.statuses.includes(o.status)) && (!needle || [o.fileName, orderNo(o.number), o.owner.name].some((s) => s?.toLowerCase().includes(needle))));

  return (
    <ConsolePage
      title="订单"
      actions={
        <>
          <label className="flex h-10 min-w-0 flex-1 items-center lg:w-[260px] lg:flex-none gap-2 rounded-full bg-card px-3.5 text-sm text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
            <Search className="size-[18px] shrink-0" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索文件、订单号、申请人" className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
          {can(me, "order:dispatch") && (
            <Button onClick={() => setPrinting(true)}>
              <Printer aria-hidden="true" />
              打印
            </Button>
          )}
        </>
      }
    >
      <nav aria-label="订单状态" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => setTab(t.key)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-muted-foreground outline-none hover:bg-card/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
          >
            {t.label}
            {t.count && counts[t.key] > 0 && <span className="text-xs font-semibold text-muted-foreground">{counts[t.key]}</span>}
          </button>
        ))}
      </nav>

      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_88px_88px_72px] gap-3 border-b px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid">
          <span>文件</span>
          <span>申请人</span>
          <span>状态</span>
          <span>耗材</span>
          <span>预计</span>
          <span>提交</span>
        </div>
        {all.isPending && <Skeleton className="m-4 h-40" />}
        {all.data && rows.length === 0 && <p className="m-0 p-6 text-sm text-muted-foreground">没有订单</p>}
        <ul className="m-0 list-none p-0">
          {rows.map((o) => {
            const st = ORDER_STATUS[o.status];
            const label = STAFF_STATUS[o.status] ?? st.label;
            return (
              <li key={o.id} className="border-b last:border-b-0">
                <Link to={`/orders/${o.id}`} className="grid gap-x-3 gap-y-2 px-4 py-3 text-inherit no-underline hover:bg-accent/50 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_88px_88px_72px] lg:items-center lg:px-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <OrderThumb url={o.plate.thumbnailUrl} className="size-10 rounded-[10px]" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm leading-5 font-semibold">{o.fileName ?? orderName(o)}</span>
                      <span className="text-xs leading-4 text-muted-foreground">{orderNo(o.number)}</span>
                    </span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <UserAvatar id={o.owner.id ?? o.owner.name} name={o.owner.name} url={o.owner.avatarUrl} size={22} />
                    <span className="truncate">{o.owner.name}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusPill tone={st.tone} label={label} />
                    <span className="truncate text-xs text-muted-foreground">{extra(o)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[13px]">
                    <span className="flex -space-x-1">
                      {o.plate.filaments.slice(0, 3).map((f) => (
                        <i key={f.slot} className="size-3.5 rounded-full shadow-[0_0_0_1.5px_var(--card),inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: f.colour }} />
                      ))}
                    </span>
                    <span className={cn("ml-1")}>{Math.round(o.plate.weightGrams)} g</span>
                  </span>
                  <span className="text-[13px] text-subtle-foreground">{duration(o.plate.printSeconds)}</span>
                  <span className="text-[13px] text-muted-foreground">{dayOrClock(o.submittedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <PrintDialog open={printing} onOpenChange={setPrinting} />
    </ConsolePage>
  );
}
