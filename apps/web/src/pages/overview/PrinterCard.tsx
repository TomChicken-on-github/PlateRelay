import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Avatar } from "../../components/Avatar";
import { FigmaIcon, type FigmaIconName } from "../../components/icons/FigmaIcon";
import { WavyProgress } from "../../components/WavyProgress";
import { cx } from "../../lib/cx";
import { duration, easing } from "../../lib/motion";
import { OWNERS, type Printer, type PrinterState, type Spool } from "../../mock/printers";

export const CARD_STATE: Record<PrinterState, [string, "" | "ok" | "warn" | "err"]> = {
  PRINTING: ["打印中", "ok"],
  PREPARING: ["预热", ""],
  IDLE: ["空闲", ""],
  CLEARING_REQUIRED: ["问题", "warn"],
  UNMANAGED_PRINTING: ["问题", "warn"],
  ERROR_PAUSED: ["故障", "err"],
  OFFLINE: ["离线", ""],
  MAINTENANCE: ["维护", ""],
};

export function StateChip({ state }: { state: PrinterState }) {
  const [label, tone] = CARD_STATE[state];
  return (
    <span
      className={cx(
        "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-1.5 text-label-l font-medium",
        tone === "ok" ? "bg-ok-bg text-ok" : tone === "warn" ? "bg-warn-bg text-warn" : tone === "err" ? "bg-err-bg text-err" : "bg-sc-high text-on-variant",
      )}
    >
      {label}
    </span>
  );
}

const rgba = (hex8: string) => {
  if (!hex8 || hex8.length < 8) return "transparent";
  const n = (i: number) => parseInt(hex8.slice(i, i + 2), 16);
  return `rgba(${n(0)},${n(2)},${n(4)},${(n(6) / 255).toFixed(2)})`;
};
const isEmptySlot = (s: Spool) => !s.m || s.c.slice(6) === "00";

/* Remaining filament as a ring; unknown amount (-1) is a dotted ring */
function Ring({ slot }: { slot: Spool }) {
  const R = 6.125, C = 2 * Math.PI * R, col = rgba(slot.c);
  const dash = slot.r == null || slot.r < 0 ? "1.4 2.4" : `${((C * Math.max(slot.r, 5)) / 100).toFixed(2)} ${C.toFixed(2)}`;
  return (
    <svg className="size-3.5 flex-none -rotate-90" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={R} fill="none" strokeWidth="1.75" stroke={col} strokeDasharray={dash} />
    </svg>
  );
}

function Row({ icon, tone, children }: { icon: FigmaIconName; tone?: "nz" | "bd"; children: React.ReactNode }) {
  return (
    <div className="flex h-5 items-center gap-1.5 whitespace-nowrap text-body-m text-on-surface">
      <FigmaIcon name={icon} className={cx("size-3.5 flex-none", tone === "nz" ? "text-nozzle" : tone === "bd" ? "text-bed" : "text-neutral-icon")} />
      <span className="min-w-0 tnum">{children}</span>
    </div>
  );
}

const temp = (c: number | null, t: number | null) => (c == null ? "— / —" : `${c} / ${t || "—"}°C`);

