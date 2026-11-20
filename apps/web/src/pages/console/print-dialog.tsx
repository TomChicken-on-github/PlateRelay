import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, RefreshCw, X } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { OrderThumb } from "@/components/order-thumb";
import { StatusPill } from "@/components/status-pill";
import { printerStatus } from "@/components/printer/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { client, errorText, idem, type Schemas, unwrap } from "@/lib/api";
import { ago, duration } from "@/lib/format";
import { orderName, orderNo } from "@/lib/order-status";
import { type OrderSummary, type PrinterDetail, usePrinters, useQueue } from "@/lib/queries";
import { useDesktop } from "@/lib/use-desktop";
import { cn } from "@/lib/utils";

type Tray = Schemas["Tray"];
type Check = Schemas["MappingCheck"];

/* Reasons offered when the chosen filament differs from the slice; the settings carry the real list. */
const DEFAULT_REASONS = ["该颜色已用完", "相近色可接受", "申请者同意"];

const CHECK_TEXT: Record<Check["rule"], string> = {
  REACH: "喷嘴够不到",
  EMPTY: "料位为空",
  NOZZLE: "喷嘴不匹配",
  DUPLICATE: "料位重复",
  MATERIAL: "材料不同",
  SUB_TYPE: "耗材型号不同",
  COLOUR: "颜色不同",
  REMAINING: "余量不足",
};

const BLOCKER: Record<string, string> = { no_tray_for_filament: "没有能放下这些耗材的料位" };

