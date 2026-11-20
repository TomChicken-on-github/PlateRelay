import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { printerStatus } from "@/components/printer/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { ago, clock } from "@/lib/format";
import { orderNo } from "@/lib/order-status";
import { type PrinterDetail, usePrinters } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";

const TABS = [
  { key: "all", label: "全部" },
  { key: "available", label: "可用" },
  { key: "working", label: "工作" },
  { key: "attention", label: "异常" },
  { key: "clearing", label: "待清板" },
] as const;

type Group = (typeof TABS)[number]["key"];
const groupOf = (p: PrinterDetail): Group => (p.state === "AVAILABLE" ? "available" : p.state === "WORKING" ? "working" : p.state === "ATTENTION" ? "attention" : "clearing");
const busy = (p: PrinterDetail) => p.state === "WORKING" && !p.externalRunning && ["PREPARING", "PRINTING", "TRANSFERRING"].includes(p.job?.phase ?? "PREPARING");
const underMaintenance = (p: PrinterDetail) => (p.reasons ?? []).includes("MAINTENANCE");

/** "0.4 × 2" for two nozzles of the same size, "0.4 / 0.6" for mixed ones. */
export function nozzleText(p: Pick<PrinterDetail, "nozzles">) {
  const by = new Map<number, number>();
  for (const n of p.nozzles) by.set(n.diameterMm, (by.get(n.diameterMm) ?? 0) + 1);
  return [...by].map(([d, c]) => (c > 1 ? `${d} × ${c}` : `${d}`)).join(" / ") || "—";
}

/** One line under the status: why it is not fine, or where the last report was. */
export function statusNote(p: PrinterDetail) {
  const st = printerStatus(p);
  if (st.key === "offline") return p.lastReportAt ? `最后在线 ${clock(p.lastReportAt)}` : "";
  if (st.key === "maintenance") return p.maintenanceReason ?? "";
  if (st.key === "paused" && p.pauseReason === "RUNOUT") return "断料";
  return p.activeErrors[0]?.message ?? "";
}

