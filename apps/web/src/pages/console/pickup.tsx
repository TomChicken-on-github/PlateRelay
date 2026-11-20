import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, ScanLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { ApiError, client, errorText, idem, unwrap } from "@/lib/api";
import { orderName, orderNo } from "@/lib/order-status";
import { useAllOrders, useOrders, useTodo, type OrderSummary } from "@/lib/queries";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsolePage } from "./console-shell";
import { StoreDialog } from "./store-dialog";

const waited = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 3600 ? `${Math.max(1, Math.floor(s / 60))} 分钟` : s < 86400 ? `${Math.floor(s / 3600)} 小时` : `${Math.floor(s / 86400)} 天`;
};

/** A QR code in a camera frame, when the browser can read one; the field below always works (a scanner gun types into it). */
function Viewfinder({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | undefined;
    let timer = 0;
    let stopped = false;
    const det = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        void video.current?.play();
        timer = window.setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const r = await det.detect(video.current).catch(() => []);
          if (r[0]) onCode(r[0].rawValue);
        }, 400);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  const corner = "absolute size-7 border-white/85 opacity-85";
  return (
    <div role="img" aria-label="扫码取景" className="relative aspect-square w-full overflow-hidden rounded-2xl bg-neutral-900">
      <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" />
      <i className={cn(corner, "top-3.5 left-3.5 rounded-tl-[10px] border-t-[3px] border-l-[3px]")} />
      <i className={cn(corner, "top-3.5 right-3.5 rounded-tr-[10px] border-t-[3px] border-r-[3px]")} />
      <i className={cn(corner, "bottom-3.5 left-3.5 rounded-bl-[10px] border-b-[3px] border-l-[3px]")} />
      <i className={cn(corner, "right-3.5 bottom-3.5 rounded-br-[10px] border-r-[3px] border-b-[3px]")} />
      <i className="absolute inset-x-[22%] top-1/2 h-0.5 rounded bg-white/55" />
    </div>
  );
}

