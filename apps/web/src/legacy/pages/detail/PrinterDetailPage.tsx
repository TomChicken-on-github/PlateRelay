import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Button, IconButton } from "../../components/Button";
import { FigmaIcon } from "../../components/icons/FigmaIcon";
import { Icon } from "../../components/icons/Icon";
import { Page, PageHeader } from "../../components/Page";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { WavyProgress } from "../../components/WavyProgress";
import { LIVE } from "../../lib/api";
import { cx } from "../../lib/cx";
import { duration, easing } from "../../lib/motion";
import { detailOf, printersApi, usePrinters } from "../../lib/printersApi";
import { StateChip } from "../overview/PrinterCard";
import { AmsPanel } from "./AmsPanel";
import { DrySheet, FanSheet, SPEEDS, SpeedSheet, StopSheet, TempSheet } from "./DetailSheets";

type SheetState = { type: "temp"; i: number } | { type: "speed" | "fan" | "dry" | "stop" } | null;

const panel = "rounded-xl bg-sc";
const ptitle = "flex h-6 items-center gap-2 text-title-m font-semibold";

function Tile({ label, icon, onClick, locked, children }: { label: string; icon: React.ReactNode; onClick?: () => void; locked?: boolean; children: React.ReactNode }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-disabled={locked || undefined}
      title={locked ? "打印中已锁定" : undefined}
      className={cx(
        "group relative flex min-h-[84px] flex-col justify-between gap-2.5 rounded-xl border-0 bg-sc-high px-3.5 py-3 text-left text-on-surface max-sm:p-3",
        onClick && "state-layer cursor-pointer",
        locked && "opacity-45",
      )}
    >
      <span className="flex items-center gap-1.5 text-body-m text-on-variant">
        {icon}
        {label}
        {onClick && (
          <span className="ml-auto inline-flex opacity-55 transition-opacity group-hover:opacity-100">
            <Icon name="edit" size={16} />
          </span>
        )}
      </span>
      {children}
    </Tag>
  );
}

const big = "flex items-baseline gap-0.5 font-num text-[24px] leading-7 tnum max-sm:text-[22px]";
const txt = "text-[18px] leading-7 font-medium";

