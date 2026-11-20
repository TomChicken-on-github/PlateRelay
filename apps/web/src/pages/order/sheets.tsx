import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { OrderThumb } from "@/components/order-thumb";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Confirm, Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { client, errorText, idem, type Schemas, unwrap, uploadFile } from "@/lib/api";
import { duration } from "@/lib/format";
import { orderName, orderNo } from "@/lib/order-status";
import type { OrderDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";

type SheetProps = { order: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void };

/* Refresh what shows this order after a change. */
function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["order", id] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
  };
}

const CANCEL_REASONS = ["文件有误", "不再需要", "需修改模型", "其他"];

/** Cancel: one reason, plus a note that is required when the reason is 其他. */
export function CancelSheet({ order, open, onOpenChange }: SheetProps) {
  const refresh = useRefresh(order.id);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const other = reason === "其他";
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/orders/{orderId}/cancel", {
          params: { path: { orderId: order.id }, ...idem() },
          body: { expectedStatus: order.status, reason: other ? note.trim() : note.trim() ? `${reason}：${note.trim()}` : reason },
        }),
      ),
    onSuccess: () => (refresh(), onOpenChange(false)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="取消订单"
      sub={`${orderName(order)} · ${orderNo(order.number)}`}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            返回
          </Button>
          <Button variant="danger" size="lg" disabled={(other && !note.trim()) || cancel.isPending} onClick={() => cancel.mutate()}>
            确认取消
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold">取消原因</span>
        <div role="radiogroup" aria-label="取消原因" className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn("h-9 rounded-full px-3.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", reason === r ? "bg-primary text-primary-foreground" : "bg-card shadow-[inset_0_0_0_1px_var(--border)]")}
            >
              {r}
            </button>
          ))}
        </div>
        <Textarea aria-label="补充说明" placeholder="补充说明" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="resize-none border-0 bg-muted" />
        {cancel.error && <Alert>{errorText(cancel.error)}</Alert>}
      </div>
    </Sheet>
  );
}

/**
 * Revise: pick a new file, see it against the current version, submit it as the next version.
 * The new file's plate is the one with the same number as this order's plate, else its first.
 */
