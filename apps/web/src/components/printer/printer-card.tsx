import { TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { StatusPill } from "@/components/status-pill";
import { ago, clock, duration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CameraView } from "./camera-view";
import { LiveDialog } from "./live-dialog";
import { type PrinterCardData, printerStatus, type Status, TONE } from "./status";
import { BedIcon, ChamberIcon, NozzleIcon } from "./temp-icons";

/**
 * The one printer card, used on the overview and in the staff pages alike; what differs between
 * them comes only from what the server lets each account see.
 *
 * `filament` is the slot for the loaded-filament column. Its design is still open and the card
 * data carries no trays yet, so nothing is passed today and the card shows camera + temperatures,
 * the camera at most 200 wide with the temperatures right beside it.
 */
export function PrinterCard({ printer: p, filament, className }: { printer: PrinterCardData; filament?: ReactNode; className?: string }) {
  const st = printerStatus(p);
  const job = p.job;
  const hero = heroOf(st, p);
  const alert = alertOf(st, p);
  const offline = st.key === "offline";
  const [live, setLive] = useState(false);
  const quietTemps = st.key === "available" || st.key === "external" || st.key === "maintenance";

  return (
    <article className={cn("@container flex flex-col overflow-hidden rounded-2xl bg-card", offline && "opacity-55", className)}>
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[15px] font-semibold">{p.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.modelName}</span>
          <StatusPill tone={st.tone} label={st.label} dot={st.dot} />
        </div>

        <div className={cn("grid items-stretch gap-3", filament ? "grid-cols-[minmax(0,1fr)_100px_92px] @max-[339px]:grid-cols-[minmax(0,1fr)_92px_88px]" : "grid-cols-[minmax(0,200px)_100px] justify-start", "@max-[327px]:grid-cols-1")}>
          <CameraView
            printerId={p.id}
            name={p.name}
            modelName={p.modelName}
            snapshotAt={offline || p.camera.stream === "none" ? null : p.camera.snapshotAt}
            onLive={offline || p.camera.stream === "none" ? undefined : () => setLive(true)}
            className="self-center @max-[327px]:aspect-video"
          />
          <Temps temps={p.temps} quiet={quietTemps} />
          {filament && <div className="flex min-w-0 flex-col justify-center self-center @max-[327px]:hidden">{filament}</div>}
        </div>

        <div className="flex flex-col gap-1.5">
          {job?.owner && (
            <div className="flex items-center gap-1.5 text-[13px] leading-5">
              <UserAvatar id={job.owner.id ?? job.owner.name} name={job.owner.name} url={job.owner.avatarUrl} size={20} />
              <span className="font-medium whitespace-nowrap">{job.owner.name}</span>
              {job.fileName && <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.fileName}</span>}
            </div>
          )}
          <div className="flex items-baseline gap-1.5">
            <span className={cn("text-xl leading-[26px] tracking-[-0.4px] whitespace-nowrap", hero.muted ? "font-semibold text-muted-foreground" : "font-bold", hero.tone && TONE[hero.tone].text)}>{hero.big}</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">{hero.small}</span>
            {hero.percent != null && <span className="text-[13px] font-semibold">{hero.percent}%</span>}
          </div>
          {hero.percent != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-track">
              <div className={cn("h-full rounded-full", TONE[st.tone].dot)} style={{ width: `${hero.percent}%` }} />
            </div>
          )}
          {hero.context && <span className="text-xs leading-4 text-muted-foreground">{hero.context}</span>}
        </div>
      </div>
      {live && <LiveDialog printerId={p.id} name={p.name} modelName={p.modelName} snapshotAt={p.camera.snapshotAt} open onOpenChange={setLive} />}
      {alert && (
        <div className="flex items-center gap-2 bg-alert-surface px-4 py-2.5 text-[13px] font-semibold text-alert">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{alert}</span>
        </div>
      )}
    </article>
  );
}

type Hero = { big: string; small?: string; context?: string; percent?: number | null; tone?: "ok" | "wait"; muted?: boolean };