export function PrinterDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { rows, loading } = usePrinters();
  const p = rows.find((x) => x.id === id);
  const [d, setD] = useState(() => (p ? structuredClone(detailOf(p)) : null));
  const [temps, setTemps] = useState(d?.temps ?? []);
  /* live rows arrive after the first render */
  useEffect(() => {
    if (p && !d) {
      const x = structuredClone(detailOf(p));
      setD(x);
      setTemps(x.temps);
    }
  }, [p, d]);
  const [speed, setSpeed] = useState(1);
  const [light, setLight] = useState(true);
  const [fans, setFans] = useState<[string, number][]>([["部件", 80], ["辅助", 40], ["机箱", 30]]);
  const [drying, setDrying] = useState(false);
  const [paused, setPaused] = useState(p?.state === "ERROR_PAUSED");
  const [tab, setTab] = useState<"ctrl" | "info" | "log">("ctrl");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const open = (s: NonNullable<SheetState>) => {
    setSheetKey((k) => k + 1);
    setSheet(s);
  };
  const close = () => setSheet(null);

  if (LIVE && loading) return null;
  if (!p || p.state === "OFFLINE") return <Navigate to="/" replace />;
  if (!d) return null;
  const name = p.name ?? p.id;
  const printing = ["PRINTING", "PREPARING", "ERROR_PAUSED", "UNMANAGED_PRINTING"].includes(p.state);
  const starred = !!p.star;
  const job = d.job;
  const ti = sheet?.type === "temp" ? sheet.i : -1;

  return (
    <Page className="max-w-[1360px] max-sm:pb-24">
      <PageHeader
        lead={<IconButton icon="arrow_back" label="返回概况" onClick={() => navigate("/")} />}
        title={<span className="font-sans">{name}</span>}
        after={
          <>
            <StateChip state={p.state} />
            <IconButton
              icon="star"
              fill={starred}
              label={starred ? "取消星标" : "设为星标"}
              aria-pressed={starred}
              className="text-primary"
              onClick={async () => {
                const r = await printersApi.star(p.id, !starred);
                if (!r.ok) toast(r.error.message || "星标没有保存");
              }}
            />
            <span className="text-body-m text-on-variant">{p.model}</span>
          </>
        }
        actions={
          printing ? (
            /* below 640px the two actions become a bar fixed to the bottom */
            <div className="flex gap-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:bg-sc max-sm:px-4 max-sm:pt-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))] max-sm:shadow-[0_-1px_0_var(--md-outline-variant)] max-sm:[&>button]:h-12 max-sm:[&>button]:flex-1">
              <Button
                variant="tonal"
                icon={paused ? "play_arrow" : "pause"}
                iconFill
                onClick={() => (LIVE ? toast("暂停和继续要经过 daemon，daemon 还没接上") : (setPaused(!paused), toast(paused ? `原型：${name} 已继续` : `原型：${name} 已暂停`)))}
              >
                {paused ? "继续" : "暂停"}
              </Button>
              <Button variant="error-outlined" icon="stop_circle" onClick={() => open({ type: "stop" })}>
                停止
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)] min-[1281px]:grid-cols-[minmax(0,1.65fr)_minmax(360px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cx(panel, "overflow-hidden")}>
            <div className="cam-ph relative aspect-video w-full overflow-hidden" role="img" aria-label={`${name} 摄像头画面`}>
              <span className="absolute top-3 left-3 z-[1] rounded bg-black/50 px-2 py-0.5 font-num text-body-s text-[#e6e0e9]">2026-10-18 14:23:41</span>
            </div>
            <div className="flex h-[52px] items-center gap-2 pr-2 pl-5 text-label-l font-medium">
              <Icon name="videocam" size={20} className="text-on-variant" />
              实时监控
              <span className="ml-1 inline-flex items-center gap-1.5 font-normal text-ok before:size-1.5 before:rounded-full before:bg-active-dot">在线</span>
              <IconButton icon="fullscreen" label="全屏" size={40} className="ml-auto" />
            </div>
          </section>

          <section className={cx(panel, "flex flex-col gap-3 p-5")}>
            <div className={ptitle}>
              <FigmaIcon name="printer" className="size-5 text-primary" />
              当前任务
              {job && <span className="ml-auto font-num text-title-l font-medium text-primary">{job.pct}%</span>}
            </div>
            {job ? (
              <>
                <div className="flex h-6 items-center gap-2 text-label-l font-medium text-strong">
                  <Avatar name={job.who} size={24} />
                  <span>{job.who}</span>
                  <span className="min-w-0 overflow-hidden font-normal text-ellipsis whitespace-nowrap text-on-variant">· {job.file}</span>
                </div>
                <WavyProgress pct={job.pct} active={!paused && job.pct > 0 && job.pct < 100} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-body-m text-on-variant [&_b]:font-medium [&_b]:text-on-surface [&_b]:tnum">
                  <span>
                    已用 <b>{job.used}</b>
                  </span>
                  <span>
                    剩余 <b>{job.left}</b>
                  </span>
                  <span>
                    预计 <b>{job.eta}</b> 完成
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FigmaIcon name="layers" className="size-4 text-neutral-icon" />
                    <b>
                      {job.layer[0]} / {job.layer[1]}
                    </b>{" "}
                    层
                  </span>
                </div>
              </>
            ) : (
              <div className="text-body-m text-on-variant">{p.state === "MAINTENANCE" ? `维护中：${p.maintNote}` : p.state === "UNMANAGED_PRINTING" ? "非系统下发的任务，来源未知" : "空闲，等待派单"}</div>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className={cx(panel, "flex flex-col gap-3.5 p-5 max-sm:p-4")} aria-label="设备状态">
            <div className={ptitle}>设备状态</div>
            <div className="grid grid-cols-2 gap-3 sm:max-lg:grid-cols-4">
              {temps.map((t, i) => (
                <Tile
                  key={t.label}
                  label={t.label}
                  icon={<FigmaIcon name={t.icon} className={cx("size-[18px] flex-none", t.icon === "nozzle" ? "text-nozzle" : t.icon === "bed" ? "text-bed" : "")} />}
                  onClick={t.max ? () => open({ type: "temp", i }) : undefined}
                >
                  <span className={cx(big, t.cur < t.tgt - 2 && "text-nozzle")} aria-label={`${t.label} ${t.cur}°C，目标 ${t.tgt}°C`}>
                    {t.cur}
                    <small className="text-body-m text-on-variant">°C</small>
                    <span className="ml-1.5 text-body-m text-on-variant max-sm:ml-1 max-sm:text-[13px]">/ {t.tgt}°C</span>
                  </span>
                </Tile>
              ))}
              <Tile label="打印速度" icon={<Icon name="speed" size={18} />} onClick={() => open({ type: "speed" })}>
                <span className={txt}>{SPEEDS[speed]}</span>
              </Tile>
              <Tile label="灯光" icon={<Icon name="lightbulb" size={18} />}>
                <span className="flex items-center justify-between">
                  <span className={txt}>{light ? "开启" : "关闭"}</span>
                  <Switch checked={light} onChange={setLight} label="灯光" />
                </span>
              </Tile>
              <Tile label="风扇" icon={<Icon name="mode_fan" size={18} />} onClick={() => open({ type: "fan" })}>
                <span className="grid grid-cols-[repeat(3,auto)] items-end justify-between gap-x-2 font-num text-[18px] leading-6">
                  {fans.map(([n, v]) => (
                    <span key={n}>
                      <em className="block font-sans text-body-s tracking-normal text-on-variant not-italic">{n}</em>
                      {v}%
                    </span>
                  ))}
                </span>
              </Tile>
              <Tile label="运动" icon={<Icon name="lock" size={18} />} locked={printing}>
                <span className={txt}>XYZ</span>
              </Tile>
            </div>
          </section>

          <section className={cx(panel, "flex flex-col gap-3.5 p-5 max-sm:p-4")}>
            <div className={ptitle}>AMS 料盘</div>
            {d.ams.length ? (
              <AmsPanel ams={d.ams} extL={d.extL} extR={d.extR} humidity={d.humidity} drying={drying} onDry={() => open({ type: "dry" })} />
            ) : (
              <div className="text-body-m text-on-variant">{d.extR ? "未接 AMS，使用外挂料盘" : "未接 AMS"}</div>
            )}
          </section>
        </div>
      </div>

      <section className={cx(panel, "overflow-hidden")}>
        <div role="tablist" className="flex border-b border-solid border-outline-variant px-2">
          {(
            [
              ["ctrl", "控制"],
              ["info", "设备信息"],
              ["log", "事件日志"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("state-layer relative inline-flex h-12 items-center gap-1.5 border-0 bg-transparent px-4 text-label-l font-medium", tab === k ? "text-primary" : "text-on-variant")}
            >
              {l}
              {k === "log" && d.log.length > 0 && <span className="h-4 min-w-4 rounded-lg bg-error px-1 text-center text-label-s text-on-error">{d.log.length}</span>}
              {tab === k && (
                <motion.span
                  layoutId="detail-tab"
                  className="absolute right-3 bottom-0 left-3 h-[3px] rounded-t-[3px] bg-primary"
                  transition={{ duration: duration.medium2, ease: easing.emphasized }}
                />
              )}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="p-5">
          {tab === "info" && (
            <dl className="m-0 grid gap-x-8 lg:grid-cols-2">
              {[
                ["型号", p.model],
                ["序列号", d.serial],
                ["固件版本", d.fw],
                ["局域网 IP", d.ip],
                ["MQTT 连接", LIVE ? <span className="text-on-variant">{p.lastSeen === "从未连接" ? "daemon 尚未连接" : `最后上报 ${p.lastSeen}`}</span> : <span className="text-ok">已连接 · 延迟 {d.mqtt}ms</span>],
                ["运行时长", LIVE ? "—" : `1h 36m（本次）· 累计 ${d.upAll}`],
              ].map(([k, v], i) => (
                <div key={i} className="flex justify-between gap-4 border-b border-solid border-outline-variant py-3 text-body-m">
                  <dt className="text-on-variant">{k}</dt>
                  <dd className="m-0 text-right tnum">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === "log" &&
            (d.log.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {d.log.map(([c, t, m]) => (
                  <li key={t + m} className="grid grid-cols-[10px_56px_1fr] items-center gap-3 border-b border-solid border-outline-variant py-3 text-body-m">
                    <i className={cx("size-2 rounded-full", c === "ok" ? "bg-active-dot" : c === "warn" ? "bg-warn" : "bg-outline")} />
                    <time className="text-on-variant tnum">{t}</time>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-body-m text-on-variant">暂无事件</div>
            ))}
          {tab === "ctrl" && <Controls locked={printing} />}
        </div>
      </section>

      <TempSheet
        key={`t${sheetKey}`}
        open={sheet?.type === "temp"}
        label={temps[ti]?.label ?? ""}
        cur={temps[ti]?.cur ?? 0}
        tgt={temps[ti]?.tgt ?? 0}
        max={temps[ti]?.max ?? 300}
        kind={temps[ti]?.icon === "bed" ? "bed" : "nozzle"}
        onClose={close}
        onApply={(v) => {
          setTemps((ts) => ts.map((t, i) => (i === ti ? { ...t, tgt: v } : t)));
          close();
        }}
      />
      <SpeedSheet open={sheet?.type === "speed"} value={speed} onClose={close} onPick={(i) => (setSpeed(i), close())} />
      <FanSheet open={sheet?.type === "fan"} fans={fans} onClose={close} onChange={(i, v) => setFans((f) => f.map((x, j) => (j === i ? [x[0], v] : x)))} />
      <DrySheet
        key={`d${sheetKey}`}
        open={sheet?.type === "dry"}
        printing={printing}
        drying={drying}
        humidity={d.humidity}
        onClose={close}
        onStart={() => (setDrying(true), close())}
        onStop={() => (setDrying(false), close())}
      />
      <StopSheet
        key={`s${sheetKey}`}
        open={sheet?.type === "stop"}
        id={name}
        onClose={close}
        onStop={async (why) => {
          if (!LIVE) {
            close();
            return toast(`原型：${name} 已停止（${why}），订单记为打印失败`);
          }
          const r = await printersApi.stop(p.id, why);
          if (!r.ok) return toast(r.error.message || "停止失败，请重试");
          close();
          toast(r.data.commandSent ? `${name} 已停止，订单记为打印失败` : `订单已记为打印失败；停止命令没发到 ${name}，请在打印机屏幕上停止`);
        }}
      />
    </Page>
  );
}

function Seg({ items, value, onChange, check }: { items: string[]; value: number; onChange?: (i: number) => void; check?: boolean }) {
  return (
    <div className="inline-flex h-10 overflow-hidden rounded-[20px] shadow-[inset_0_0_0_1px_var(--md-outline)]">
      {items.map((t, i) => (
        <button
          key={t}
          type="button"
          aria-pressed={value === i}
          onClick={() => onChange?.(i)}
          className={cx(
            "state-layer inline-flex items-center gap-1.5 border-0 px-3 text-label-l font-medium",
            i > 0 && "shadow-[inset_1px_0_0_var(--md-outline)]",
            value === i ? "bg-secondary-container text-on-secondary-container" : "bg-transparent text-on-surface",
          )}
        >
          {check && value === i && <Icon name="check" size={18} />}
          {t}
        </button>
      ))}
    </div>
  );
}

/** Extruder and motion controls. Locked while printing; real commands are wired to the daemon later. */
function Controls({ locked }: { locked: boolean }) {
  const [head, setHead] = useState(0);
  const [step, setStep] = useState(0);
  const pad = "grid place-items-center rounded-xl border-0 bg-sc-high font-num text-body-s font-medium text-on-surface";
  return (
    <>
      {locked && (
        <div className="mb-5 flex h-[42px] items-center gap-2.5 rounded-xl bg-banner-warn-bg pr-3.5 pl-3 font-cjk text-[14px] leading-4 tracking-[0.4px] text-banner-warn">
          <FigmaIcon name="lock" className="size-[18px]" />
          <span>打印中，挤出和运动控制已锁定，暂停任务后可操作</span>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3.5 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]">
          <div className="h-5 text-label-l font-medium">挤出机</div>
          <div className={cx("flex flex-col gap-3", locked && "pointer-events-none opacity-38")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 text-body-m text-on-variant">挤出头</span>
              <Seg items={["主", "辅"]} value={head} onChange={setHead} check />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 text-body-m text-on-variant">手动</span>
              <Button variant="outlined" icon="keyboard_arrow_up">
                进料 10 mm
              </Button>
              <Button variant="outlined" icon="keyboard_arrow_down">
                退料 10 mm
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3.5 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]">
          <div className="h-5 text-label-l font-medium">运动</div>
          <div className={cx("grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 max-sm:grid-cols-1 max-sm:justify-items-start", locked && "pointer-events-none opacity-38")}>
            <div className="grid grid-cols-[repeat(3,48px)] grid-rows-[repeat(3,48px)] gap-1">
              <span />
              <button type="button" aria-label="Y+" className={pad}>
                <Icon name="keyboard_arrow_up" size={20} />
              </button>
              <span />
              <button type="button" aria-label="X-" className={pad}>
                <Icon name="keyboard_arrow_left" size={20} />
              </button>
              <button type="button" aria-label="归零" className={cx(pad, "rounded-3xl bg-secondary-container text-on-secondary-container")}>
                <Icon name="home" size={20} />
              </button>
              <button type="button" aria-label="X+" className={pad}>
                <Icon name="keyboard_arrow_right" size={20} />
              </button>
              <span />
              <button type="button" aria-label="Y-" className={pad}>
                <Icon name="keyboard_arrow_down" size={20} />
              </button>
              <span />
            </div>
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <button type="button" className={cx(pad, "h-12 w-[72px]")}>
                  Z +
                </button>
                <button type="button" className={cx(pad, "h-12 w-[72px]")}>
                  Z −
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-m text-on-variant">步距</span>
                <Seg items={["1 mm", "10 mm"]} value={step} onChange={setStep} check />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
