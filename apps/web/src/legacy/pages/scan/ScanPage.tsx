import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { FigmaIcon } from "../../components/icons/FigmaIcon";
import { Icon } from "../../components/icons/Icon";
import { ModelThumb } from "../../components/ModelThumb";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { t } from "../../lib/motion";
import { type PickupError, type PickupOrder, type Redemption, codeFromScan, pickupApi, showCode } from "../../lib/pickupApi";
import { type CamState, useQrScanner } from "../../lib/useQrScanner";

type Result = { k: "bad"; t: string; s: string } | { k: "ok" | "done"; code: string; o: PickupOrder } | null;

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** ISO time as "10-24 07:55", or just "07:55" when it is today. */
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? hm(d) : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)}`;
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const NOT_READY: Record<string, string> = {
  PENDING_REVIEW: "还在等审核",
  REJECTED: "审核没有通过",
  SLICED: "还在排队",
  PRINTING: "正在打印",
  FAILED: "打印失败了",
  PRINTED_AWAITING_STORAGE: "已经打完，还没入库",
  COMPLETED: "已经完成",
};

function errorResult(e: PickupError): Result {
  switch (e.code) {
    case "pickup-code-invalid":
      return { k: "bad", t: "取件码无效", s: "没有找到这个取件码，或者它已经被新生成的码替换。请让对方在「我的订单」里重新出示。" };
    case "pickup-already-redeemed":
      return { k: "bad", t: "这个取件码已核销", s: `#${e.orderId} 已于 ${when(e.redeemedAt)} 由 ${e.redeemedBy.name} 核销给 ${e.owner.name}。` };
    case "pickup-code-expired":
      return { k: "bad", t: "取件码已过期", s: `#${e.orderId} 的取件码已于 ${when(e.expiresAt)} 失效。取件码 10 分钟内有效，请让对方在「我的订单」里重新生成。` };
    case "order-not-ready":
      return { k: "bad", t: "订单还不能取件", s: `#${e.orderId} ${NOT_READY[e.status] ?? "还没入库"}，入库后才能核销。` };
    default:
      return { k: "bad", t: "查询失败", s: `${e.message}，请稍后重试。` };
  }
}

