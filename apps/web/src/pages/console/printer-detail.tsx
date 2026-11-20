import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Pencil, Play, Square, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CameraView } from "@/components/printer/camera-view";
import { LiveDialog } from "@/components/printer/live-dialog";
import { printerStatus, TONE } from "@/components/printer/status";
import { BedIcon, ChamberIcon, NozzleIcon } from "@/components/printer/temp-icons";
import { OrderThumb } from "@/components/order-thumb";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { client, errorText, idem, type Schemas, unwrap } from "@/lib/api";
import { ago, clock, duration, shortDateTime } from "@/lib/format";
import { orderNo } from "@/lib/order-status";
import { type PrinterDetail, useAllOrders, useOrder, usePrinter } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";
import { nozzleText } from "./printers";
import { controlOf, DryDialog, FanDialog, SpeedDialog, StopDialog, TempDialog, TrayDialog, trayName, unitName, useControl } from "./printer-dialogs";
import { StoreDialog } from "./store-dialog";

type Tray = Schemas["Tray"];

const card = "flex flex-col gap-3.5 rounded-2xl bg-card p-5";
const h2 = "m-0 text-[15px] leading-[22px] font-semibold";

/** One printer, all of it: camera, the job, what needs doing, device state and the filament trays. */
export function ConsolePrinterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const q = usePrinter(id);
  const p = q.data;
  const [live, setLive] = useState(false);
  const [dialog, setDialog] = useState<null | "stop" | "store" | "speed" | "fan" | { temp: string } | { tray: Tray } | { dry: number }>(null);
  const stored = useAllOrders({ status: "PRINTED", limit: 100 });
  const ready = useAllOrders({ status: "READY", limit: 200 });
  const readyDetails = ready.data?.items ?? [];
  const waitingStore = (stored.data?.items ?? []).find((o) => o.printer?.id === id);
  const qc = useQueryClient();
  const resume = useControl(id ?? "", () => {});
  const clear = useMutation({
    mutationFn: () => unwrap(client.POST("/printers/{printerId}/clear-bed", { params: { path: { printerId: id! }, ...idem() }, body: { expectedState: "CLEARING_REQUIRED" } })),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ["printers"] }), void qc.invalidateQueries({ queryKey: ["overview"] }), void qc.invalidateQueries({ queryKey: ["todo"] })),
  });

  if (q.isPending) return <ConsolePage title={<Skeleton className="h-9 w-40" />}><Skeleton className="h-[400px] rounded-2xl bg-card" /></ConsolePage>;
  if (!p) return <ConsolePage title="打印机"><p className="text-sm text-muted-foreground">找不到这台打印机</p></ConsolePage>;

  const st = printerStatus(p);
  const job = p.job;
  const hasJob = !!job && !job.external && job.jobId != null;
  const errorsWithActions = p.activeErrors.some((e) => e.actions.length > 0);
  const resumeSpec = controlOf(p, "resume");
  const showResume = st.key === "paused" && !!resumeSpec?.enabled && !errorsWithActions && can(me, "printer:control");
  const showStop = (hasJob || (job && job.external)) && can(me, "printer:stop");
  const ctrl = (c: Schemas["ControlSpec"]["category"]) => can(me, "printer:control") && p.controls.some((x) => x.category === c);
  const printing = st.key === "printing" || st.key === "preparing" || st.key === "paused";
  const mayOccupy = st.key === "clearing";
  const occupiedSlots = new Map<string, string>();
  void readyDetails;

  const headerActions = (
    <>
      {showResume && (
        <Button disabled={resume.isPending} onClick={() => resume.mutate({ action: resumeSpec!.action, args: {} })}>
          <Play className="fill-current" aria-hidden="true" />
          继续
        </Button>
      )}
      {mayOccupy && can(me, "order:store") && (waitingStore ? <Button onClick={() => setDialog("store")}>铲件入库</Button> : <Button disabled={clear.isPending} onClick={() => clear.mutate()}>已清板</Button>)}
      {showStop && (
        <Button variant="outline" className="border-0 text-alert shadow-[inset_0_0_0_1px_var(--alert-dot)] hover:bg-alert-surface" onClick={() => setDialog("stop")}>
          <Square className="fill-current" aria-hidden="true" />
          停止
        </Button>
      )}
    </>
  );

  return (
    <ConsolePage
      title={
        <span className="flex items-center gap-3">
          <button type="button" aria-label="返回打印机列表" onClick={() => navigate("/console/printers")} className="-ml-2 grid size-10 place-items-center rounded-full outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ArrowLeft className="size-5" />
          </button>
          <span className="font-mono">{p.name}</span>
        </span>
      }
      sub={
        <span className="flex items-center gap-2.5">
          <span className="max-lg:hidden">{p.modelName}</span>
          <StatusPill tone={st.tone} label={st.label} dot={st.dot} />
        </span>
      }
      actions={<span className="hidden lg:contents">{headerActions}</span>}
      className="mx-auto w-full max-w-[1100px] flex-none"
    >
      <div className="grid gap-2.5 lg:hidden [&>*]:w-full [&>button]:flex-1" style={{ gridTemplateColumns: `repeat(${[showResume, showStop, mayOccupy].filter(Boolean).length || 1}, minmax(0, 1fr))` }}>
        {headerActions}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <div className="relative">
            <CameraView printerId={p.id} name={p.name} modelName={p.modelName} snapshotAt={st.key === "offline" || p.camera.stream === "none" ? null : p.camera.snapshotAt} onLive={st.key === "offline" || p.camera.stream === "none" ? undefined : () => setLive(true)} always className="aspect-video rounded-2xl" />
            {live && <LiveDialog printerId={p.id} name={p.name} modelName={p.modelName} snapshotAt={p.camera.snapshotAt} open onOpenChange={setLive} />}
          </div>
          {job && <Progress p={p} />}
          <div className="contents lg:hidden">
            <Attention p={p} />
            <DeviceState p={p} ctrl={ctrl} onEdit={setDialog} />
            <Ams p={p} printing={printing} canEdit={can(me, "filament:catalog")} canDry={ctrl("dry")} onTray={(t) => setDialog({ tray: t })} onDry={(u) => setDialog({ dry: u })} />
          </div>
          <Logs id={p.id} />
          <Info p={p} />
        </div>
        <div className="hidden min-w-0 flex-col gap-4 lg:order-2 lg:flex">
          <Attention p={p} />
          <DeviceState p={p} ctrl={ctrl} onEdit={setDialog} />
          <Ams p={p} printing={printing} canEdit={can(me, "filament:catalog")} canDry={ctrl("dry")} onTray={(t) => setDialog({ tray: t })} onDry={(u) => setDialog({ dry: u })} />
        </div>
      </div>

      {dialog === "stop" && <StopDialog printer={p} onClose={() => setDialog(null)} />}
      {dialog === "store" && waitingStore && <StoreDialog order={waitingStore} open onOpenChange={(o) => !o && setDialog(null)} occupied={occupiedSlots} />}
      {dialog === "speed" && <SpeedDialog printer={p} onClose={() => setDialog(null)} />}
      {dialog === "fan" && <FanDialog printer={p} onClose={() => setDialog(null)} />}
      {typeof dialog === "object" && dialog && "temp" in dialog && <TempDialog printer={p} heater={dialog.temp} label={heaterLabel(dialog.temp)} current={p.temps?.[dialog.temp]?.target ?? null} onClose={() => setDialog(null)} />}
      {typeof dialog === "object" && dialog && "tray" in dialog && <TrayDialog printer={p} tray={dialog.tray} onClose={() => setDialog(null)} />}
      {typeof dialog === "object" && dialog && "dry" in dialog && <DryDialog printer={p} unit={dialog.dry} printing={printing} onClose={() => setDialog(null)} />}
    </ConsolePage>
  );
}

