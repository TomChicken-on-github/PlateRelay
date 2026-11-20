import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { OrderThumb } from "@/components/order-thumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { API_PREFIX } from "@platerelay/shared/api";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { ago, clock, duration } from "@/lib/format";
import { orderName, orderNo } from "@/lib/order-status";
import { type OrderDetail, useAllOrders, useOrder } from "@/lib/queries";
import { useDesktop } from "@/lib/use-desktop";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";

/** Filament lines: a colour dot, material, nozzle side and grams. */
export function FilamentChips({ plate }: { plate: OrderDetail["plate"] }) {
  const side = (e: number | null) => {
    if (e == null || plate.nozzles.length < 2) return "";
    const n = plate.nozzles.find((x) => x.extruder === e);
    return n?.side === "LEFT" ? " · 左喷嘴" : n?.side === "RIGHT" ? " · 右喷嘴" : "";
  };
  return (
    <div className="flex flex-wrap gap-2">
      {plate.filaments.map((f) => (
        <span key={f.slot} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[13px] text-subtle-foreground">
          <i className="size-3 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: f.colour }} />
          {f.material}
          {side(f.extruder)}
          <span className="text-muted-foreground">{Math.round(f.usedGrams)} g</span>
        </span>
      ))}
    </div>
  );
}

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm leading-5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const sign = (s: number) => `${s >= 0 ? "+" : "−"}${Math.round(Math.abs(s) / 60)}m`;

