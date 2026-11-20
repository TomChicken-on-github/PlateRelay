import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { client, errorText, idem, type Schemas, unwrap } from "@/lib/api";
import type { PrinterDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Control = Schemas["ControlSpec"];
type Tray = Schemas["Tray"];

/** "A" for AMS unit 0, "B" for 1 ..., "外挂" for the external spool. */
export const unitName = (unit: number) => (unit < 0 ? "外挂" : unit < 26 ? `AMS ${String.fromCharCode(65 + unit)}` : `AMS ${unit}`);
/** A1 ... D4, or Ext. */
export const trayName = (t: Pick<Tray, "unit" | "slot">) => (t.unit < 0 ? "Ext" : `${unit(t.unit)}${t.slot + 1}`);
const unit = (u: number) => (u < 26 ? String.fromCharCode(65 + u) : String(u));

export const controlOf = (p: PrinterDetail, category: Control["category"], action?: string) => p.controls.find((c) => c.category === category && (!action || c.action === action));

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["printers", "overview", "todo", "orders"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Send a device control; the printer's own report brings the new state back. */
export function useControl(printerId: string, onDone: () => void) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { action: string; args: Record<string, unknown> }) => unwrap(client.POST("/printers/{printerId}/control", { params: { path: { printerId }, ...idem() }, body: v })),
    onSuccess: () => (refresh(), onDone()),
  });
}

const footer = (onClose: () => void, ok: { label: string; disabled?: boolean; onClick: () => void }) => (
  <>
    <Button variant="secondary" onClick={onClose}>
      取消
    </Button>
    <Button disabled={ok.disabled} onClick={ok.onClick}>
      {ok.label}
    </Button>
  </>
);

