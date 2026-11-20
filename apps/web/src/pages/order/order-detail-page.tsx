import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, Download, FilePen, QrCode, Scissors, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { OrderThumb } from "@/components/order-thumb";
import { PrinterCard } from "@/components/printer/printer-card";
import { StatusPill } from "@/components/status-pill";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { API_PREFIX } from "@platerelay/shared/api";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { duration, shortDateTime, waitRange } from "@/lib/format";
import { ORDER_STATUS, orderName, orderNo } from "@/lib/order-status";
import { type OrderDetail, useOrder, useOverview } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PickupDialog } from "../orders/pickup-dialog";
import { CancelSheet, ReviseSheet, SkipSheet } from "./sheets";
import { Timeline } from "./timeline";

const COLOUR_PREF = { EXACT: "一致", SIMILAR: "相近", ANY: "无所谓" } as const;

/** One order. Phone: one column. Desktop: status, file and form on the left (440), the timeline on the right. */
export function OrderDetailPage() {
  const { id } = useParams();
  const q = useOrder(id);
  const navigate = useNavigate();
  const back = () => (history.length > 1 ? navigate(-1) : navigate("/orders"));

  if (q.isPending) return <Skeleton className="h-[480px] rounded-2xl bg-card" />;
  if (!q.data)
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert>{errorText(q.error)}</Alert>
        <Button variant="secondary" asChild>
          <Link to="/orders">我的订单</Link>
        </Button>
      </div>
    );
  return <Detail order={q.data} onBack={back} />;
}

type SheetKind = "cancel" | "revise" | "skip" | "pickup" | null;