function heroOf(st: Status, p: PrinterCardData): Hero {
  const job = p.job;
  const layers = job?.layer != null && job.totalLayers ? `第 ${job.layer} / ${job.totalLayers} 层` : "";
  const left = job?.remainingSeconds;
  switch (st.key) {
    case "printing": {
      const done = left != null ? `${clock(Date.now() + left * 1000)} 完成` : "";
      return { big: left != null ? duration(left) : `${job?.percent ?? 0}%`, small: left != null ? "剩余" : "", context: [layers, done].filter(Boolean).join(" · "), percent: job?.percent ?? null };
    }
    case "paused":
      return { big: left != null ? duration(left) : "已暂停", small: left != null ? "剩余 · 已暂停" : "", context: layers, percent: job?.percent ?? null, tone: "wait" };
    case "preparing":
      if (left != null) return { big: duration(left), small: "预计用时", context: job?.substage ?? "" };
      return { big: job?.substage || "准备中", small: "" };
    case "clearing":
      return { big: "已打完", small: "等铲件", context: `${ago(p.stateSince)}打完`, tone: "wait" };
    case "available":
      return { big: "可用", tone: "ok" };
    case "external":
      return { big: "外部任务", muted: true };
    case "maintenance":
      return { big: "维护中", muted: true };
    case "offline":
      return { big: "离线", context: `最后上报 ${clock(p.stateSince)}`, muted: true };
    case "attention":
      return { big: "异常", muted: true };
  }
}

const REASON_TEXT: Record<string, string> = {
  ERROR: "打印机报错，等待现场人员处理",
  JUDGE: "等待人工裁定",
  SEND_FAILED: "发送文件失败，等待现场人员处理",
  DAEMON_UPGRADE: "连接打印机的程序需要升级",
};

/** Red band under the card: only for things someone has to go and fix. */
function alertOf(st: Status, p: PrinterCardData): string | null {
  if (st.key === "paused" && p.pauseReason === "RUNOUT") return "断料，等待现场人员补料";
  if (st.key === "paused" && p.pauseReason === "ERROR") return REASON_TEXT.ERROR;
  if (st.key === "attention") return (p.reasons ?? []).map((r) => REASON_TEXT[r]).find(Boolean) ?? null;
  return null;
}

const TEMP_ORDER = ["nozzle", "nozzle1", "nozzle2", "bed", "chamber"];

/** Up to four rows: nozzle(s), bed, chamber. Current / target; orange while heating, cyan while cooling. */
function Temps({ temps, quiet }: { temps: PrinterCardData["temps"]; quiet: boolean }) {
  const rows = Object.entries(temps ?? {})
    .filter(([k]) => TEMP_ORDER.includes(k))
    .sort(([a], [b]) => TEMP_ORDER.indexOf(a) - TEMP_ORDER.indexOf(b))
    .slice(0, 4);
  const twoNozzles = rows.filter(([k]) => k.startsWith("nozzle")).length > 1;
  return (
    <dl className={cn("m-0 grid h-full max-h-28 min-w-0 grid-cols-[auto_1fr] grid-rows-4 items-center gap-x-1.5 self-center py-0.5 text-xs leading-[18px] @max-[327px]:hidden", quiet && "opacity-50")}>
      {rows.map(([k, t]) => {
        const target = t.target ?? null;
        const colour = !target ? "text-muted-foreground" : t.current > target + 2 ? "text-cool" : "text-heat";
        const name = k.startsWith("nozzle") ? (twoNozzles ? `喷嘴 ${k.slice(-1)}` : "喷嘴") : k === "bed" ? "热床" : "腔体";
        const hint = !target ? "" : t.current > target + 2 ? " · 降温中" : " · 加热中";
        const I = k.startsWith("nozzle") ? NozzleIcon : k === "bed" ? BedIcon : ChamberIcon;
        return (
          <div key={k} className="contents">
            <dt title={name + hint} className={cn("flex self-center", colour)}>
              <I />
              <span className="sr-only">{name}</span>
            </dt>
            <dd className="m-0 min-w-0 truncate">
              {Math.round(t.current)}
              <span className="text-faint"> / {target ? Math.round(target) : "—"}°C</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