/** Staff review: waiting orders on the left, the selected one on the right with 驳回 and 通过 in the footer. */
export function ConsoleReview() {
  const { id } = useParams();
  const desktop = useDesktop();
  const navigate = useNavigate();
  const list = useAllOrders({ status: "PENDING_REVIEW", limit: 100 });
  const items = [...(list.data?.items ?? [])].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  const selected = id ?? (desktop ? items[0]?.id : undefined);
  /* on a phone the list and the order are separate screens */
  const showDetail = !!selected && (desktop || !!id);

  useEffect(() => {
    if (id && list.data && !items.some((o) => o.id === id)) navigate("/console/review", { replace: true });
  }, [id, list.data, items, navigate]);

  return (
    <ConsolePage title="审核" sub={list.data ? `${items.length} 单待审核` : undefined} className={cn(!desktop && showDetail && "hidden")}>
      <div className="flex min-h-0 flex-1 gap-4">
        <ul className={cn("m-0 flex w-full list-none flex-col gap-1.5 p-0 lg:w-[340px] lg:shrink-0", !desktop && showDetail && "hidden")}>
          {list.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-[14px] bg-card" />)}
          {list.data && items.length === 0 && <li className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground lg:text-left">没有待审核的订单</li>}
          {items.map((o) => (
            <li key={o.id}>
              <Link to={`/console/review/${o.id}`} className={cn("flex gap-3 rounded-[14px] p-3 text-inherit no-underline", o.id === selected ? "bg-card shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "lg:hover:bg-card/60")}>
                <OrderThumb url={o.plate.thumbnailUrl} className="size-12 rounded-[10px]" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm leading-5 font-semibold">{o.fileName ?? orderName(o)}</span>
                  <span className="text-[13px] leading-[18px] text-subtle-foreground">{o.owner.name}</span>
                  <span className="text-xs leading-4 text-muted-foreground">{ago(o.submittedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {desktop && selected && <ReviewDetail id={selected} />}
      </div>
    </ConsolePage>
  );
}

/** Phone: one order on its own screen. */
export function ConsoleReviewScreen() {
  const { id } = useParams();
  const desktop = useDesktop();
  if (desktop || !id) return <ConsoleReview />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Link to="/console/review" aria-label="返回" className="-ml-2 grid size-10 place-items-center rounded-full">
        <ArrowLeft className="size-5" />
      </Link>
      <ReviewDetail id={id} />
    </div>
  );
}

function ReviewDetail({ id }: { id: string }) {
  const order = useOrder(id);
  const o = order.data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [visible, setVisible] = useState(true);
  const version = o?.pendingVersion ?? o?.activeVersion;
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["order", id] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
    void qc.invalidateQueries({ queryKey: ["todo"] });
    navigate("/console/review", { replace: true });
  };
  const approve = useMutation({
    mutationFn: () => unwrap(client.POST("/orders/{orderId}/approve", { params: { path: { orderId: id }, ...idem() }, body: { expectedStatus: o!.status, versionId: version!.id } })),
    onSuccess: done,
  });
  const reject = useMutation({
    mutationFn: () => unwrap(client.POST("/orders/{orderId}/reject", { params: { path: { orderId: id }, ...idem() }, body: { expectedStatus: o!.status, versionId: version!.id, reason: reason.trim(), reasonVisible: visible } })),
    onSuccess: () => (setRejecting(false), done()),
  });

  if (!o || !version) return <Skeleton className="min-h-[360px] flex-1 rounded-2xl bg-card" />;
  const revision = !!o.pendingVersion && version.kind !== "SUBMIT";
  const prev = revision ? o.activeVersion : null;
  const plate = version.plate;
  const warn = (o.findings ?? []).filter((f) => f.severity === "WARN");
  const err = approve.error ?? reject.error;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card">
      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto p-5 lg:px-7 lg:py-6">
        <header className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 min-w-0 break-all text-xl leading-7 font-bold">{version.fileName ?? o.fileName ?? orderName(o)}</h2>
            <span className="h-6 rounded-full bg-muted px-[9px] text-xs leading-6 font-semibold text-subtle-foreground">{revision ? `修改 · 第 ${version.n} 版` : "新提交"}</span>
          </div>
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <UserAvatar id={o.owner.id ?? o.owner.name} name={o.owner.name} url={o.owner.avatarUrl} size={22} />
            <span className="font-medium text-foreground">{o.owner.name}</span>· 提交于 {clock(version.createdAt)} · {orderNo(o.number)}
          </span>
        </header>

        {warn.map((f, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl bg-wait-surface px-3 py-2.5 text-[13px] font-semibold text-wait">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            文件检查提示：{f.code}
          </div>
        ))}

        {prev && (
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-[15px] leading-[22px] font-semibold">与上一版对比</h3>
            <Dl
              rows={[
                ["预计时长", <>{duration(prev.plate.printSeconds)} → <b>{duration(plate.printSeconds)}</b>{version.deltaSeconds != null && `（${sign(version.deltaSeconds)}）`}</>],
                ["耗材用量", `${Math.round(prev.plate.weightGrams)} g → ${Math.round(plate.weightGrams)} g`],
                ...(version.placesBack ? ([["排队位置", version.placesBack < 0 ? "退到队尾" : `后退 ${version.placesBack} 位`]] as [string, string][]) : []),
              ]}
            />
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[15px] leading-[22px] font-semibold">文件</h3>
            {version.fileAvailable && (
              <Button asChild variant="card" size="sm">
                <a href={`${API_PREFIX}/orders/${o.id}/versions/${version.n}/file`}>
                  <Download aria-hidden="true" />
                  下载文件
                </a>
              </Button>
            )}
          </div>
          <div className="flex gap-4">
            <OrderThumb url={plate.thumbnailUrl} className="size-[120px] rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <span className="text-sm font-semibold">第 {plate.index} 盘</span>
              <Dl
                rows={[
                  ["机型", `${plate.modelName ?? plate.modelId}${plate.nozzles[0] ? ` · ${plate.nozzles.map((n) => n.diameterMm).join(" / ")} mm 喷嘴` : ""}`],
                  ...(o.bedType ? ([["打印板", o.bedType]] as [string, string][]) : []),
                  ["预计", `${duration(plate.printSeconds)} · ${Math.round(plate.weightGrams)} g`],
                ]}
              />
              <FilamentChips plate={plate} />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-[15px] leading-[22px] font-semibold">申请信息</h3>
          <Dl
            rows={[
              ...(o.answers ?? []).filter((a) => a.value != null && a.value !== "").map((a) => [a.label, Array.isArray(a.value) ? a.value.join("、") : String(a.value)] as [string, string]),
              ["颜色要求", { EXACT: "必须一致", SIMILAR: "相近即可", ANY: "不限" }[o.colourPref]],
            ]}
          />
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t px-5 py-4 lg:px-7">
        {err && <span className="mr-auto text-[13px] text-alert">{errorText(err)}</span>}
        <Button variant="destructive" size="lg" onClick={() => setRejecting(true)} disabled={approve.isPending}>
          驳回
        </Button>
        <Button size="lg" onClick={() => approve.mutate()} disabled={approve.isPending}>
          通过
        </Button>
      </footer>

      <Modal
        open={rejecting}
        onOpenChange={setRejecting}
        title={revision ? "驳回修改" : "驳回"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              取消
            </Button>
            <Button variant="danger" disabled={!reason.trim() || reject.isPending} onClick={() => reject.mutate()}>
              驳回
            </Button>
          </>
        }
      >
        <span className="-mt-3 text-[13px] leading-5 text-muted-foreground">
          {revision ? "退回上一版，保持原排队位置" : `${o.fileName ?? orderName(o)} · ${o.owner.name}`}
        </span>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span>
            原因<span className="text-alert"> *</span>
          </span>
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox checked={visible} onCheckedChange={(v) => setVisible(v === true)} />
          选手可见
        </label>
      </Modal>
    </div>
  );
}