function Detail({ order: o, onBack }: { order: OrderDetail; onBack: () => void }) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const st = ORDER_STATUS[o.status];
  const revising = o.status === "PENDING_REVIEW" && !!o.pendingVersion && !!o.queue;
  const label = revising ? "修改审核中" : st.label;
  const can = (op: string) => o.actions.includes(op);

  const left = (
    <>
      <StatusBlock order={o} revising={revising} onSkip={() => setSheet("skip")} onPickup={() => setSheet("pickup")} />
      <Section title="文件">
        <FileCard order={o} onRevise={() => setSheet("revise")} />
      </Section>
      <Section title="申请信息">
        <Answers order={o} />
      </Section>
      {can("cancelOrder") && (
        <Button variant="card" className="h-11 text-[15px] text-alert" onClick={() => setSheet("cancel")}>
          取消订单
        </Button>
      )}
    </>
  );

  return (
    <>
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <button type="button" aria-label="返回" onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-full bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ArrowLeft className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="m-0 text-[22px] leading-[30px] font-bold [overflow-wrap:anywhere] lg:text-[26px] lg:leading-[34px]">{orderName(o)}</h1>
            <span className="text-[13px] text-muted-foreground">
              {orderNo(o.number)} · {shortDateTime(o.submittedAt)} 提交
            </span>
          </div>
          <StatusPill tone={st.tone} label={label} className="mt-0.5 h-[26px] px-2.5 text-[13px]" />
        </div>
      </header>

      {/* phone */}
      <div className="flex flex-col gap-6 lg:hidden">
        <StatusBlock order={o} revising={revising} onSkip={() => setSheet("skip")} onPickup={() => setSheet("pickup")} />
        <Section title="进度">
          <Timeline order={o} />
        </Section>
        <Section title="文件">
          <FileCard order={o} onRevise={() => setSheet("revise")} />
        </Section>
        <Section title="申请信息">
          <Answers order={o} />
        </Section>
        {can("cancelOrder") && (
          <Button variant="card" className="h-11 text-[15px] text-alert" onClick={() => setSheet("cancel")}>
            取消订单
          </Button>
        )}
      </div>

      {/* desktop */}
      <div className="hidden items-start gap-8 lg:grid lg:grid-cols-[440px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">{left}</div>
        <Timeline order={o} />
      </div>

      <CancelSheet order={o} open={sheet === "cancel"} onOpenChange={(v) => setSheet(v ? "cancel" : null)} />
      <ReviseSheet order={o} open={sheet === "revise"} onOpenChange={(v) => setSheet(v ? "revise" : null)} />
      <SkipSheet order={o} open={sheet === "skip"} onOpenChange={(v) => setSheet(v ? "skip" : null)} />
      {sheet === "pickup" && <PickupDialog orderId={o.id} name={orderName(o)} slot={o.storage?.slot} open onOpenChange={(v) => !v && setSheet(null)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 px-1 text-[15px] leading-[22px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** The block under the header: the printer while printing, the slot when ready, the place in the queue. */
function StatusBlock({ order: o, revising, onSkip, onPickup }: { order: OrderDetail; revising: boolean; onSkip: () => void; onPickup: () => void }) {
  const overview = useOverview();
  if (o.status === "PRINTING" || o.status === "DISPATCHED") {
    const printer = overview.data?.printers.find((p) => p.id === o.printer?.id);
    return (
      <div className="flex flex-col gap-2.5">
        {printer ? <PrinterCard printer={printer} /> : <Skeleton className="h-[240px] rounded-2xl bg-card" />}
        {o.status === "PRINTING" &&
          (o.parts ? (
            o.actions.includes("skipParts") && (
              <Button variant="card" className="h-11 text-[15px]" onClick={onSkip}>
                <Scissors className="size-[18px]" aria-hidden="true" />
                跳过零件
              </Button>
            )
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Button variant="card" disabled className="h-11 w-full bg-transparent text-[15px] text-faint opacity-100">
                <Scissors className="size-[18px]" aria-hidden="true" />
                跳过零件
              </Button>
              <span className="text-xs leading-[18px] text-muted-foreground">此文件切片时未启用对象标签，不支持跳过零件</span>
            </div>
          ))}
      </div>
    );
  }
  if (o.status === "READY" && o.storage)
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-card px-4 pt-5 pb-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-muted-foreground">存放位置</span>
          <span className="text-[32px] leading-[38px] font-bold tracking-[-0.5px]">{o.storage.slot}</span>
        </div>
        {o.actions.includes("issuePickupCode") && (
          <Button size="lg" onClick={onPickup}>
            <QrCode className="size-[18px]" aria-hidden="true" />
            出示取件码
          </Button>
        )}
      </div>
    );
  if ((o.status === "QUEUED" || revising) && o.queue)
    return (
      <div className="flex items-end justify-between gap-3 rounded-2xl bg-card px-4 py-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-muted-foreground">排队位置</span>
          <span className="text-[32px] leading-[38px] font-bold tracking-[-0.5px]">第 {o.queue.position} 位</span>
        </div>
        <span className="text-right text-[13px] leading-5 text-muted-foreground">
          {revising ? "保留原排队位置" : o.queue.wait ? `预计等待 ${waitRange(o.queue.wait.minSeconds, o.queue.wait.maxSeconds)}` : ""}
        </span>
      </div>
    );
  return null;
}

const VERSION_CHIP: Record<OrderDetail["activeVersion"]["state"], string> = { PENDING: "审核中", APPROVED: "已通过", REJECTED: "已驳回", WITHDRAWN: "已撤回", REPLACED: "已替换" };

function FileCard({ order: o, onRevise }: { order: OrderDetail; onRevise: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const p = o.activeVersion.plate;
  const file = (n: number) => `${API_PREFIX}/orders/${o.id}/versions/${n}/file`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["order", o.id] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const withdraw = useMutation({
    mutationFn: () => unwrap(client.POST("/orders/{orderId}/versions/withdraw", { params: { path: { orderId: o.id }, ...idem() }, body: { expectedStatus: o.status, versionId: o.pendingVersion!.id } })),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (n: number) => unwrap(client.POST("/orders/{orderId}/versions/{n}/restore", { params: { path: { orderId: o.id, n }, ...idem() }, body: { expectedStatus: o.status } })),
    onSuccess: refresh,
  });
  const versions = [...o.versions].sort((a, b) => b.n - a.n);
  const nozzle = [...new Set(p.nozzles.map((n) => n.diameterMm))].join(" / ");

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl bg-card p-4">
      <div className="flex items-center gap-3">
        <OrderThumb url={p.thumbnailUrl} className="size-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm leading-5 font-medium [overflow-wrap:anywhere]">{o.activeVersion.fileName ?? o.fileName}</span>
          <span className="text-[13px] leading-[18px] text-muted-foreground">第 {p.index} 盘</span>
        </div>
        {o.activeVersion.fileAvailable && (
          <Button variant="secondary" size="icon" aria-label="下载文件" asChild>
            <a href={file(o.activeVersion.n)} download>
              <Download className="size-5" />
            </a>
          </Button>
        )}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {[
          ["机型", p.modelName ?? p.modelId],
          ["喷嘴", `${nozzle} mm`],
          ["预计时长", duration(p.printSeconds)],
          ["耗材用量", `${Math.round(p.weightGrams)} g`],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="m-0 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {p.filaments.map((f) => (
          <span key={f.slot} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted pr-2.5 pl-1.5 text-[13px] font-medium">
            <i className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: f.colour }} />
            {f.material}
          </span>
        ))}
      </div>

      {versions.length > 1 && (
        <div className="-mx-4 flex flex-col shadow-[inset_0_1px_0_var(--border)]">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-12 items-center gap-2 px-4 text-left text-sm font-medium">
            版本记录
            <span className="flex-1 font-normal text-muted-foreground">共 {versions.length} 版</span>
            {open ? <ChevronUp className="size-[18px] text-faint" /> : <ChevronDown className="size-[18px] text-faint" />}
          </button>
          {open && (
            <ul className="m-0 flex list-none flex-col p-0">
              {versions.map((v) => {
                const current = v.id === o.activeVersion.id;
                const reviewing = v.id === o.pendingVersion?.id;
                return (
                  <li key={v.id} className="flex items-center gap-3 py-2.5 pr-2 pl-4 shadow-[inset_0_1px_0_var(--border)]">
                    <OrderThumb url={v.plate.thumbnailUrl} className="size-11 rounded-[10px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-sm leading-5 font-semibold">
                        第 {v.n} 版
                        <span className={cn("h-5 rounded-full px-[7px] text-xs leading-5 font-medium", current ? "bg-primary text-primary-foreground" : reviewing ? "bg-busy-surface text-busy" : "bg-muted text-muted-foreground")}>
                          {current ? "当前" : VERSION_CHIP[v.state]}
                        </span>
                      </span>
                      {v.fileName && <span className="truncate text-xs leading-[18px] text-muted-foreground">{v.fileName}</span>}
                      <span className="text-xs leading-[18px] text-faint">
                        {shortDateTime(v.createdAt)} · {duration(v.plate.printSeconds)}
                      </span>
                    </div>
                    {o.actions.includes("restoreVersion") && !current && v.state === "APPROVED" && (
                      <Button variant="secondary" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(v.n)}>
                        恢复
                      </Button>
                    )}
                    {v.fileAvailable && (
                      <Button variant="ghost" size="icon-sm" aria-label={`下载第 ${v.n} 版`} asChild>
                        <a href={file(v.n)} download>
                          <Download className="size-[18px]" />
                        </a>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {(withdraw.error || restore.error) && <Alert>{errorText(withdraw.error ?? restore.error)}</Alert>}
      {o.actions.includes("withdrawRevision") && (
        <Button variant="card" className="h-11 text-[15px]" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
          <Undo2 className="size-[18px]" aria-hidden="true" />
          撤回修改
        </Button>
      )}
      {o.actions.includes("reviseOrder") && !o.actions.includes("withdrawRevision") && (
        <Button variant="card" className="h-11 text-[15px]" onClick={onRevise}>
          <FilePen className="size-[18px]" aria-hidden="true" />
          修改文件
        </Button>
      )}
    </div>
  );
}

function Answers({ order: o }: { order: OrderDetail }) {
  const rows: [string, string][] = [
    ...(o.answers ?? []).filter((a) => a.value != null && a.value !== "").map((a): [string, string] => [a.label, Array.isArray(a.value) ? a.value.join("、") : String(a.value)]),
    ["颜色要求", COLOUR_PREF[o.colourPref]],
    ["打印板", o.bedType ?? "按切片"],
  ];
  return (
    <dl className="m-0 flex flex-col rounded-2xl bg-card">
      {rows.map(([k, v], i) => (
        <div key={k} className={cn("grid grid-cols-[80px_minmax(0,1fr)] gap-3 px-4 py-3", i && "shadow-[inset_0_1px_0_var(--border)]")}>
          <dt className="text-[13px] leading-5 text-muted-foreground">{k}</dt>
          <dd className="m-0 text-sm leading-5 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