const normalise = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/** Staff redeem pickup codes and see what is waiting for pickup or for storage. */
export function ConsolePickup() {
  const me = useMe();
  const [tab, setTab] = useState<"ready" | "store">("ready");
  const [code, setCode] = useState("");
  const [looked, setLooked] = useState<string | null>(null);
  const [storing, setStoring] = useState<OrderSummary | null>(null);
  const ready = useAllOrders({ status: "READY", limit: 200 });
  const printed = useAllOrders({ status: "PRINTED", limit: 200 });
  const todo = useTodo();
  const readyItems = useMemo(() => [...(ready.data?.items ?? [])].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1)), [ready.data]);
  const details = useOrders(readyItems.map((o) => o.id));
  const overdue = new Set((todo.data ?? []).filter((t) => t.kind === "UNCLAIMED").map((t) => t.orderId));
  const occupied = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of readyItems) {
      const s = details.get(o.id)?.storage?.slot;
      if (s) m.set(s.toUpperCase(), orderNo(o.number));
    }
    return m;
  }, [readyItems, details]);
  const rows = tab === "ready" ? readyItems : (printed.data?.items ?? []);
  const lookup = (c: string) => {
    const v = normalise(c);
    if (v) setLooked(v);
  };

  return (
    <ConsolePage title="取件" className="mx-auto w-full max-w-[1040px] flex-none [&>header]:max-lg:hidden">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex w-full flex-col gap-3.5 self-center lg:w-[300px] lg:shrink-0 max-lg:w-[236px]">
          <Viewfinder onCode={lookup} />
          <form
            onSubmit={(e) => (e.preventDefault(), lookup(code))}
            className="flex h-[52px] items-center gap-2.5 rounded-full bg-card pr-2 pl-4 shadow-[inset_0_0_0_1px_var(--input)] focus-within:ring-[3px] focus-within:ring-ring/50 max-lg:w-[calc(100vw-32px)] max-lg:self-center"
          >
            <ScanLine className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PR1-XXXX-XXXX" aria-label="取件码" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 bg-transparent font-mono text-[15px] outline-none placeholder:text-faint" />
            <Button type="submit" disabled={!can(me, "order:redeem") || !normalise(code)}>
              核销
            </Button>
          </form>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <nav className="flex gap-0.5">
            {(
              [
                ["ready", "待取件", 0],
                ["store", "待入库", printed.data?.items.length ?? 0],
              ] as const
            ).map(([k, l, n]) => (
              <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-subtle-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground">
                {l}
                {n > 0 && <span className={cn("font-medium", tab === k ? "opacity-80" : "text-muted-foreground")}>{n}</span>}
              </button>
            ))}
          </nav>
          <div className="overflow-hidden rounded-2xl bg-card">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_96px_88px_88px] gap-3 border-b px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid">
              <span>订单</span>
              <span>选手</span>
              <span>暂存位</span>
              <span>已等待</span>
              <span />
            </div>
            {(ready.isPending || printed.isPending) && <Skeleton className="m-4 h-32" />}
            {!ready.isPending && rows.length === 0 && <p className="m-0 p-6 text-sm text-muted-foreground">{tab === "ready" ? "没有待取件的订单" : "没有待入库的订单"}</p>}
            <ul className="m-0 list-none p-0">
              {rows.map((o) => {
                const slot = details.get(o.id)?.storage?.slot;
                return (
                  <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_96px_88px_88px] lg:px-5 lg:py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm leading-5 font-semibold">{o.fileName ?? orderName(o)}</span>
                      <span className="hidden text-xs leading-4 text-muted-foreground lg:block">{orderNo(o.number)}</span>
                    </span>
                    <span className="order-3 col-span-2 flex items-center gap-2 text-[13px] text-muted-foreground lg:order-none lg:col-span-1 lg:text-foreground">
                      <UserAvatar id={o.owner.id ?? o.owner.name} name={o.owner.name} url={o.owner.avatarUrl} size={22} />
                      <span className="truncate">{o.owner.name}</span>
                      <span className="lg:hidden">· 等待 {waited(o.submittedAt)}</span>
                    </span>
                    <span className="font-mono text-base font-semibold max-lg:text-right lg:text-sm">{tab === "ready" ? (slot ?? "—") : "—"}</span>
                    <span className="hidden text-[13px] text-subtle-foreground lg:block">{waited(o.submittedAt)}</span>
                    <span className="max-lg:col-start-2 max-lg:row-start-2 max-lg:justify-self-end lg:justify-self-end">
                      {tab === "ready" && overdue.has(o.id) && <StatusPill tone="wait" label="已超期" />}
                      {tab === "store" && can(me, "order:store") && (
                        <Button size="sm" variant="card" onClick={() => setStoring(o)}>
                          入库
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
      {looked && <RedeemDialog code={looked} onClose={() => (setLooked(null), setCode(""))} />}
      {storing && <StoreDialog order={storing} open onOpenChange={(o) => !o && setStoring(null)} occupied={occupied} />}
    </ConsolePage>
  );
}

const PREFIX = /^PR1-/;

/** Look the code up, show who it is for and where the print is, and redeem on confirm. */
function RedeemDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const qc = useQueryClient();
  const full = PREFIX.test(code) ? code : `PR1-${code}`;
  const found = useQuery({ queryKey: ["pickup", full], retry: false, queryFn: () => unwrap(client.GET("/pickup/{code}", { params: { path: { code: full } } })) });
  const [done, setDone] = useState(false);
  const redeem = useMutation({
    mutationFn: () => unwrap(client.POST("/pickup/{code}/redeem", { params: { path: { code: full }, ...idem() }, body: { expectedStatus: "READY" } })),
    onSuccess: () => {
      setDone(true);
      for (const k of ["orders", "order", "overview", "todo"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const f = found.data;
  const invalid = found.error instanceof ApiError && found.error.status === 404;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="核销取件"
      width={440}
      footer={
        done || invalid || found.isError ? (
          <Button onClick={onClose}>关闭</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button disabled={!f || redeem.isPending} onClick={() => redeem.mutate()}>
              确认核销
            </Button>
          </>
        )
      }
    >
      <span className="-mt-3 font-mono text-[13px] leading-5 text-muted-foreground">{full}</span>
      {found.isPending && <Skeleton className="h-40" />}
      {invalid && <p className="m-0 text-sm text-alert">取件码无效、已过期或已核销</p>}
      {found.isError && !invalid && <p className="m-0 text-sm text-alert">{errorText(found.error)}</p>}
      {f && !done && (
        <>
          <span className="grid h-[72px] place-items-center rounded-[14px] bg-muted font-mono text-[32px] font-semibold tracking-[1px]">{f.storageSlot}</span>
          <dl className="m-0 -mt-2 flex flex-col text-sm">
            {(
              [
                ["选手", <span key="p" className="flex items-center gap-2"><UserAvatar id={f.order.owner.id ?? f.order.owner.name} name={f.order.owner.name} url={f.order.owner.avatarUrl} size={24} />{f.order.owner.name}</span>],
                ["订单", <span key="o" className="font-mono">{orderNo(f.order.number)}</span>],
                ["文件", f.order.fileName ?? orderName(f.order)],
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k} className="flex min-h-11 items-center justify-between border-t">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="m-0 min-w-0 truncate">{v}</dd>
              </div>
            ))}
          </dl>
          {f.photoUrl && <img src={f.photoUrl} alt="入库照片" className="size-24 rounded-xl object-cover" />}
          {redeem.error && <p className="m-0 text-[13px] text-alert">{errorText(redeem.error)}</p>}
        </>
      )}
      {done && (
        <div className="flex items-center gap-3 rounded-[14px] bg-ok-surface p-4 text-ok">
          <CircleCheck className="size-6 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold">已核销</span>
        </div>
      )}
    </Modal>
  );
}