export function ReviseSheet({ order, open, onOpenChange }: SheetProps) {
  const refresh = useRefresh(order.id);
  const picker = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState<Schemas["FileCheck"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      let c = await uploadFile(file, {});
      while (c.status === "QUEUED" || c.status === "RUNNING") {
        await new Promise((r) => setTimeout(r, 1000));
        c = await unwrap(client.GET("/files/{fileId}/check", { params: { path: { fileId: c.fileId } } }));
      }
      if (c.status === "ERROR" || c.verdict === "REJECT" || !c.plates.length) setError("文件没有通过校验");
      else setCheck(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const plate = check ? (check.plates.find((p) => p.index === order.plate.index) ?? check.plates[0]) : null;
  const old = order.activeVersion.plate;
  const nextN = Math.max(...order.versions.map((v) => v.n)) + 1;
  const delta = plate ? Math.round((plate.printSeconds - old.printSeconds) / 60) : 0;

  const revise = useMutation({
    mutationFn: () =>
      unwrap(client.POST("/orders/{orderId}/versions", { params: { path: { orderId: order.id }, ...idem() }, body: { expectedStatus: order.status, fileId: check!.fileId, plate: plate!.index } })),
    onSuccess: () => (refresh(), onOpenChange(false), setCheck(null)),
  });

  const nozzle = (p: Schemas["Plate"]) => [...new Set(p.nozzles.map((n) => n.diameterMm))].join(" / ") + " mm";
  const rows: { k: string; old?: string; v: string; hint?: string }[] = plate
    ? [
        { k: "机型", v: `${plate.modelName ?? plate.modelId} · ${nozzle(plate)}`, old: plate.modelId !== old.modelId ? `${old.modelName ?? old.modelId}` : undefined },
        { k: "预计时长", old: duration(old.printSeconds), v: duration(plate.printSeconds), hint: delta ? `${delta > 0 ? "+" : "−"}${Math.abs(delta)} 分钟` : undefined },
        { k: "耗材用量", old: `${Math.round(old.weightGrams)} g`, v: `${Math.round(plate.weightGrams)} g` },
        { k: "修改次数", v: `第 ${order.revisions.used + 1} 次（上限 ${order.revisions.max} 次）` },
      ]
    : [];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="修改文件"
      sub={`${orderName(order)} · ${orderNo(order.number)} · 第 ${order.activeVersion.n} 版 → 第 ${nextN} 版`}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            返回
          </Button>
          <Button size="lg" disabled={!plate || !plate.submittable || revise.isPending} onClick={() => revise.mutate()}>
            提交修改
          </Button>
        </>
      }
    >
      <input
        ref={picker}
        type="file"
        accept=".3mf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3 rounded-[14px] bg-muted p-3">
          <OrderThumb url={plate?.thumbnailUrl} className="size-12 rounded-[10px] bg-card" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium [overflow-wrap:anywhere]">{check?.fileName ?? (busy ? "上传中" : "选择新文件")}</span>
            {check && plate && (
              <span className="text-xs text-muted-foreground">
                第 {nextN} 版 · {check.plates.length > 1 ? `第 ${plate.index} / ${check.plates.length} 盘` : "共 1 盘"}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="bg-card shadow-none" disabled={busy} onClick={() => picker.current?.click()}>
            <FileUp className="size-4" aria-hidden="true" />
            {check ? "重新选择" : "选择文件"}
          </Button>
        </div>
        {rows.length > 0 && (
          <dl className="m-0 flex flex-col">
            {rows.map((r, i) => (
              <div key={r.k} className={cn("grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-[9px]", i && "shadow-[inset_0_1px_0_var(--border)]")}>
                <dt className="text-[13px] leading-5 text-muted-foreground">{r.k}</dt>
                <dd className="m-0 flex flex-wrap items-baseline gap-1.5 text-sm leading-5">
                  {r.old && (
                    <>
                      <span className="text-faint">{r.old}</span>
                      <span aria-hidden="true" className="text-faint">
                        →
                      </span>
                    </>
                  )}
                  <span>{r.v}</span>
                  {r.hint && <span className="text-xs text-muted-foreground">{r.hint}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {plate && !plate.submittable && <Alert>本场没有能打这个文件的打印机</Alert>}
        {(error || revise.error) && <Alert>{error ?? errorText(revise.error)}</Alert>}
      </div>
    </Sheet>
  );
}

/** Skip parts of the print in progress. At least one part must keep printing; the skip is confirmed once more. */
export function SkipSheet({ order, open, onOpenChange }: SheetProps) {
  const refresh = useRefresh(order.id);
  const supported = !!order.parts;
  const data = useQuery({
    queryKey: ["order", order.id, "parts"],
    enabled: open && supported,
    queryFn: () => unwrap(client.GET("/orders/{orderId}/parts", { params: { path: { orderId: order.id } } })),
  });
  const [picked, setPicked] = useState<number[]>([]);
  const [confirm, setConfirm] = useState(false);
  const parts = data.data?.parts ?? [];
  const skipped = new Set(data.data?.skipped ?? order.parts?.skipped ?? []);
  const left = parts.filter((p) => !skipped.has(p.id)).length;
  const all = picked.length > 0 && picked.length >= left;
  const job = order.printJobs?.find((j) => !j.endedAt);

  const skip = useMutation({
    mutationFn: () => unwrap(client.POST("/orders/{orderId}/skip-parts", { params: { path: { orderId: order.id }, ...idem() }, body: { expectedStatus: "PRINTING", expectedJobId: job!.jobId, partIds: picked } })),
    onSuccess: () => (refresh(), setConfirm(false), setPicked([]), onOpenChange(false)),
  });
  const names = parts.filter((p) => picked.includes(p.id)).map((p) => p.name);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="跳过零件"
        sub={job?.printerName}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              返回
            </Button>
            <Button variant="danger" size="lg" disabled={!supported || !picked.length || all || !job} onClick={() => setConfirm(true)}>
              {supported ? `跳过所选（${picked.length}）` : "跳过所选"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {data.data?.topUrl && <img src={data.data.topUrl} alt="打印板俯视图" className="size-[220px] self-center rounded-[14px] bg-neutral-800 object-contain" />}
          {supported ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">零件</span>
                <span className="text-[13px] text-muted-foreground">
                  已选 {picked.length} / {parts.length}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {parts.map((p, i) => {
                  const done = skipped.has(p.id);
                  const sel = picked.includes(p.id);
                  return (
                    <li key={p.id} className={cn(i && "shadow-[inset_0_1px_0_var(--border)]")}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={sel}
                        disabled={done}
                        onClick={() => setPicked(sel ? picked.filter((x) => x !== p.id) : [...picked, p.id])}
                        className={cn("flex h-10 w-full items-center gap-2.5 text-left outline-none", done ? "text-faint" : "text-foreground")}
                      >
                        <span className={cn("grid size-5 place-items-center rounded-md", sel ? "bg-primary text-primary-foreground" : done ? "shadow-[inset_0_0_0_1.5px_var(--border)]" : "shadow-[inset_0_0_0_1.5px_var(--faint)]")}>
                          {sel && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                        <span className="w-[18px] text-xs font-semibold text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                        {done && <span className="text-xs text-faint">已跳过</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="m-0 rounded-xl bg-muted p-3 text-sm leading-[22px] text-subtle-foreground">此文件切片时未启用对象标签，无法跳过零件。</p>
          )}
          {all && <p className="m-0 text-center text-[13px] leading-5 text-muted-foreground">需至少保留 1 个零件继续打印</p>}
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="确认跳过所选零件"
        footer={
          <>
            <Button variant="secondary" className="h-11" onClick={() => setConfirm(false)}>
              返回
            </Button>
            <Button variant="danger" className="h-11" disabled={skip.isPending} onClick={() => skip.mutate()}>
              确认跳过
            </Button>
          </>
        }
      >
        将跳过：<b className="font-semibold text-foreground">{names.join("、")}</b>。此操作<b className="font-semibold text-foreground">无法撤销</b>。
        {skip.error && <span className="mt-2 block text-alert">{errorText(skip.error)}</span>}
      </Confirm>
    </>
  );
}