function Section({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4 ${className ?? ""}`}>
      <h2 className="m-0 text-[16px] leading-6 font-medium">{title}</h2>
      {children}
    </section>
  );
}

const CAM_NOTE: Partial<Record<CamState, { icon: string; t: string; s: string; retry?: boolean }>> = {
  idle: { icon: "photo_camera", t: "用摄像头扫取件码", s: "需要浏览器允许使用摄像头", retry: true },
  starting: { icon: "photo_camera", t: "正在打开摄像头…", s: "如果浏览器弹出权限请求，请选择允许" },
  denied: { icon: "no_photography", t: "摄像头权限被拒绝", s: "请在浏览器地址栏的网站设置里允许使用摄像头，然后重试；也可以手动输入取件码。", retry: true },
  nocam: { icon: "no_photography", t: "没有找到摄像头", s: "这台设备没有可用的摄像头，请手动输入取件码。", retry: true },
  busy: { icon: "no_photography", t: "摄像头被占用", s: "关闭其他正在使用摄像头的应用或标签页后重试。", retry: true },
  insecure: { icon: "lock", t: "需要 HTTPS 才能用摄像头", s: "浏览器只在 HTTPS 或 localhost 下开放摄像头。请用 HTTPS 地址打开面板，或手动输入取件码。" },
  unsupported: { icon: "no_photography", t: "这个浏览器不支持摄像头", s: "请换用新版 Chrome、Edge 或 Safari，或手动输入取件码。" },
  error: { icon: "error", t: "摄像头打开失败", s: "请重试，或手动输入取件码。", retry: true },
};

function Viewfinder({ active, onCode }: { active: boolean; onCode: (text: string) => void }) {
  const { videoRef, state, start, mirror } = useQrScanner(active, onCode);
  const live = state === "live";
  const note = CAM_NOTE[state];
  const corner = "absolute size-9 border-4 border-solid border-[#d0bcff]";
  return (
    <div
      aria-label="摄像头取景框"
      className="relative grid aspect-square place-items-center overflow-hidden rounded-xl text-[#e6e0e9] max-lg:mx-auto max-lg:w-[min(100%,400px)]"
      style={{ background: "radial-gradient(120% 90% at 50% 120%, #3a3640, #17151b)" }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"} ${mirror ? "-scale-x-100" : ""}`}
      />
      {live ? (
        <>
          <i className={`${corner} top-[16%] left-[16%] rounded-tl-[14px] border-r-0 border-b-0`} />
          <i className={`${corner} top-[16%] right-[16%] rounded-tr-[14px] border-b-0 border-l-0`} />
          <i className={`${corner} bottom-[16%] left-[16%] rounded-bl-[14px] border-t-0 border-r-0`} />
          <i className={`${corner} right-[16%] bottom-[16%] rounded-br-[14px] border-t-0 border-l-0`} />
          {active && <i className="scan-line absolute right-[18%] left-[18%] h-0.5 bg-[#d0bcff] shadow-[0_0_12px_#d0bcff]" />}
          <p className="absolute bottom-[4%] m-0 rounded-full bg-black/45 px-3 py-1 text-note">
            {active ? "把用户的取件码对准框内" : "已识别，处理完当前订单后继续扫码"}
          </p>
        </>
      ) : (
        note && (
          <div className="relative flex max-w-[300px] flex-col items-center gap-2 px-6 text-center" role="status">
            <Icon name={note.icon} size={40} className="opacity-80" />
            <b className="text-label-l font-medium">{note.t}</b>
            <span className="text-note opacity-80">{note.s}</span>
            {note.retry && (
              <Button className="mt-2" icon="photo_camera" onClick={start}>
                {state === "idle" ? "打开摄像头" : "重试"}
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function ScanPage() {
  const [recs, setRecs] = useState<Redemption[]>([]);
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Result>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const loadRecs = useCallback(() => pickupApi.redemptions(startOfToday()).then(setRecs), []);
  useEffect(() => {
    loadRecs();
  }, [loadRecs]);

  const lookup = async (c: string) => {
    setBusy(true);
    const r = await pickupApi.lookup(c);
    setBusy(false);
    setRes(r.ok ? { k: "ok", code: c, o: r.data } : errorResult(r.error));
  };
  const onScan = (text: string) => {
    navigator.vibrate?.(40);
    const c = codeFromScan(text);
    if (!c) return setRes({ k: "bad", t: "这不是取件码", s: "扫到的二维码不是 PlateRelay 取件码，请让对方在「我的订单」里点「出示取件码」。" });
    setCode(showCode(c));
    lookup(c);
  };
  const reset = () => {
    setRes(null);
    setCode("");
    input.current?.focus();
  };
  const confirm = async () => {
    if (res?.k !== "ok") return;
    setBusy(true);
    const r = await pickupApi.redeem(res.code);
    setBusy(false);
    setAsk(false);
    setRes(r.ok ? { ...res, k: "done" } : errorResult(r.error));
    loadRecs();
  };

  let body: ReactNode;
  if (!res)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-8 text-center text-on-variant">
        <FigmaIcon name="scanLine" className="size-10 opacity-60" />
        <div>扫描或输入取件码后，这里显示订单信息</div>
      </div>
    );
  else if (res.k === "bad")
    body = (
      <>
        <div className="flex items-start gap-3 rounded-xl bg-err-bg p-3.5">
          <Icon name="cancel" className="text-err" />
          <div>
            <b className="block text-label-l font-medium">{res.t}</b>
            <span className="text-note text-on-variant">{res.s}</span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="outlined" onClick={reset}>继续扫码</Button>
        </div>
      </>
    );
  else if (res.k === "done")
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-6 text-center text-ok">
        <Icon name="check_circle" size={48} />
        <b className="text-[18px] leading-6 font-medium">已核销 · #{res.o.orderId}</b>
        <span className="text-note text-on-variant">
          {res.o.owner.name} 已取走 {res.o.fileName}（{res.o.slot}）
        </span>
        <Button className="mt-3" onClick={reset}>继续扫码</Button>
      </div>
    );
  else
    body = (
      <>
        <div className="flex items-center gap-3 rounded-xl bg-sc-high px-3.5 py-3">
          <Avatar name={res.o.owner.name} size={44} />
          <div>
            <b className="block text-[15px] leading-5 font-medium">{res.o.owner.name}</b>
            <small className="text-body-s text-on-variant">{res.o.owner.role}</small>
          </div>
          <small className="ml-auto text-right text-body-s text-on-variant">请核对取件人</small>
        </div>
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3.5">
          <div className="size-16 overflow-hidden rounded-[10px] bg-sc-high">
            {res.o.thumbUrl ? (
              <img src={res.o.thumbUrl} alt="" className="size-full object-contain" />
            ) : (
              <ModelThumb c1={res.o.filaments[0]?.color} slot={false} />
            )}
          </div>
          <div className="min-w-0">
            <b className="block truncate text-label-l font-medium">{res.o.fileName}</b>
            <span className="text-body-s text-on-variant">
              #{res.o.orderId} · 第 {res.o.plateIndex} 盘 · {res.o.printerModel} · {res.o.weightG} g
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ok-bg px-4 py-3.5 text-ok">
          <div>
            <small className="block text-body-s opacity-85">暂存位置 · 入库 {when(res.o.storedAt)}</small>
            <b className="font-num text-[22px] leading-7 font-semibold">{res.o.slot}</b>
          </div>
          <Icon name="inventory_2" />
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">
          <Button variant="outlined" onClick={reset}>取消</Button>
          <Button icon="check" disabled={busy} onClick={() => setAsk(true)}>核销</Button>
        </div>
      </>
    );

  return (
    <Page>
      <PageHeader title="扫码核销" />
      <div className="grid grid-cols-[minmax(0,440px)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <Section title="扫描取件码">
          <Viewfinder active={!res && !busy} onCode={onScan} />
          <div className="flex items-center gap-3 text-body-s text-on-variant before:h-px before:flex-1 before:bg-outline-variant after:h-px after:flex-1 after:bg-outline-variant">或手动输入</div>
          <form
            className="flex items-center gap-2"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 9) lookup(code);
              else if (code) setRes({ k: "bad", t: "取件码不完整", s: "取件码是 8 位字母和数字，如 7K3Q-92XM。" });
            }}
          >
            <input
              ref={input}
              inputMode="text"
              placeholder="如 7K3Q-92XM"
              aria-label="取件码"
              value={code}
              onChange={(e) => setCode(showCode(e.target.value))}
              className="h-12 min-w-0 flex-1 rounded-t-lg border-0 bg-sc-high px-4 font-num text-[20px] leading-7 font-semibold tracking-[3px] text-on-surface uppercase shadow-[inset_0_-1px_0_var(--md-outline)] outline-0 placeholder:font-normal placeholder:tracking-normal focus:shadow-[inset_0_-2px_0_var(--md-primary)]"
            />
            <Button type="submit" disabled={busy}>查询</Button>
          </form>
        </Section>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="订单信息" className="min-h-[220px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={res ? `${res.k}-${"o" in res ? res.o.orderId : res.t}` : "idle"}
                className="flex flex-1 flex-col gap-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: t("medium2", "emphasizedDecelerate") }}
                exit={{ opacity: 0, transition: t("short2", "emphasizedAccelerate") }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          </Section>
          <Section title={`今日核销 · ${recs.length}`}>
            {recs.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {recs.map((r, i) => (
                  <li key={`${r.orderId}-${i}`} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-t border-solid border-outline-variant py-2.5 first:border-t-0">
                    <Avatar name={r.owner.name} size={36} />
                    <div className="min-w-0">
                      <b className="block text-label-l font-medium">
                        {r.fileName.replace(/\.gcode\.3mf$/, "")} · #{r.orderId}
                      </b>
                      <small className="text-body-s text-on-variant">{r.owner.name}</small>
                    </div>
                    <time dateTime={r.redeemedAt} className="font-num text-body-s text-on-variant">{when(r.redeemedAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-8 text-center text-on-variant">今天还没有核销记录</div>
            )}
          </Section>
        </div>
      </div>

      <Sheet
        open={ask && res?.k === "ok"}
        onClose={() => setAsk(false)}
        icon="task_alt"
        title={res && "o" in res ? `确认核销 #${res.o.orderId}？` : "确认核销"}
        footer={
          <>
            <Button variant="text" onClick={() => setAsk(false)}>返回</Button>
            <Button variant="text" disabled={busy} onClick={confirm}>确认核销</Button>
          </>
        }
      >
        {res && res.k !== "bad" && (
          <div className="text-label-l font-normal text-on-variant">
            请确认 <b className="font-medium text-on-surface">{res.o.owner.name}</b> 本人在场，并取走 {res.o.fileName}（{res.o.slot}）。核销后不能撤销。
          </div>
        )}
      </Sheet>
    </Page>
  );
}