/** The management view of every printer: a table with status tabs and a bar for acting on several at once. */
export function ConsolePrinters() {
  const me = useMe();
  const q = usePrinters();
  const [tab, setTab] = useState<Group>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"maintain" | "delete" | null>(null);
  const all = useMemo(() => (q.data ?? []).filter((p) => !p.disabledAt), [q.data]);
  const counts = (k: Group) => all.filter((p) => k === "all" || groupOf(p) === k).length;
  const rows = all.filter((p) => tab === "all" || groupOf(p) === tab);
  const picked = all.filter((p) => sel.has(p.id));
  const manage = can(me, "printer:manage");
  const maintain = can(me, "printer:maintenance");
  const anyBusy = picked.some(busy);
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const allOn = rows.length > 0 && rows.every((p) => sel.has(p.id));

  return (
    <ConsolePage title="打印机">
      <nav aria-label="打印机状态" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => setTab(t.key)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-muted-foreground outline-none hover:bg-card/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
          >
            {t.label}
            {t.key !== "all" && counts(t.key) > 0 && <span className="text-xs font-semibold text-muted-foreground">{counts(t.key)}</span>}
          </button>
        ))}
      </nav>

      {picked.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5">
          <span className="mr-auto text-sm font-semibold">已选 {picked.length} 台</span>
          {maintain && (
            <>
              <Button variant="card" size="sm" disabled={anyBusy} onClick={() => setDialog("maintain")}>
                设为维护
              </Button>
              <BatchExit picked={picked.filter(underMaintenance)} onDone={() => setSel(new Set())} />
            </>
          )}
          {manage && (
            <Button variant="destructive" size="sm" disabled={anyBusy} onClick={() => setDialog("delete")}>
              删除
            </Button>
          )}
        </div>
      )}

      <div className="hidden overflow-hidden rounded-2xl bg-card lg:block">
        <div className="grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.8fr)_96px_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-3 border-b px-5 py-3 text-xs font-semibold text-muted-foreground">
          <Checkbox aria-label="全选" checked={allOn} onCheckedChange={() => setSel(allOn ? new Set() : new Set(rows.map((p) => p.id)))} />
          <span>名称</span>
          <span>状态</span>
          <span>当前订单</span>
          <span>喷嘴口径</span>
          <span>IP</span>
          <span>最后在线</span>
        </div>
        {q.isPending && <Skeleton className="m-4 h-40" />}
        <ul className="m-0 list-none p-0">
          {rows.map((p) => {
            const st = printerStatus(p);
            const note = statusNote(p);
            return (
              <li key={p.id} className="relative grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.8fr)_96px_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-3 border-b px-5 py-3 last:border-b-0 hover:bg-accent/50">
                <Checkbox aria-label={`选择 ${p.name}`} checked={sel.has(p.id)} onCheckedChange={() => toggle(p.id)} className="relative z-10" />
                <Link to={`/console/printers/${p.id}`} className="flex min-w-0 flex-col text-inherit no-underline after:absolute after:inset-0 after:content-['']">
                  <span className="font-mono text-sm leading-5 font-semibold">{p.name}</span>
                  <span className="truncate text-xs leading-4 text-muted-foreground">{p.modelName}</span>
                </Link>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <StatusPill tone={st.tone} label={st.label} dot={st.dot} />
                  {note && <span className="max-w-full truncate text-xs text-muted-foreground">{note}</span>}
                </span>
                <span className="flex min-w-0 flex-col">
                  {p.job ? (
                    <>
                      <span className="truncate text-[13px] leading-5">{p.job.fileName}</span>
                      <span className="truncate text-xs leading-4 text-muted-foreground">
                        {p.job.orderNumber != null && orderNo(p.job.orderNumber)}
                        {p.job.owner && ` · ${p.job.owner.name}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </span>
                <span className="text-[13px]">{nozzleText(p)}</span>
                <span className="truncate font-mono text-[13px]">{p.host}</span>
                <span className="text-[13px] text-muted-foreground">{p.lastReportAt ? ago(p.lastReportAt) : "—"}</span>
              </li>
            );
          })}
        </ul>
        {q.data && rows.length === 0 && <p className="m-0 p-6 text-sm text-muted-foreground">没有打印机</p>}
      </div>

      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 lg:hidden">
        {q.isPending && <Skeleton className="h-24 rounded-2xl bg-card" />}
        {rows.map((p) => {
          const st = printerStatus(p);
          return (
            <li key={p.id}>
              <Link to={`/console/printers/${p.id}`} className="flex flex-col gap-2 rounded-2xl bg-card p-4 text-inherit no-underline">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[15px] font-semibold">{p.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.modelName}</span>
                  <StatusPill tone={st.tone} label={st.label} dot={st.dot} />
                </span>
                <span className="truncate text-[13px] text-subtle-foreground">{p.job ? `${p.job.fileName}${p.job.orderNumber != null ? ` · ${orderNo(p.job.orderNumber)}` : ""}` : (statusNote(p) || "—")}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {dialog === "maintain" && <MaintainDialog picked={picked} onClose={() => (setDialog(null), setSel(new Set()))} />}
      {dialog === "delete" && <DeleteDialog picked={picked} onClose={() => (setDialog(null), setSel(new Set()))} />}
    </ConsolePage>
  );
}

function useRefreshPrinters() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["printers", "overview", "todo"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

function BatchExit({ picked, onDone }: { picked: PrinterDetail[]; onDone: () => void }) {
  const refresh = useRefreshPrinters();
  const run = useMutation({
    mutationFn: () => Promise.all(picked.map((p) => unwrap(client.POST("/printers/{printerId}/maintenance/exit", { params: { path: { printerId: p.id }, ...idem() }, body: { expectedState: "ATTENTION" } })))),
    onSuccess: () => (refresh(), onDone()),
  });
  return (
    <Button variant="card" size="sm" disabled={picked.length === 0 || run.isPending} onClick={() => run.mutate()}>
      结束维护
    </Button>
  );
}

function MaintainDialog({ picked, onClose }: { picked: PrinterDetail[]; onClose: () => void }) {
  const refresh = useRefreshPrinters();
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => Promise.all(picked.map((p) => unwrap(client.POST("/printers/{printerId}/maintenance/enter", { params: { path: { printerId: p.id }, ...idem() }, body: { expectedState: p.state, reason: reason.trim() } })))),
    onSuccess: () => (refresh(), onClose()),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="设为维护"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!reason.trim() || run.isPending} onClick={() => run.mutate()}>
            确认
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        原因
        <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      {run.error && <span className="text-[13px] text-alert">{errorText(run.error)}</span>}
    </Modal>
  );
}

function DeleteDialog({ picked, onClose }: { picked: PrinterDetail[]; onClose: () => void }) {
  const refresh = useRefreshPrinters();
  const run = useMutation({
    mutationFn: () => Promise.all(picked.map((p) => unwrap(client.DELETE("/printers/{printerId}", { params: { path: { printerId: p.id }, ...idem() }, body: { version: p.version } })))),
    onSuccess: () => (refresh(), onClose()),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={picked.length === 1 ? `删除 ${picked[0].name}？` : `删除 ${picked.length} 台打印机？`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={run.isPending} onClick={() => run.mutate()}>
            删除
          </Button>
        </>
      }
    >
      {run.error && <span className={cn("text-[13px] text-alert")}>{errorText(run.error)}</span>}
    </Modal>
  );
}
