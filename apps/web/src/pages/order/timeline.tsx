import { Camera, ChevronDown, ChevronUp, Scissors } from "lucide-react";
import { useState } from "react";
import { TONE, type Tone } from "@/components/printer/status";
import { clock } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/order-status";
import type { OrderDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Node = OrderDetail["nodes"][number];
type Job = NonNullable<OrderDetail["printJobs"]>[number];

const NAMES: Record<Node["node"], string> = { SUBMIT: "提交", REVIEW: "审核", QUEUE: "排队", PRINT: "打印", STORE: "入库", PICKUP: "取件" };

const OUTCOME: Record<NonNullable<Job["outcome"]>, string> = {
  FINISHED: "已打完",
  FAILED: "失败",
  SEND_FAILED: "发送失败",
  START_FAILED: "启动失败",
  STOPPED_BEFORE_START: "开始前停止",
};

/* the soft ring around the current step's dot */
const HALO: Record<Tone, string> = {
  ok: "shadow-[0_0_0_3px_var(--ok-surface)]",
  busy: "shadow-[0_0_0_3px_var(--busy-surface)]",
  wait: "shadow-[0_0_0_3px_var(--wait-surface)]",
  idle: "shadow-[0_0_0_3px_var(--border)]",
  alert: "shadow-[0_0_0_3px_var(--alert-surface)]",
};

type Step = { status: string; time?: string; note?: string | null; skip?: boolean; photo?: { label: string; url: string }; earlier?: string[] };

/** What each of the six steps says for this order. */
function steps(o: OrderDetail): Record<Node["node"], Step> {
  const n = Object.fromEntries(o.nodes.map((x) => [x.node, x])) as Record<Node["node"], Node>;
  const review = o.pendingVersion ?? o.activeVersion;
  const jobs = o.printJobs ?? [];
  const job = jobs[0];
  const attempt = (j: Job) => (jobs.length > 1 ? ` · 第 ${j.attempt} 次` : "");
  const skippedNames = (o.parts?.skipped ?? []).map((id) => o.plate.parts.find((p) => p.id === id)?.name ?? `#${id}`);

  const reviewStatus =
    n.REVIEW.state === "DONE" ? `第 ${o.activeVersion.n} 版 · 已通过` : o.status === "CANCELLED" && n.REVIEW.state === "PROBLEM" ? "已取消" : review.state === "REJECTED" || o.status === "REJECTED" ? `第 ${review.n} 版 · 已驳回` : `第 ${review.n} 版 · 等待审核`;

  let print = "";
  if (job) {
    if (o.status === "DISPATCHED") print = `${job.printerName} · 准备中`;
    else if (o.status === "PRINTING") print = `${job.printerName}${attempt(job)} · 打印中`;
    else if (o.status === "FAILED") print = `${job.printerName}${attempt(job)} · 失败 · ${o.reprintDeclined ? "不重打" : "等待处理"}`;
    else print = `${job.printerName}${attempt(job)} · ${job.outcome ? OUTCOME[job.outcome] : "已打完"}`;
  }

  return {
    SUBMIT: { status: "已提交", time: clock(o.submittedAt) },
    REVIEW: { status: reviewStatus, time: review.decidedAt ? clock(review.decidedAt) : undefined, note: n.REVIEW.note ?? (o.status === "REJECTED" ? review.reason : null) },
    QUEUE:
      n.QUEUE.state === "ACTIVE"
        ? { status: o.queue ? `第 ${o.queue.position} 位` : "排队中", note: n.QUEUE.note }
        : n.QUEUE.state === "PROBLEM" || (o.status === "CANCELLED" && n.QUEUE.state !== "NOT_REACHED")
          ? { status: "已取消", note: n.QUEUE.note }
          : { status: n.QUEUE.state === "DONE" ? "已派单" : "", note: n.QUEUE.note },
    PRINT: {
      status: n.PRINT.state === "NOT_REACHED" ? "" : print,
      time: job?.endedAt ? clock(job.endedAt) : job?.startedAt ? clock(job.startedAt) : undefined,
      note: skippedNames.length ? `已跳过 ${skippedNames.length} 个零件：${skippedNames.join("、")}` : (o.reprintDeclined?.reason ?? n.PRINT.note),
      skip: skippedNames.length > 0,
      photo: job?.endPhoto ? { label: "结束照片", url: job.endPhoto.url } : undefined,
      earlier: jobs.slice(1).map((j) => `第 ${j.attempt} 次 · ${j.outcome ? OUTCOME[j.outcome] : ""}${j.endedAt ? ` · ${clock(j.endedAt)}` : ""}`),
    },
    STORE:
      n.STORE.state === "DONE"
        ? { status: "已入库", note: o.storage ? `存放于 ${o.storage.slot}` : n.STORE.note, photo: o.storage?.photoUrl ? { label: "入库照片", url: o.storage.photoUrl } : undefined }
        : n.STORE.state === "ACTIVE"
          ? { status: "等待入库" }
          : n.STORE.state === "PROBLEM"
            ? { status: "已处理", note: n.STORE.note }
            : { status: "" },
    PICKUP: n.PICKUP.state === "DONE" ? { status: "已取件" } : n.PICKUP.state === "ACTIVE" ? { status: "待取件" } : n.PICKUP.state === "PROBLEM" ? { status: "已处理", note: n.PICKUP.note } : { status: "" },
  };
}

/** The six steps of an order as a vertical timeline. */
export function Timeline({ order }: { order: OrderDetail }) {
  const s = steps(order);
  const tone: Tone = ORDER_STATUS[order.status].tone;
  return (
    <ol className="m-0 flex list-none flex-col rounded-2xl bg-card p-4">
      {order.nodes.map((n, i) => (
        <TimelineStep key={n.node} node={n} step={s[n.node]} tone={tone} last={i === order.nodes.length - 1} />
      ))}
    </ol>
  );
}

function TimelineStep({ node: n, step, tone, last }: { node: Node; step: Step; tone: Tone; last: boolean }) {
  const [photo, setPhoto] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const bad = n.state === "PROBLEM";
  const cur = n.state === "ACTIVE";
  const t = TONE[bad ? "alert" : tone];
  const neutral = !bad && tone === "idle";
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5">
      <span className="flex flex-col items-center">
        <i
          className={cn(
            "mt-[5px] size-2.5 shrink-0 rounded-full",
            n.state === "NOT_REACHED" && "shadow-[inset_0_0_0_1.5px_var(--faint)]",
            n.state === "DONE" && "bg-muted-foreground",
            (cur || bad) && (neutral ? "bg-foreground shadow-[0_0_0_3px_var(--border)]" : cn(t.dot, HALO[bad ? "alert" : tone])),
          )}
        />
        {!last && <i className="mt-1 w-0.5 flex-1 bg-border" />}
      </span>
      <div className={cn("flex min-w-0 flex-col gap-2", !last && "pb-[18px]")}>
        <div className="flex items-start gap-2.5">
          <span className={cn("shrink-0 text-sm leading-5 font-semibold", n.state === "NOT_REACHED" ? "text-faint" : "text-foreground")}>{NAMES[n.node]}</span>
          <span className={cn("min-w-0 flex-1 text-[13px] leading-5", bad ? "font-medium text-alert" : cur ? cn("font-medium", neutral ? "text-foreground" : t.text) : "text-muted-foreground")}>{step.status}</span>
          {step.time && <span className="shrink-0 text-xs leading-5 text-faint">{step.time}</span>}
        </div>
        {!!step.earlier?.length && (
          <>
            <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="inline-flex h-6 items-center gap-1 self-start text-[13px] text-muted-foreground">
              {step.earlier.length === 1 ? step.earlier[0] : `之前 ${step.earlier.length} 次`}
              {earlier ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {earlier && step.earlier.length > 1 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-muted-foreground">
                {step.earlier.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {step.note && (
          <p className="m-0 flex items-start gap-2 rounded-[10px] bg-muted px-2.5 py-2 text-[13px] leading-5 [overflow-wrap:anywhere] text-subtle-foreground">
            {step.skip && <Scissors className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span className="min-w-0">{step.note}</span>
          </p>
        )}
        {step.photo && (
          <>
            <button type="button" aria-expanded={photo} onClick={() => setPhoto(!photo)} className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-full bg-muted px-2.5 text-[13px] font-medium text-subtle-foreground">
              <Camera className="size-4" aria-hidden="true" />
              {step.photo.label}
              {photo ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {photo && <img src={step.photo.url} alt={step.photo.label} className="aspect-video w-full rounded-xl bg-muted object-cover" />}
          </>
        )}
      </div>
    </li>
  );
}