/** Printer card, exact Figma layout: header, 424px media row (camera 220x123 + data 188) zoomed to the card width, job, banner. */
export function PrinterCard({ p, zoom }: { p: Printer; zoom: number }) {
  const navigate = useNavigate();
  const off = p.state === "OFFLINE";
  const o: [string, string] | null = p.order ? (p.file ? [p.who ?? "", p.file] : (OWNERS[p.order] ?? null)) : null;
  const name = p.name ?? p.id;

  const loaded = p.ams.filter((x) => !isEmptySlot(x)).map((x) => ({ ...x, label: x.s! })).concat(p.ext ? [{ ...p.ext, label: "外挂" }] : []);
  /* keep four rows so the AMS column lines up with the telemetry rows */
  const pad = Math.max(0, 4 - Math.max(1, Math.min(loaded.length, 4)));

  let who: string | null = null, file = "", pct = p.progress ?? 0, time = "", show = true;
  if (o) {
    [who, file] = o;
    time = p.state === "CLEARING_REQUIRED" ? `总耗时 ${p.used} / 等待清台 ${p.waiting}` : p.state === "PREPARING" ? `${p.substage} / 剩余 ${p.left}` : `已用 ${p.used} / 剩余 ${p.left}`;
  } else if (p.state === "UNMANAGED_PRINTING") {
    file = "非系统下发的任务";
    time = `已用 ${p.used} / 剩余未知`;
    who = "未知来源";
  } else if (off) {
    who = "—"; file = "—"; time = "—"; pct = 0;
  } else {
    show = false;
    file = p.state === "MAINTENANCE" ? "维护中，不参与派单" : "空闲，等待派单";
    time = p.state === "MAINTENANCE" ? p.maintNote ?? "" : "暂未派单";
    pct = 0;
  }
  const active = pct > 0 && pct < 100;
  const open = () => !off && navigate(`/printers/${p.id}`);

  return (
    <motion.article
      layoutId={p.id}
      transition={{ layout: { duration: duration.medium4, ease: easing.emphasized } }}
      role={off ? undefined : "link"}
      tabIndex={off ? undefined : 0}
      aria-label={off ? undefined : `${name} 详情`}
      onClick={(e) => !(e.target as HTMLElement).closest("button,a") && open()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), open())}
      className={cx("@container relative flex flex-col overflow-hidden rounded-xl bg-sc", !off && "cursor-pointer transition-colors duration-150 ease-standard hover:bg-[color-mix(in_srgb,var(--md-on-surface)_4%,var(--md-sc))]")}
    >
      <div className="flex flex-col gap-3.5 p-5 @max-[420px]:p-4">
        <div className="flex h-8 items-center gap-2">
          <FigmaIcon name="printer" className="size-5 text-primary" />
          <b className="text-title-m font-semibold">{name}</b>
          <span className="ml-auto">
            <StateChip state={p.state} />
          </span>
        </div>

        <div
          className="grid w-[424px] grid-cols-[220px_188px] items-center gap-4 @max-[420px]:w-auto! @max-[420px]:grid-cols-[minmax(0,1fr)] @max-[420px]:gap-3 @max-[420px]:[zoom:1]!"
          style={{ zoom }}
        >
          <div className="cam-ph relative aspect-[220/123] w-full overflow-hidden rounded-lg" role="img" aria-label={`${name} 摄像头画面`} />
          <div className={cx("grid grid-cols-[104px_84px] self-stretch @max-[420px]:grid-cols-[auto_auto] @max-[420px]:justify-evenly", off && "opacity-48 blur-[3px]")}>
            <div className="flex flex-col justify-center gap-1.5 @max-[420px]:justify-start">
              {p.nozzles.length > 1 ? (
                p.nozzles.map((n, i) => (
                  <Row key={i} icon="nozzle" tone="nz">
                    {temp(n.cur, n.tgt)}
                  </Row>
                ))
              ) : (
                <Row icon="nozzle" tone="nz">
                  {temp(p.nozzles[0].cur, p.nozzles[0].tgt)}
                </Row>
              )}
              <Row icon="bed" tone="bd">
                {temp(p.bed[0], p.bed[1])}
              </Row>
              <Row icon="chamber">{p.chamber ? temp(p.chamber[0], p.chamber[1]) : "— / —"}</Row>
              <Row icon="layers">{p.layer ? `${p.layer[0]} / ${p.layer[1]}` : "— / —"}</Row>
            </div>
            <div className="flex flex-col justify-center gap-1.5 px-0.5 @max-[420px]:justify-start">
              {loaded.length ? (
                loaded.slice(0, 4).map((x) => (
                  <div
                    key={x.label}
                    title={`${x.label} ${x.m}${x.r != null && x.r >= 0 ? " · 余 " + x.r + "%" : ""}`}
                    className="flex h-5 items-center gap-1 whitespace-nowrap px-0.5 text-label-s font-medium text-strong"
                  >
                    <Ring slot={x} />
                    <span className="min-w-[15px] whitespace-nowrap">{x.label}</span>
                    <span className="relative min-w-8 @max-[420px]:min-w-0">
                      {x.m}
                      {/* out of flow so the active dot never widens the column that gets centred */}
                      {x.active && <span className="absolute top-1.5 left-[calc(100%+4px)] size-1 rounded-full bg-active-dot" />}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex h-5 items-center px-0.5 text-label-s text-on-variant">未装料</div>
              )}
              {Array.from({ length: pad }, (_, i) => (
                <div key={i} className="h-5" aria-hidden="true" />
              ))}
            </div>
          </div>
        </div>

        <div className={cx("flex flex-col gap-1", off && "opacity-48 blur-[3px]")}>
          {show && (
            <div className="flex h-6 items-center gap-1.5 text-label-l font-medium text-strong">
              <Avatar name={who === "未知来源" || who === "—" ? null : who} size={20} />
              <span>{who}</span>
            </div>
          )}
          <div className="flex h-5 justify-between gap-3 text-label-l font-medium">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{file}</span>
            <span className="min-w-7 flex-none text-right text-primary tnum">{show && !off ? `${pct}%` : ""}</span>
          </div>
          <div className="flex flex-col gap-1">
            <WavyProgress pct={pct} active={active} />
            <div className="text-body-s text-on-variant tnum">{time}</div>
          </div>
        </div>
      </div>

      {p.state === "ERROR_PAUSED" && p.error && (
        <Banner tone="err" icon="error">
          {p.error.msg}
        </Banner>
      )}
      {p.state === "CLEARING_REQUIRED" && (
        <Banner tone="warn" icon="lock">
          热床未清空
        </Banner>
      )}
      {p.state === "UNMANAGED_PRINTING" && (
        <Banner tone="warn" icon="lock" action={{ label: "查看详情", onClick: open }}>
          检测到外部任务
        </Banner>
      )}
      {off && (
        <div className="absolute inset-x-0 bottom-0 z-[2] flex h-[106px] flex-col items-center justify-center gap-2 rounded-b-xl bg-dim">
          <b className="flex items-center gap-2 text-[18px] leading-[26px] font-bold tracking-normal text-error before:size-[7px] before:rounded-full before:bg-current">设备已离线</b>
          <span className="text-label-l font-medium tracking-normal text-outline">最后遥测 {p.lastSeen}</span>
        </div>
      )}
    </motion.article>
  );
}

function Banner({ tone, icon, action, children }: { tone: "warn" | "err"; icon: "lock" | "error"; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "flex h-[42px] items-center gap-2.5 rounded-xl pr-3.5 pl-3 font-cjk text-[14px] leading-4 tracking-[0.4px]",
        tone === "warn" ? "bg-banner-warn-bg text-banner-warn" : "bg-error-container font-bold text-error",
      )}
    >
      <FigmaIcon name={icon} className="size-[18px]" />
      <span>{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="state-layer ml-auto h-8 rounded-xl border-0 bg-transparent px-3 py-1.5 font-sans text-label-l font-medium text-inherit shadow-[inset_0_0_0_1px_var(--md-btn-stroke)]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