const hex = (c: string | null | undefined) => (c ?? "").replace("#", "").slice(0, 6);
function colourDistance(a: string, b: string) {
  const [x, y] = [hex(a), hex(b)].map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** What a chosen tray means for a filament of the slice: the checks the server also makes, for a pick made here. */
function checksFor(f: OrderSummary["plate"]["filaments"][number], t: Tray | undefined, taken: Set<string>): Check[] {
  if (!t) return [{ rule: "EMPTY", result: "BLOCK" }];
  const out: Check[] = [];
  if (!t.material) out.push({ rule: "EMPTY", result: "BLOCK" });
  if (taken.has(`${t.unit}:${t.slot}`)) out.push({ rule: "DUPLICATE", result: "BLOCK" });
  if (f.extruder != null && t.extruders.length && !t.extruders.includes(f.extruder)) out.push({ rule: "REACH", result: "BLOCK" });
  if (t.material && t.material !== f.material) out.push({ rule: "MATERIAL", result: "WARN" });
  if (t.colour && colourDistance(t.colour, f.colour) > 60) out.push({ rule: "COLOUR", result: "WARN" });
  if (t.remainingGrams < f.usedGrams) out.push({ rule: "REMAINING", result: "WARN" });
  return out;
}

const idleText = (p: PrinterDetail) => {
  const st = printerStatus(p);
  if (st.key === "available") return `空闲 ${ago(p.stateSince).replace("前", "")}`;
  if (st.key === "clearing") return `${ago(p.stateSince)}打完`;
  const left = p.job?.remainingSeconds;
  return left != null ? `约 ${duration(left)} 后空闲` : "";
};

/** A button that opens a list under it: the order and printer fields. */
function Pick({ label, children, value, disabled }: { label: string; value: ReactNode; children: (close: () => void) => ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        disabled={disabled}
        className="flex min-h-[64px] w-full items-center gap-3 rounded-[14px] bg-muted px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">{value}</span>
        <ChevronDown className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          role="listbox"
          aria-label={label}
          className="z-[60] max-h-[320px] w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-[14px] bg-popover p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.18),0_0_0_1px_var(--border)] outline-none"
        >
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const optionCls = "flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent aria-disabled:opacity-45 aria-disabled:hover:bg-transparent";

function OrderRow({ o, position }: { o: OrderSummary; position?: number }) {
  return (
    <>
      <OrderThumb url={o.plate.thumbnailUrl} className="size-11 rounded-[10px]" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 font-semibold">{o.fileName ?? orderName(o)}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground">
          {o.plate.modelName ?? o.plate.modelId} · {duration(o.plate.printSeconds)} · {Math.round(o.plate.weightGrams)} g
        </span>
        <span className="truncate text-xs leading-4 text-muted-foreground">
          {orderNo(o.number)} · {o.owner.name}
        </span>
      </span>
      {position != null && <span className="shrink-0 text-[13px] font-semibold text-subtle-foreground">第 {position} 位</span>}
    </>
  );
}

function PrinterRow({ p, suggested }: { p: PrinterDetail; suggested: boolean }) {
  const st = printerStatus(p);
  const d = [...new Set(p.nozzles.map((n) => n.diameterMm))].join(" / ");
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{p.name}</span>
          <span className="truncate text-xs text-muted-foreground">{p.modelName}</span>
          {suggested && <span className="h-[18px] shrink-0 rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-primary-foreground">建议</span>}
        </span>
        <span className="text-xs leading-4 text-muted-foreground">{[d && `${d} mm`, idleText(p)].filter(Boolean).join(" · ")}</span>
      </span>
      <StatusPill tone={st.tone} label={st.key === "printing" || st.key === "preparing" ? `工作 · ${st.label}` : st.label} dot={st.dot} />
    </>
  );
}

function trayName(t: Tray) {
  return t.unit < 0 ? "外挂" : t.label;
}

/** The dispatch dialog: pick the order and printer, check the filament mapping, send. */
export function PrintDialog({ open, onOpenChange, orderId }: { open: boolean; onOpenChange: (open: boolean) => void; orderId?: string }) {
  const desktop = useDesktop();
  const qc = useQueryClient();
  const queue = useQueue();
  const printers = usePrinters();
  const suggestions = useQuery({ queryKey: ["orders", "suggestions"], enabled: open, queryFn: () => unwrap(client.GET("/queue/suggestions")) });
  const waiting = useMemo(() => (queue.data ?? []).filter((e) => !e.frozen && e.order.status === "QUEUED"), [queue.data]);
  const [chosenOrder, setChosenOrder] = useState<string | null>(null);
  const [chosenPrinter, setChosenPrinter] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<number, Tray | undefined>>({});
  const [reasons, setReasons] = useState<Record<number, { reason: string | null; visible: boolean }>>({});
  const [bedOk, setBedOk] = useState(false);
  const [step, setStep] = useState(1);

  const entry = waiting.find((e) => e.order.id === (chosenOrder ?? orderId)) ?? waiting[0];
  const order = entry?.order;
  const list = (printers.data ?? []).filter((p) => !p.disabledAt);
  const suggested = suggestions.data?.find((s) => s.orderId === order?.id)?.printerId;
  const free = (p: PrinterDetail) => p.state === "AVAILABLE";
  const printer = list.find((p) => p.id === (chosenPrinter ?? suggested)) ?? list.find(free);

  const options = useQuery({
    queryKey: ["dispatch-options", printer?.id, order?.id],
    enabled: open && !!printer && !!order && free(printer),
    queryFn: () => unwrap(client.GET("/printers/{printerId}/dispatch-options", { params: { path: { printerId: printer!.id }, query: { orderId: order!.id } } })),
  });
  const opt = options.data;

  /* a new proposal replaces the picks */
  useEffect(() => {
    if (!opt) return;
    const next: Record<number, Tray | undefined> = {};
    for (const p of opt.proposal) next[p.entry.sliceSlot] = opt.trays.find((t) => t.unit === p.entry.tray.unit && t.slot === p.entry.tray.slot);
    setPicks(next);
    setReasons({});
    setBedOk(false);
  }, [opt]);
  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

  const filaments = order?.plate.filaments ?? [];
  const taken = new Set<string>();
  const rows = filaments.map((f) => {
    const t = picks[f.slot];
    const mine = new Set(taken);
    if (t) taken.add(`${t.unit}:${t.slot}`);
    return { f, t, checks: checksFor(f, t, mine) };
  });
  const blocked = rows.some((r) => r.checks.some((c) => c.result === "BLOCK"));
  const needReason = rows.some((r) => r.checks.some((c) => c.result === "WARN") && !reasons[r.f.slot]?.reason);
  const bedNeeded = !!opt && (opt.bedType.needsConfirmation || !!opt.bedType.required);
  const bedName = opt?.bedType.required ?? opt?.bedType.reported ?? "";
  const canSend = !!order && !!printer && !!opt && opt.feasible && opt.blockers.length === 0 && !blocked && !needReason && (!bedNeeded || bedOk);

  const send = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/printers/{printerId}/dispatch", {
          params: { path: { printerId: printer!.id }, ...idem() },
          body: {
            orderId: order!.id,
            expectedStatus: "QUEUED",
            expectedState: "AVAILABLE",
            bedType: opt!.bedType.required ?? opt!.bedType.reported ?? null,
            bedTypeMismatchConfirmed: bedOk,
            mapping: rows.map(({ f, t }) => ({
              sliceSlot: f.slot,
              extruder: f.extruder,
              tray: { unit: t!.unit, slot: t!.slot },
              mismatchReason: reasons[f.slot]?.reason ?? null,
              reasonVisibleToApplicant: reasons[f.slot]?.visible ?? true,
            })),
          },
        }),
      ),
    onSuccess: () => {
      for (const k of ["orders", "printers", "overview", "todo"]) void qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
  });

  const orderField = (
    <Section title="订单">
      <Pick label="订单" value={order ? <OrderRow o={order} position={waiting.indexOf(entry!) + 1} /> : <span className="text-sm text-muted-foreground">没有排队中的订单</span>}>
        {(close) =>
          waiting.map((e, i) => (
            <button
              key={e.order.id}
              type="button"
              role="option"
              aria-selected={e.order.id === order?.id}
              className={optionCls}
              onClick={() => (setChosenOrder(e.order.id), setChosenPrinter(null), close())}
            >
              <OrderRow o={e.order} position={i + 1} />
              <span className="grid size-5 shrink-0 place-items-center">{e.order.id === order?.id && <Check className="size-4" aria-hidden="true" />}</span>
            </button>
          ))
        }
      </Pick>
    </Section>
  );

  const printerField = (
    <Section
      title="打印机"
      action={
        <button type="button" aria-label="刷新打印机" onClick={() => void printers.refetch()} className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <RefreshCw className={cn("size-4", printers.isFetching && "animate-spin")} aria-hidden="true" />
        </button>
      }
    >
      <Pick label="打印机" value={printer ? <PrinterRow p={printer} suggested={printer.id === suggested} /> : <span className="text-sm text-muted-foreground">没有可用的打印机</span>}>
        {(close) =>
          list.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === printer?.id}
              aria-disabled={!free(p)}
              className={optionCls}
              onClick={() => {
                if (!free(p)) return;
                setChosenPrinter(p.id);
                close();
              }}
            >
              <PrinterRow p={p} suggested={p.id === suggested} />
              <span className="grid size-5 shrink-0 place-items-center">{p.id === printer?.id && <Check className="size-4" aria-hidden="true" />}</span>
            </button>
          ))
        }
      </Pick>
    </Section>
  );

  const mapField = (
    <Section title="耗材映射">
      {options.isError && <p className="m-0 text-sm text-alert">{errorText(options.error)}</p>}
      {opt && opt.blockers.length > 0 && <p className="m-0 text-sm text-alert">这台打印机现在不能派这一单（{opt.blockers.map((b) => BLOCKER[b.code] ?? b.code).join("、")}）</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map(({ f, t, checks }) => (
          <MapRow
            key={f.slot}
            f={f}
            tray={t}
            checks={checks}
            trays={opt?.trays ?? []}
            nozzles={order?.plate.nozzles ?? []}
            reason={reasons[f.slot]}
            onReason={(r) => setReasons((s) => ({ ...s, [f.slot]: { reason: r.reason, visible: r.visible } }))}
            onPick={(tr) => setPicks((s) => ({ ...s, [f.slot]: tr }))}
          />
        ))}
      </ul>
    </Section>
  );

  const bedField = bedNeeded && (
    <label className="flex items-center gap-2.5 text-sm">
      <Checkbox checked={bedOk} onCheckedChange={(v) => setBedOk(v === true)} />
      <span>
        已确认当前打印机使用 <b className="font-semibold">{bedName}</b>
      </span>
    </label>
  );

  const err = send.error ? errorText(send.error) : null;
  const sendBtn = (
    <Button size="lg" disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
      发送打印
    </Button>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-card text-card-foreground outline-none",
            desktop ? "top-1/2 left-1/2 max-h-[92dvh] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-3xl shadow-[0_20px_50px_rgb(0_0_0/0.25)]" : "inset-x-0 bottom-0 h-[min(530px,92dvh)] rounded-t-3xl",
          )}
        >
          {desktop ? (
            <>
              <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-8 pt-7 pb-4">
                <Dialog.Title className="m-0 text-xl leading-7 font-bold">打印</Dialog.Title>
                {orderField}
                {printerField}
                {mapField}
                {bedField}
              </div>
              <footer className="flex items-center justify-end gap-2.5 px-8 pt-3 pb-6">
                {err && <span className="mr-auto text-[13px] text-alert">{err}</span>}
                <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                {sendBtn}
              </footer>
            </>
          ) : (
            <>
              <span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <div className="mx-5 mt-3 h-1 shrink-0 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(step / 3) * 100}%` }} />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-3">
                <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">
                  打印 <span className="text-sm font-medium text-muted-foreground">{step} / 3</span>
                </Dialog.Title>
                {step === 1 && orderField}
                {step === 2 && printerField}
                {step === 3 && (
                  <>
                    {mapField}
                    {bedField}
                  </>
                )}
                {err && <span className="text-[13px] text-alert">{err}</span>}
              </div>
              <footer className="grid grid-cols-2 gap-2.5 px-5 pt-2 pb-[max(20px,env(safe-area-inset-bottom))]">
                <Button variant="secondary" size="lg" onClick={() => (step === 1 ? onOpenChange(false) : setStep(step - 1))}>
                  {step === 1 ? "取消" : "上一步"}
                </Button>
                {step < 3 ? (
                  <Button size="lg" disabled={step === 1 ? !order : !printer} onClick={() => setStep(step + 1)}>
                    下一步
                  </Button>
                ) : (
                  sendBtn
                )}
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex h-7 items-center justify-between">
        <h3 className="m-0 text-[15px] leading-[22px] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

type Slice = OrderSummary["plate"]["filaments"][number];

/** One filament of the slice: what it asks for, the tray chosen, and how well they fit. */
function MapRow({ f, tray, checks, trays, nozzles, reason, onReason, onPick }: { f: Slice; tray: Tray | undefined; checks: Check[]; trays: Tray[]; nozzles: OrderSummary["plate"]["nozzles"]; reason?: { reason: string | null; visible: boolean }; onReason: (r: { reason: string | null; visible: boolean }) => void; onPick: (t: Tray | undefined) => void }) {
  const [picking, setPicking] = useState(false);
  const warn = checks.some((c) => c.result === "WARN");
  const block = checks.some((c) => c.result === "BLOCK");
  const reasons = useQuery({ queryKey: ["mismatch-reasons"], staleTime: 5 * 60e3, queryFn: () => unwrap(client.GET("/settings")).then((s) => (s.find((x) => x.section === "mapping")?.values as { mismatchReasons?: string[] } | undefined)?.mismatchReasons ?? DEFAULT_REASONS).catch(() => DEFAULT_REASONS) });
  const r = reason ?? { reason: null, visible: true };
  return (
    <li className={cn("flex flex-col gap-2.5 rounded-[14px] p-3 shadow-[inset_0_0_0_1px_var(--border)]", block && "shadow-[inset_0_0_0_1.5px_var(--alert-dot)]", warn && !block && "shadow-[inset_0_0_0_1.5px_var(--wait-dot)]")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <i className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: f.colour }} />
          {f.material}
          <span className="text-xs font-normal text-muted-foreground">
            {nozzles.length > 1 && nozzles.find((n) => n.extruder === f.extruder)?.side ? `${nozzles.find((n) => n.extruder === f.extruder)?.side === "LEFT" ? "左" : "右"}喷嘴 · ` : ""}
            {Math.round(f.usedGrams)} g
          </span>
        </span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="ml-auto inline-flex h-8 items-center gap-2 rounded-full bg-muted px-3 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {tray ? (
            <>
              <i className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: tray.colour ?? "transparent" }} />
              <span className="font-mono">{trayName(tray)}</span>
              <span className="text-muted-foreground">
                {tray.material ?? "空"} · {Math.round(tray.remainingGrams)} g
              </span>
            </>
          ) : (
            "选择料位"
          )}
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
      {checks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {checks.map((c) => (
            <span key={c.rule} className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", c.result === "BLOCK" ? "bg-alert-surface text-alert" : "bg-wait-surface text-wait")}>
              {CHECK_TEXT[c.rule]}
            </span>
          ))}
        </div>
      )}
      {warn && !block && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Popover.Root>
            <Popover.Trigger className="inline-flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-full bg-muted px-3.5 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <span className={cn(!r.reason && "text-muted-foreground")}>{r.reason ?? "请选择原因"}</span>
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} className="z-[60] rounded-[14px] bg-popover p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.18),0_0_0_1px_var(--border)] outline-none">
                {(reasons.data ?? DEFAULT_REASONS).map((x) => (
                  <Popover.Close key={x} className={optionCls} onClick={() => onReason({ ...r, reason: x })}>
                    {x}
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <label className="flex items-center gap-2 text-[13px]">
            选手可见
            <button
              type="button"
              role="switch"
              aria-checked={r.visible}
              onClick={() => onReason({ ...r, visible: !r.visible })}
              className="relative h-5 w-9 rounded-full bg-input outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:bg-primary"
            >
              <i className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-card transition-transform", r.visible && "translate-x-4")} />
            </button>
          </label>
        </div>
      )}
      <TrayPicker open={picking} onOpenChange={setPicking} f={f} trays={trays} current={tray} onPick={(t) => (onPick(t), setPicking(false))} />
    </li>
  );
}