const heaterLabel = (k: string) => (k === "bed" ? "热床" : k === "chamber" ? "腔温" : k.startsWith("nozzle") ? (k === "nozzle" ? "喷嘴" : `喷嘴 ${k.slice(-1)}`) : k);

function Progress({ p }: { p: PrinterDetail }) {
  const job = p.job!;
  const order = useOrder(job.orderId ?? undefined).data;
  const st = printerStatus(p);
  const pct = job.percent ?? 0;
  const layers = job.layer != null && job.totalLayers ? ` · 第 ${job.layer} / ${job.totalLayers} 层` : "";
  return (
    <section className={card}>
      <h2 className={h2}>打印进度</h2>
      <div className="flex items-center gap-3">
        <OrderThumb url={order?.plate.thumbnailUrl} className="size-14 rounded-xl" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-all text-sm leading-5 font-semibold">{job.fileName}</span>
          <span className="text-xs leading-4 text-muted-foreground">
            {[job.owner?.name, job.orderNumber != null && orderNo(job.orderNumber)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-track">
        <div className={cn("h-full rounded-full", TONE[st.tone].dot)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-baseline justify-between text-[13px] text-muted-foreground">
        <span>
          <b className="text-base font-bold text-foreground">{pct}%</b> · {st.label}
          {layers}
        </span>
        {job.remainingSeconds != null && (
          <span>
            剩余 <b className="font-semibold text-foreground">{duration(job.remainingSeconds)}</b>
          </span>
        )}
      </div>
    </section>
  );
}

function Attention({ p }: { p: PrinterDetail }) {
  const qc = useQueryClient();
  const resolve = useMutation({
    mutationFn: (v: { errorId: string; action: string; onSite: boolean }) =>
      unwrap(client.POST("/printers/{printerId}/errors/{errorId}/resolve", { params: { path: { printerId: p.id, errorId: v.errorId }, ...idem() }, body: { action: v.action, onSiteConfirmed: v.onSite } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["printers"] }),
  });
  const items = p.activeErrors;
  if (items.length === 0) return null;
  return (
    <section className={card}>
      <h2 className={h2}>需要处理</h2>
      {items.map((e) => (
        <div key={e.errorId} className="flex flex-col gap-3 rounded-xl bg-alert-surface p-3.5">
          <span className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm leading-5 font-semibold text-alert">{e.message ?? e.vendorCode}</span>
              <span className="text-xs leading-4 text-muted-foreground">
                {[e.vendorCode, ago(e.raisedAt)].join(" · ")}
              </span>
            </span>
          </span>
          {e.actions.length > 0 && (
            <span className="flex flex-wrap gap-2">
              {e.actions.map((a) => (
                <Button key={a.action} size="sm" variant={a.destructive ? "danger" : "default"} disabled={resolve.isPending} onClick={() => resolve.mutate({ errorId: e.errorId, action: a.action, onSite: a.requiresOnSite })}>
                  {a.label}
                </Button>
              ))}
            </span>
          )}
        </div>
      ))}
      {resolve.error && <span className="text-[13px] text-alert">{errorText(resolve.error)}</span>}
    </section>
  );
}

function DeviceState({ p, ctrl, onEdit }: { p: PrinterDetail; ctrl: (c: Schemas["ControlSpec"]["category"]) => boolean; onEdit: (d: "speed" | "fan" | { temp: string }) => void }) {
  const temps = Object.entries(p.temps ?? {}).sort(([a], [b]) => ["nozzle", "nozzle1", "nozzle2", "bed", "chamber"].indexOf(a) - ["nozzle", "nozzle1", "nozzle2", "bed", "chamber"].indexOf(b));
  const light = controlOf(p, "light");
  const onLight = useControl(p.id, () => {});
  return (
    <section className={card}>
      <h2 className={h2}>设备状态</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {temps.map(([k, t]) => {
          const target = t.target ?? null;
          const colour = !target ? "text-muted-foreground" : t.current > target + 2 ? "text-cool" : "text-heat";
          const I = k.startsWith("nozzle") ? NozzleIcon : k === "bed" ? BedIcon : ChamberIcon;
          const editable = ctrl("temperature") && k !== "chamber";
          return (
            <div key={k} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
              <span className={cn("flex", colour)}>
                <I />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs leading-4 text-muted-foreground">{heaterLabel(k)}</span>
                <span className="text-lg leading-6 font-semibold tabular-nums">
                  {Math.round(t.current)}
                  <span className="text-xs font-medium">°C</span>
                  {target ? <span className="text-xs font-normal text-faint"> / {Math.round(target)}°C</span> : null}
                </span>
              </span>
              {editable && (
                <button type="button" aria-label={`修改${heaterLabel(k)}温度`} onClick={() => onEdit({ temp: k })} className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <Pencil className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {(ctrl("speed") || ctrl("fan") || light) && (
        <div className="flex flex-col">
          {ctrl("speed") && (
            <Row label="打印速度" action={<EditBtn label="修改打印速度" onClick={() => onEdit("speed")} />}>
              &nbsp;
            </Row>
          )}
          {light && (
            <Row label="灯光">
              <Segmented label="灯光" value="" onChange={(v) => onLight.mutate({ action: light.action, args: { on: v === "on" } })} options={[{ value: "on", label: "开" }, { value: "off", label: "关" }]} className="w-28" />
            </Row>
          )}
          {ctrl("fan") && (
            <Row label="风扇" action={<EditBtn label="修改风扇" onClick={() => onEdit("fan")} />}>
              &nbsp;
            </Row>
          )}
        </div>
      )}
    </section>
  );
}

const Row = ({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) => (
  <div className="flex min-h-12 items-center gap-3 border-t text-sm first:border-t-0">
    <span className="w-20 text-muted-foreground">{label}</span>
    <span className="flex flex-1 items-center">{children}</span>
    {action}
  </div>
);

const EditBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" aria-label={label} onClick={onClick} className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
    <Pencil className="size-4" />
  </button>
);

const slotName = trayName;

function Ams({ p, printing, canEdit, canDry, onTray, onDry }: { p: PrinterDetail; printing: boolean; canEdit: boolean; canDry: boolean; onTray: (t: Tray) => void; onDry: (unit: number) => void }) {
  void printing;
  const groups = new Map<number, Tray[]>();
  for (const t of p.trays) groups.set(t.unit, [...(groups.get(t.unit) ?? []), t]);
  if (groups.size === 0) return null;
  return (
    <section className={card}>
      <h2 className={h2}>AMS 料盘</h2>
      {[...groups].map(([unit, ts]) => (
        <div key={unit} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">{unitName(unit)}</span>
            {canDry && unit >= 0 && (
              <button type="button" onClick={() => onDry(unit)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                烘干
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ts.map((t) => {
              const empty = !t.material;
              const fill = Math.max(0, Math.min(1, t.remainingGrams / 1000));
              const out = !empty && t.remainingGrams <= 0;
              return (
                <button
                  key={`${t.unit}:${t.slot}`}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onTray(t)}
                  aria-label={`${slotName(t)} ${t.material ?? "空"} ${Math.round(t.remainingGrams)} g`}
                  className="relative flex h-[132px] flex-col overflow-hidden rounded-xl bg-muted text-left outline-none shadow-[inset_0_0_0_1px_var(--input)] focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent"
                >
                  <i className="absolute inset-x-0 bottom-0 opacity-90" style={{ height: `${fill * 100}%`, background: t.colour ?? "transparent" }} />
                  <span className="relative flex h-[30px] items-center justify-between px-2 text-xs font-semibold">
                    <span className="rounded-full bg-card/90 px-1.5 leading-5">{slotName(t)}</span>
                    {t.rfid ? <Eye className="size-3.5 text-foreground/70" aria-hidden="true" /> : canEdit && <Pencil className="size-3.5 text-foreground/70" aria-hidden="true" />}
                  </span>
                  <span className="relative mt-auto m-1.5 flex flex-col rounded-lg bg-card/90 px-1.5 py-1 text-[11px] leading-4">
                    <b className="font-semibold">{t.material ?? "空"}</b>
                    <em className={cn("not-italic", out ? "text-alert" : "text-muted-foreground")}>{empty ? "" : out ? "断料" : `${Math.round(t.remainingGrams)} g`}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

const EVENT: Record<string, string> = { PAUSED: "暂停", RESUMED: "继续", ERROR: "报错", HMS: "打印机告警", CONNECTION_DOWN: "连接中断", CONNECTION_UP: "连接恢复", REFILL: "自动换料" };
const OUTCOME: Record<string, { l: string; tone: "ok" | "alert" | "idle" }> = {
  FINISHED: { l: "已完成", tone: "ok" },
  FAILED: { l: "失败", tone: "alert" },
  SEND_FAILED: { l: "发送失败", tone: "alert" },
  START_FAILED: { l: "没开打", tone: "alert" },
  STOPPED_BEFORE_START: { l: "没开打", tone: "idle" },
};

function Logs({ id }: { id: string }) {
  const [tab, setTab] = useState<"jobs" | "events">("jobs");
  const jobs = useInfiniteQuery({
    queryKey: ["printers", id, "jobs"],
    enabled: tab === "jobs",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(client.GET("/printers/{printerId}/jobs", { params: { path: { printerId: id }, query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const events = useInfiniteQuery({
    queryKey: ["printers", id, "events"],
    enabled: tab === "events",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(client.GET("/printers/{printerId}/events", { params: { path: { printerId: id }, query: pageParam ? { cursor: pageParam } : {} } })),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const cur = tab === "jobs" ? jobs : events;
  return (
    <section className={card}>
      <Segmented label="日志" value={tab} onChange={setTab} options={[{ value: "jobs", label: "打印记录" }, { value: "events", label: "事件日志" }]} className="w-56" />
      {cur.isPending && <Skeleton className="h-24" />}
      <ul className="m-0 flex list-none flex-col p-0">
        {tab === "jobs" &&
          jobs.data?.pages.flatMap((pg) => pg.items).map((j) => {
            const o = j.outcome ? OUTCOME[j.outcome] : null;
            return (
              <li key={j.jobId} className="flex items-center gap-3 border-t py-2.5 first:border-t-0">
                <Link to={`/orders/${j.orderId}`} className="flex min-w-0 flex-1 flex-col text-inherit no-underline">
                  <span className="truncate text-sm leading-5 font-semibold">{orderNo(j.orderNumber)}{j.attempt > 1 ? ` · 第 ${j.attempt} 次` : ""}</span>
                  <span className="truncate text-xs leading-4 text-muted-foreground">{[j.owner?.name, shortDateTime(j.dispatchedAt)].filter(Boolean).join(" · ")}</span>
                </Link>
                {o ? <StatusPill tone={o.tone} label={o.l} /> : <StatusPill tone="busy" label="进行中" />}
              </li>
            );
          })}
        {tab === "events" &&
          events.data?.pages.flatMap((pg) => pg.items).map((e) => (
            <li key={e.id} className="flex items-center gap-3 border-t py-2.5 first:border-t-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm leading-5 font-medium">{EVENT[e.kind] ?? e.kind}</span>
                {typeof (e.data as { message?: string }).message === "string" && <span className="truncate text-xs leading-4 text-muted-foreground">{(e.data as { message: string }).message}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{shortDateTime(e.at)}</span>
            </li>
          ))}
      </ul>
      {cur.data && cur.data.pages.every((pg) => pg.items.length === 0) && <p className="m-0 text-sm text-muted-foreground">暂无记录</p>}
      {cur.hasNextPage && (
        <Button variant="card" size="sm" className="self-start" disabled={cur.isFetchingNextPage} onClick={() => void cur.fetchNextPage()}>
          更多
        </Button>
      )}
    </section>
  );
}

function Info({ p }: { p: PrinterDetail }) {
  const rows: [string, string][] = [
    ["序列号", p.serial],
    ["IP", p.host],
    ["喷嘴口径", nozzleText(p)],
    ["最后上报", p.lastReportAt ? `${clock(p.lastReportAt)}（${ago(p.lastReportAt)}）` : "—"],
  ];
  return (
    <section className={card}>
      <h2 className={h2}>设备信息</h2>
      <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("m-0 truncate", k === "序列号" && "font-mono")}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
