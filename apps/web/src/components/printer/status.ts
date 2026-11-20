import type { Schemas } from "@/lib/api";

export type PrinterCardData = Schemas["PrinterCard"];
export type Tone = "ok" | "busy" | "wait" | "idle" | "alert";

export type Status = {
  key: "printing" | "preparing" | "paused" | "clearing" | "available" | "external" | "maintenance" | "offline" | "attention";
  label: string;
  tone: Tone;
  /** "breathe" while preparing, "hollow" when offline */
  dot?: "breathe" | "hollow";
};

/** What the status pill says. Printing, preparing and paused come from the job's phase. */
export function printerStatus(p: Pick<PrinterCardData, "state" | "reasons" | "externalRunning" | "job">): Status {
  const reasons = p.reasons ?? [];
  if (p.state === "ATTENTION") {
    if (reasons.includes("OFFLINE")) return { key: "offline", label: "离线", tone: "idle", dot: "hollow" };
    if (reasons.length === 1 && reasons[0] === "MAINTENANCE") return { key: "maintenance", label: "维护中", tone: "idle" };
    return { key: "attention", label: "异常", tone: "alert" };
  }
  if (p.state === "CLEARING_REQUIRED") return { key: "clearing", label: "待清板", tone: "wait" };
  if (p.state === "AVAILABLE") return { key: "available", label: "空闲", tone: "ok" };
  if (p.externalRunning || p.job?.external) return { key: "external", label: "外部占用", tone: "idle" };
  switch (p.job?.phase) {
    case "PAUSED":
      return { key: "paused", label: "暂停中", tone: "wait" };
    case "PRINTING":
      return { key: "printing", label: "打印中", tone: "busy" };
    default:
      return { key: "preparing", label: "准备中", tone: "busy", dot: "breathe" };
  }
}

/* Literal class names per tone, so Tailwind sees them. */
export const TONE: Record<Tone, { text: string; surface: string; dot: string; border: string }> = {
  ok: { text: "text-ok", surface: "bg-ok-surface", dot: "bg-ok-dot", border: "border-ok-dot" },
  busy: { text: "text-busy", surface: "bg-busy-surface", dot: "bg-busy-dot", border: "border-busy-dot" },
  wait: { text: "text-wait", surface: "bg-wait-surface", dot: "bg-wait-dot", border: "border-wait-dot" },
  idle: { text: "text-idle", surface: "bg-idle-surface", dot: "bg-idle-dot", border: "border-idle-dot" },
  alert: { text: "text-alert", surface: "bg-alert-surface", dot: "bg-alert-dot", border: "border-alert-dot" },
};