/** Choose a tray: the printer's trays grouped by AMS unit, with what is loaded and how much is left. */
function TrayPicker({ open, onOpenChange, f, trays, current, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; f: Slice; trays: Tray[]; current: Tray | undefined; onPick: (t: Tray) => void }) {
  const groups = new Map<number, Tray[]>();
  for (const t of trays) groups.set(t.unit, [...(groups.get(t.unit) ?? []), t]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-[70] flex max-h-[85dvh] w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[20px] bg-card p-5 shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">选择耗材</Dialog.Title>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <i className="size-3 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: f.colour }} />
                {f.material} · {Math.round(f.usedGrams)} g
              </span>
            </div>
            <Dialog.Close aria-label="关闭" className="grid size-8 place-items-center rounded-full outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <X className="size-[18px]" />
            </Dialog.Close>
          </div>
          {[...groups].map(([unit, ts]) => (
            <div key={unit} className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{unit < 0 ? "外挂" : `AMS ${ts[0].label.replace(/\d+$/, "") || unit + 1}`}</span>
              <div className="grid grid-cols-2 gap-2">
                {ts.map((t) => {
                  const empty = !t.material;
                  const sel = current?.unit === t.unit && current.slot === t.slot;
                  return (
                    <button
                      key={`${t.unit}:${t.slot}`}
                      type="button"
                      disabled={empty}
                      aria-pressed={sel}
                      onClick={() => onPick(t)}
                      className={cn("flex items-center gap-2.5 rounded-xl p-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-45", sel ? "shadow-[inset_0_0_0_2px_var(--foreground)]" : "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent")}
                    >
                      <i className="size-6 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: t.colour ?? "transparent" }} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] leading-[18px] font-semibold">{t.material ?? "空"}</span>
                        <span className="text-xs leading-4 text-muted-foreground">
                          <span className="font-mono">{trayName(t)}</span>
                          {!empty && ` · ${Math.round(t.remainingGrams)} g`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