/** A number with − and + buttons. */
export function Stepper({ value, onChange, min, max, step = 1, unit, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; label: string }) {
  const btn = "grid size-10 place-items-center rounded-full bg-muted outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40";
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" aria-label="减少" className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        <Minus className="size-4" />
      </button>
      <span className="min-w-[88px] text-center text-2xl font-bold tabular-nums">
        {value}
        {unit && <span className="text-base font-medium text-muted-foreground">{unit}</span>}
      </span>
      <button type="button" aria-label="增加" className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Target temperature of one heater. The limit is the machine's own, not the filament's. */
export function TempDialog({ printer, heater, label, current, onClose }: { printer: PrinterDetail; heater: string; label: string; current: number | null; onClose: () => void }) {
  const spec = controlOf(printer, "temperature");
  const max = Number((spec?.args as { properties?: Record<string, { maximum?: number }> })?.properties?.target?.maximum ?? (heater === "bed" ? 110 : heater === "chamber" ? 65 : 300));
  const [v, setV] = useState(current ?? 0);
  const send = useControl(printer.id, onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${label}目标温度`} footer={footer(onClose, { label: "确定", disabled: !spec || send.isPending, onClick: () => send.mutate({ action: spec!.action, args: { heater, target: v } }) })}>
      <div className="grid place-items-center py-2">
        <Stepper label={label} value={v} onChange={setV} min={0} max={max} step={5} unit="°C" />
      </div>
      {send.error && <span className="text-[13px] text-alert">{errorText(send.error)}</span>}
    </Modal>
  );
}

const SPEEDS = [
  { v: 1, l: "静音" },
  { v: 2, l: "标准" },
  { v: 3, l: "运动" },
  { v: 4, l: "狂暴" },
];

export function SpeedDialog({ printer, current, onClose }: { printer: PrinterDetail; current?: number; onClose: () => void }) {
  const spec = controlOf(printer, "speed");
  const [v, setV] = useState(current ?? 2);
  const send = useControl(printer.id, onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="打印速度" footer={footer(onClose, { label: "确定", disabled: !spec || send.isPending, onClick: () => send.mutate({ action: spec!.action, args: { level: v } }) })}>
      <div role="radiogroup" aria-label="打印速度" className="grid grid-cols-4 gap-1 rounded-full bg-muted p-[3px]">
        {SPEEDS.map((s) => (
          <button key={s.v} type="button" role="radio" aria-checked={v === s.v} onClick={() => setV(s.v)} className="h-[34px] rounded-full text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:bg-card aria-checked:font-semibold aria-checked:text-foreground aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12)]">
            {s.l}
          </button>
        ))}
      </div>
      {send.error && <span className="text-[13px] text-alert">{errorText(send.error)}</span>}
    </Modal>
  );
}

const FANS = [
  { k: "part", l: "部件" },
  { k: "aux", l: "辅助" },
  { k: "chamber", l: "机箱" },
];

/** Three sliders, 0 to 100 percent. */
export function FanDialog({ printer, onClose }: { printer: PrinterDetail; onClose: () => void }) {
  const spec = controlOf(printer, "fan");
  const [v, setV] = useState<Record<string, number>>({ part: 0, aux: 0, chamber: 0 });
  const send = useControl(printer.id, onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="风扇" footer={footer(onClose, { label: "确定", disabled: !spec || send.isPending, onClick: () => send.mutate({ action: spec!.action, args: { ...v } }) })}>
      <div className="flex flex-col gap-4">
        {FANS.map((f) => (
          <label key={f.k} className="grid grid-cols-[48px_1fr_44px] items-center gap-3 text-sm">
            {f.l}
            <input type="range" min={0} max={100} step={5} value={v[f.k]} onChange={(e) => setV((s) => ({ ...s, [f.k]: +e.target.value }))} className="accent-primary" />
            <span className="text-right font-semibold tabular-nums">{v[f.k]}%</span>
          </label>
        ))}
      </div>
      {send.error && <span className="text-[13px] text-alert">{errorText(send.error)}</span>}
    </Modal>
  );
}

const DRY_MATERIALS = [
  { m: "PLA", t: 45, h: 8 },
  { m: "PETG", t: 65, h: 8 },
  { m: "ABS", t: 80, h: 8 },
  { m: "TPU", t: 70, h: 8 },
];

/** Drying: material presets, then temperature and hours; while printing the heater stays low. */
export function DryDialog({ printer, unit, printing, onClose }: { printer: PrinterDetail; unit: number; printing: boolean; onClose: () => void }) {
  const spec = controlOf(printer, "dry");
  const cap = printing ? 45 : 65;
  const [m, setM] = useState(DRY_MATERIALS[0]);
  const [t, setT] = useState(Math.min(m.t, cap));
  const [h, setH] = useState(m.h);
  const [rotate, setRotate] = useState(!printing);
  const send = useControl(printer.id, onClose);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="烘干" width={440} footer={footer(onClose, { label: "开始烘干", disabled: !spec || send.isPending, onClick: () => send.mutate({ action: spec!.action, args: { unit, temperature: t, hours: h, rotate } }) })}>
      <div className="grid grid-cols-4 gap-1 rounded-full bg-muted p-[3px]" role="radiogroup" aria-label="耗材">
        {DRY_MATERIALS.map((x) => (
          <button key={x.m} type="button" role="radio" aria-checked={m.m === x.m} onClick={() => (setM(x), setT(Math.min(x.t, cap)), setH(x.h))} className="h-[34px] rounded-full text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:bg-card aria-checked:font-semibold aria-checked:text-foreground aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12)]">
            {x.m}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[13px] text-muted-foreground">温度</span>
          <Stepper label="温度" value={t} onChange={setT} min={35} max={cap} step={5} unit="°C" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[13px] text-muted-foreground">时长</span>
          <Stepper label="时长" value={h} onChange={setH} min={1} max={24} unit="h" />
        </div>
      </div>
      <label className={cn("flex items-center gap-2.5 text-sm", printing && "opacity-50")}>
        <Checkbox checked={rotate} disabled={printing} onCheckedChange={(v) => setRotate(v === true)} />
        烘干时转动料盘
      </label>
      {printing && <span className="text-[13px] text-wait">当前正在打印中，为确保打印质量，打印时烘干最高温度为 45°C</span>}
      {send.error && <span className="text-[13px] text-alert">{errorText(send.error)}</span>}
    </Modal>
  );
}

/** Edit what the panel remembers about a tray: the grams left (the printer's own report cannot be written back). */
export function TrayDialog({ printer, tray, onClose }: { printer: PrinterDetail; tray: Tray; onClose: () => void }) {
  const refresh = useRefresh();
  const [g, setG] = useState(String(Math.round(tray.remainingGrams)));
  const save = useMutation({
    mutationFn: () => unwrap(client.PUT("/printers/{printerId}/trays/{unit}/{slot}/grams", { params: { path: { printerId: printer.id, unit: tray.unit, slot: tray.slot }, ...idem() }, body: { grams: Math.max(0, Math.min(10000, Math.round(Number(g)))) } })),
    onSuccess: () => (refresh(), onClose()),
  });
  const ok = g !== "" && Number.isFinite(Number(g));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${trayName(tray)} 料位`} width={440} footer={footer(onClose, { label: "保存", disabled: !ok || save.isPending, onClick: () => save.mutate() })}>
      <dl className="m-0 grid grid-cols-[72px_1fr] gap-x-3 gap-y-3 text-sm">
        <dt className="text-muted-foreground">耗材</dt>
        <dd className="m-0 flex items-center gap-2">
          <i className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: tray.colour ?? "transparent" }} />
          {[tray.material, tray.subType].filter(Boolean).join(" ") || "空"}
        </dd>
        {tray.serial && (
          <>
            <dt className="text-muted-foreground">序列号</dt>
            <dd className="m-0 font-mono">{tray.serial}</dd>
          </>
        )}
      </dl>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        剩余克数
        <Input inputMode="numeric" value={g} onChange={(e) => setG(e.target.value.replace(/\D/g, ""))} className="h-11" />
      </label>
      {save.error && <span className="text-[13px] text-alert">{errorText(save.error)}</span>}
    </Modal>
  );
}

const STOP_REASONS = ["打印出现问题", "现场需要停止", "选手要求"];

/** Stop the print: a reason is required, and whether the applicant can see it. */
export function StopDialog({ printer, onClose }: { printer: PrinterDetail; onClose: () => void }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState(STOP_REASONS[0]);
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(true);
  const stop = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/printers/{printerId}/stop", {
          params: { path: { printerId: printer.id }, ...idem() },
          body: { expectedState: printer.state, ...(printer.job?.jobId ? { expectedJobId: printer.job.jobId } : {}), reason: note.trim() ? `${reason}：${note.trim()}` : reason, reasonVisible: visible },
        }),
      ),
    onSuccess: () => (refresh(), onClose()),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`停止 ${printer.name} 的打印？`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            停止打印
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="原因">
        {STOP_REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className="h-8 rounded-full bg-muted px-3.5 text-[13px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:bg-primary aria-checked:text-primary-foreground">
            {r}
          </button>
        ))}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（可选）" className="h-11" />
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox checked={visible} onCheckedChange={(v) => setVisible(v === true)} />
        选手可见
      </label>
      {stop.error && <span className="text-[13px] text-alert">{errorText(stop.error)}</span>}
    </Modal>
  );
}
