import { useState } from "react";
import { Button } from "../../components/Button";
import { Field, Select, TextInput } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { cx } from "../../lib/cx";

export const SPEEDS = ["静音", "标准", "运动", "狂暴"];

const PRESETS: Record<string, [string, number][]> = {
  nozzle: [["关", 0], ["PLA 220", 220], ["PETG 240", 240], ["ABS 260", 260]],
  bed: [["关", 0], ["PLA 55", 55], ["PETG 70", 70], ["ABS 100", 100]],
};

/** Target temperature: big number, -/+ 5, presets; out of range turns the field red and blocks 确定. */
export function TempSheet({ open, label, cur, tgt, max, kind, onClose, onApply }: { open: boolean; label: string; cur: number; tgt: number; max: number; kind: "nozzle" | "bed"; onClose: () => void; onApply: (v: number) => void }) {
  const [val, setVal] = useState(String(tgt));
  const n = val === "" ? NaN : +val;
  const ok = Number.isFinite(n) && n >= 0 && n <= max;
  const step = (d: number) => setVal(String(Math.max(0, Math.min(max, (+val || 0) + d))));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${label}目标温度`}
      titleSize="lg"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => ok && onApply(n)}>确定</Button>
        </>
      }
    >
      <div className="text-body-m text-on-variant">当前 {cur}°C</div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="减 5" onClick={() => step(-5)} className="state-layer size-12 rounded-3xl border-0 bg-secondary-container text-[24px] leading-none font-medium text-on-secondary-container">
          −
        </button>
        <label className={cx("inline-flex min-w-[120px] items-baseline justify-center gap-0.5 border-b-2 border-solid pb-1 font-num text-[40px] leading-[48px]", ok ? "border-primary" : "border-error")}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            value={val}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ok && onApply(n)}
            className="w-[3.2ch] border-0 bg-transparent p-0 text-right font-[inherit] text-on-surface outline-0"
          />
          <span className="text-[18px] text-on-variant">°C</span>
        </label>
        <button type="button" aria-label="加 5" onClick={() => step(5)} className="state-layer size-12 rounded-3xl border-0 bg-secondary-container text-[24px] leading-none font-medium text-on-secondary-container">
          +
        </button>
      </div>
      <div className="min-h-4 text-center text-body-s text-error" aria-live="polite">
        {ok ? "" : `请输入 0 到 ${max} 之间的温度`}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS[kind].map(([t, v]) => (
          <button key={t} type="button" onClick={() => setVal(String(v))} className="state-layer h-8 rounded-lg border-0 bg-transparent px-3.5 text-label-l font-medium text-on-surface shadow-[inset_0_0_0_1px_var(--md-outline)] max-sm:h-10">
            {t}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function SpeedSheet({ open, value, onClose, onPick }: { open: boolean; value: number; onClose: () => void; onPick: (i: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="打印速度" titleSize="lg">
      <div role="radiogroup" className="flex flex-col">
        {SPEEDS.map((s, i) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === i}
            onClick={() => onPick(i)}
            className={cx("state-layer flex h-14 items-center justify-between rounded-xl border-0 px-2 text-[16px] leading-6", value === i ? "bg-secondary-container text-on-secondary-container" : "bg-transparent text-on-surface")}
          >
            {s}
            {value === i && <Icon name="check" size={22} />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function FanSheet({ open, fans, onClose, onChange }: { open: boolean; fans: [string, number][]; onClose: () => void; onChange: (i: number, v: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="风扇" titleSize="lg" footer={<Button onClick={onClose}>完成</Button>}>
      {fans.map(([n, v], i) => (
        <label key={n} className="grid grid-cols-[80px_1fr_44px] items-center gap-3 text-body-m">
          <span>{n}风扇</span>
          <input type="range" min={0} max={100} step={5} value={v} onChange={(e) => onChange(i, +e.target.value)} className="h-8 w-full accent-primary" />
          <b className="text-right font-num text-label-l font-medium">{v}%</b>
        </label>
      ))}
    </Sheet>
  );
}

/* AMS 2 Pro max 65°C idle; while printing max 45°C, needs its own power, no spool rotation; AMS HT max 85°C. */
const AMS_MAX = 65, PRINT_MAX = 45;
const DRY_MATS: Record<string, [number, number]> = { PLA: [55, 8], PETG: [65, 8], ABS: [80, 8], TPU: [70, 8], PA: [85, 12], PC: [80, 8] };

export function DrySheet({ open, printing, drying, humidity, onClose, onStart, onStop }: { open: boolean; printing: boolean; drying: boolean; humidity: number; onClose: () => void; onStart: () => void; onStop: () => void }) {
  const max = printing ? PRINT_MAX : AMS_MAX;
  const [d, setD] = useState({ mat: "PLA", temp: String(Math.min(55, max)), hours: "8", rot: false });
  if (drying) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="烘干中 · 加热"
        titleSize="lg"
        footer={
          <>
            <Button variant="text" onClick={onClose}>
              关闭
            </Button>
            <Button variant="error-tonal" onClick={onStop}>
              停止烘干
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-center text-body-s tracking-normal text-on-variant">
          {[["湿度", `${humidity}%`], ["温度", "36°C"], ["剩余时间", "07:59"]].map(([k, v]) => (
            <span key={k}>
              {k}
              <b className="mt-1 block font-num text-[20px] leading-7 font-medium text-on-surface">{v}</b>
            </span>
          ))}
        </div>
      </Sheet>
    );
  }
  const msgs: [boolean, string][] = [];
  if (!(+d.temp >= 35 && +d.temp <= max)) msgs.push([true, `温度范围 35 到 ${max}°C`]);
  if (!(+d.hours >= 1 && +d.hours <= 24)) msgs.push([true, "时长范围 1 到 24 小时"]);
  if (!msgs.length && DRY_MATS[d.mat][0] > max) msgs.push([false, `当前最高只能烘干到 ${max}°C，可能无法完全烘干 ${d.mat}${printing ? "" : "，推荐使用 AMS HT 进行烘干"}。`]);
  const blocked = msgs.some((m) => m[0]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="耗材烘干设置"
      titleSize="lg"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => !blocked && onStart()} disabled={blocked}>
            开始烘干
          </Button>
        </>
      }
    >
      <Field label="耗材">
        {(id, cls) => (
          <Select
            id={id}
            className={cls}
            options={Object.keys(DRY_MATS)}
            value={d.mat}
            onChange={(e) => {
              const [t, h] = DRY_MATS[e.target.value];
              setD({ ...d, mat: e.target.value, temp: String(Math.min(t, max)), hours: String(h) });
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="温度">
          {(id, cls) => (
            <div className="relative">
              <TextInput id={id} className={cx(cls, "pr-10")} type="number" inputMode="numeric" value={d.temp} onChange={(e) => setD({ ...d, temp: e.target.value })} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-variant">°C</span>
            </div>
          )}
        </Field>
        <Field label="时长">
          {(id, cls) => (
            <div className="relative">
              <TextInput id={id} className={cx(cls, "pr-8")} type="number" inputMode="numeric" value={d.hours} onChange={(e) => setD({ ...d, hours: e.target.value })} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-variant">h</span>
            </div>
          )}
        </Field>
      </div>
      <div className="flex items-center justify-between text-body-m">
        <span>烘干时旋转料盘</span>
        <Switch checked={d.rot && !printing} disabled={printing} onChange={(v) => setD({ ...d, rot: v })} label="烘干时旋转料盘" />
      </div>
      {printing && <div className="text-body-s tracking-normal text-on-variant">打印中烘干：AMS 需单独接电源，最高 {PRINT_MAX}°C，不能旋转料盘。AMS 2 Pro 空闲时最高 {AMS_MAX}°C，AMS HT 最高 85°C。</div>}
      {msgs.length > 0 && (
        <div aria-live="polite">
          {msgs.map(([e, t]) => (
            <p key={t} className={cx("m-0 mb-1 text-[13px] leading-[18px]", e ? "text-error" : "text-warn")}>
              {t}
            </p>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export const STOP_REASONS = ["耗材问题", "喷头 / 挤出问题", "打印板问题", "模型 / 切片问题", "其他"];

/** Stopping a print fails the order, so a failure reason is required. */
export function StopSheet({ open, id, onClose, onStop }: { open: boolean; id: string; onClose: () => void; onStop: (why: string) => void }) {
  const [why, setWhy] = useState("");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`停止打印 ${id}`}
      sub="停止后订单记为打印失败，选手会收到通知，Builder 之后可以归因和重打。"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            返回
          </Button>
          <Button variant="danger" disabled={!why} onClick={() => onStop(why)}>
            确认停止
          </Button>
        </>
      }
    >
      <Field label="失败原因" required>
        {(fid, cls) => <Select id={fid} className={cls} options={STOP_REASONS} placeholder="请选择" value={why} onChange={(e) => setWhy(e.target.value)} />}
      </Field>
    </Sheet>
  );
}
