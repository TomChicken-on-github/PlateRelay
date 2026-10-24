import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { FilterTabs, StatusChip } from "../../components/Chip";
import { Field, Select } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { PhotoPlaceholder } from "../../components/ModelThumb";
import { Empty, OrderActions, OrderBody, OrderCard, OrderGrid, OrderHead, PlateMeta, StatusBlock, Thumb } from "../../components/OrderBits";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { WavyProgress } from "../../components/WavyProgress";
import { cx } from "../../lib/cx";
import { t } from "../../lib/motion";
import { type MyOrder, type OrderGroup, STATUS, myOrders } from "../../mock/myOrders";
import { ME } from "../../mock/session";

type TabKey = "all" | OrderGroup;
const TABS: [TabKey, string][] = [["all", "全部"], ["act", "进行中"], ["pick", "待取件"], ["todo", "需处理"], ["end", "已结束"]];
const CANCEL_WHY = ["文件传错了", "不需要了", "要改模型", "其他"];

function OrderStatusBlock({ o }: { o: MyOrder }) {
  switch (o.st) {
    case "pending":
      return <StatusBlock icon="hourglass_top" title="待审核" right={`提交于 ${o.at}`}>通过后自动进入排队；开始打印前可以自行取消。</StatusBlock>;
    case "queued":
      return <StatusBlock icon="schedule" title={`队列第 ${o.pos} 位`} right={o.ahead ? `前方 ${o.ahead}` : undefined}>{o.wait ?? "空闲且兼容的打印机会从队首开始接单。"}</StatusBlock>;
    case "printing":
      return (
        <StatusBlock tone="ok" icon="print" title={`${o.printer} 打印中`} right={`${o.pct}% · 剩余 ${o.left}`}>
          <WavyProgress pct={o.pct ?? 0} className="mb-2" />
          预计 {o.eta} 完成
        </StatusBlock>
      );
    case "paused":
      return <StatusBlock icon="hourglass_top" title={`等待处理 · ${o.why}`}>打印已暂停，工作人员处理后会继续，你不需要操作。</StatusBlock>;
    case "awaiting":
      return <StatusBlock icon="inventory_2" title="打印完成，等待入库" right={o.done}>工作人员铲件、验货并放入暂存篮后，你会收到取件通知。</StatusBlock>;
    case "ready":
      return <StatusBlock tone="ok" icon="check_circle" title={`可以取件：${o.slot}`} right={o.when}>到现场出示取件码，工作人员扫码核销。</StatusBlock>;
    case "rejected":
      return <StatusBlock tone="err" icon="error" title="审核未通过" right={o.by}>{o.reason}</StatusBlock>;
    case "failed":
      return (
        <StatusBlock tone="err" icon="error" title={`${o.printer} 打印失败`}>
          {o.reason}
          <br />
          {o.retried ? `已重打为订单 #${o.retried}。` : "可以一键重打：按已用耗材折算后派生一张新订单，重新进入审核。"}
        </StatusBlock>
      );
    case "done":
      return <StatusBlock icon="check_circle" title="已取件" right={o.when} />;
    default:
      return <StatusBlock icon="close" title="已取消">{o.reason}</StatusBlock>;
  }
}

/* ---------- record timeline ---------- */

type Tone = "ok" | "bad" | "cur" | "wait";
type RecNode = { t: string; who?: string; sys?: boolean; pool?: boolean; s: string; tone: Tone; time?: string; note?: string; more?: { printer?: string; photo?: boolean; label?: string } };

function recNodes(o: MyOrder): RecNode[] {
  const rev = o.by || "Builder 赵乐", staff = "Staff 陈一帆", st = o.st;
  const N: RecNode[] = [{ t: "提交申请", who: ME.name, s: "已提交", tone: "ok", time: o.at }];
  /* Staff steps that have not happened yet have no person attached. */
  const later = (...k: ("print" | "stock" | "pick")[]) =>
    k.map((x): RecNode => (x === "print" ? { t: "打印", sys: true, s: "待打印", tone: "wait" } : x === "stock" ? { t: "入库", s: "待入库", tone: "wait" } : { t: "取件", s: "待核销", tone: "wait" }));
  if (st === "cancelled") return [...N, { t: "取消订单", who: ME.name, s: "已取消", tone: "bad", note: o.reason?.replace("你取消了：", "") }];
  if (st === "pending") return [...N, { t: "审核", pool: true, s: "待审核", tone: "cur" }, { t: "排队", sys: true, s: "待排队", tone: "wait" }, ...later("print", "stock", "pick")];
  if (st === "rejected") return [...N, { t: "审核", who: rev, s: "已驳回", tone: "bad", time: o.at, note: o.reason }];
  N.push({ t: "审核", who: rev, s: "已通过", tone: "ok", time: o.at });
  if (st === "queued") return [...N, { t: "排队", sys: true, s: `排队中 · 第 ${o.pos} 位`, tone: "cur", note: o.wait }, ...later("print", "stock", "pick")];
  N.push({ t: "排队", sys: true, s: "已派单", tone: "ok" });
  if (st === "printing" || st === "paused")
    return [...N, { t: "打印", sys: true, s: st === "paused" ? `等待处理 · ${o.why}` : `${o.printer} 打印中 · ${o.pct}%`, tone: "cur", more: { printer: o.printer } }, ...later("stock", "pick")];
  if (st === "failed") {
    N.push({ t: "打印", sys: true, s: `${o.printer} 打印失败`, tone: "bad", note: o.reason, more: { photo: true, label: "失败时现场" } });
    if (o.retried) N.push({ t: "重打", sys: true, s: `已派生新订单 #${o.retried}`, tone: "ok" });
    return N;
  }
  N.push({ t: "打印", sys: true, s: "打印完成", tone: "ok", time: o.done, more: { photo: true, label: "打印完成" + (o.done ? " · " + o.done : "") } });
  if (st === "awaiting") return [...N, { t: "入库", s: "待入库", tone: "cur" }, { t: "取件", s: "待核销", tone: "wait" }];
  N.push({ t: "入库", who: staff, s: "已入库", tone: "ok", time: o.when, note: `暂存位：${o.slot || "暂存篮"}`, more: { photo: true, label: "入库验货" + (o.when ? " · " + o.when : "") } });
  N.push(st === "ready" ? { t: "取件", s: "待核销", tone: "cur", note: "出示取件码，由工作人员扫码核销" } : { t: "取件", who: staff, s: "已核销", tone: "ok", time: o.when });
  return N;
}

const DOT: Record<Tone, string> = { ok: "border-ok", bad: "border-error", cur: "border-primary bg-primary", wait: "border-outline" };
const SUB: Record<Tone, string> = { ok: "text-ok", bad: "text-error", cur: "text-primary", wait: "text-on-variant" };

function Timeline({ o }: { o: MyOrder }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const nodes = recNodes(o);
  return (
    <ol className="m-0 mt-1 list-none p-0">
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        const ex = !!open[n.t];
        const more = n.more && (
          <>
            {n.more.printer ? (
              <Link to={`/printers/${n.more.printer}`} className="state-layer mt-2 inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-lg pr-3 pl-2.5 text-note font-medium text-primary no-underline shadow-[inset_0_0_0_1px_var(--md-outline)]">
                <Icon name="open_in_new" size={18} />查看 {n.more.printer} 机台
              </Link>
            ) : (
              <button
                type="button"
                aria-expanded={ex}
                onClick={() => setOpen((s) => ({ ...s, [n.t]: !s[n.t] }))}
                className="state-layer mt-2 inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-lg border-0 bg-transparent pr-3 pl-2.5 text-note font-medium text-primary shadow-[inset_0_0_0_1px_var(--md-outline)]"
              >
                <Icon name="image" size={18} />查看照片
                <Icon name="expand_more" size={18} className={cx("transition-transform duration-200", ex && "rotate-180")} />
              </button>
            )}
            <AnimatePresence initial={false}>
              {n.more.photo && ex && (
                <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1, transition: t("medium2", "emphasizedDecelerate") }} exit={{ height: 0, opacity: 0, transition: t("short3", "emphasizedAccelerate") }}>
                  <div className="pt-2.5">
                    <PhotoPlaceholder c={o.fil[0][0]} label={n.more.label} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        );
        const note = n.note && <div className={cx("rounded-xl bg-sc px-3.5 py-2.5 text-label-l tracking-normal", n.who ? "mt-2.5 ml-[52px]" : "mt-2")}>{n.note}</div>;
        return (
          <li key={n.t} className={cx("relative pl-[26px]", last ? "pb-1" : "pb-[22px]")}>
            {!last && <span className={cx("absolute top-[18px] bottom-0 left-[5px] w-0.5", n.tone === "ok" ? "bg-ok opacity-50" : "bg-outline-variant")} />}
            <i className={cx("absolute top-[5px] left-0 size-3 rounded-full border-2 border-solid bg-sc-high", DOT[n.tone])} />
            {n.who ? (
              <>
                <div className={cx("mb-2 text-[15px] leading-[22px]", n.tone === "wait" ? "font-medium text-on-variant" : "font-semibold")}>{n.t}</div>
                <div className={cx("grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3", n.tone === "wait" && "opacity-55")}>
                  <span className="relative block size-10">
                    <Avatar name={n.who} size={40} />
                    {(n.tone === "ok" || n.tone === "bad") && (
                      <span className="absolute -right-[3px] -bottom-[3px] grid size-[18px] place-items-center rounded-full bg-sc-high">
                        <Icon name={n.tone === "ok" ? "check_circle" : "cancel"} fill size={18} className={n.tone === "ok" ? "text-ok" : "text-error"} />
                      </span>
                    )}
                  </span>
                  <div>
                    <b className="block text-label-l font-medium">{n.who}</b>
                    <span className={cx("block text-note", SUB[n.tone])}>{n.s}</span>
                  </div>
                  <time className="self-start text-body-s leading-5 tracking-normal text-on-variant tnum">{n.time}</time>
                </div>
              </>
            ) : (
              <div className="flex items-baseline gap-2.5">
                <span className={cx("text-[15px] leading-[22px]", n.tone === "wait" ? "font-medium text-on-variant" : "font-semibold")}>{n.t}</span>
                <span className={cx("text-note", SUB[n.tone])}>{n.s}</span>
                <time className="ml-auto font-num text-body-s leading-[18px] tracking-normal text-on-variant">{n.time}</time>
              </div>
            )}
            {note}
            {more}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- pickup QR ---------- */

/** Deterministic stand-in for a QR code (25x25 modules with three finder patterns). */
function FakeQR({ code }: { code: string }) {
  let h = 0;
  for (const c of code) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  const rnd = () => (h = (h * 1664525 + 1013904223) >>> 0) / 4294967296;
  const N = 25, cell = 8;
  const fin = (x: number, y: number) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  let p = "";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!fin(x, y) && rnd() > 0.5) p += `M${x * cell} ${y * cell}h${cell}v${cell}h-${cell}z`;
  const F = ({ x, y }: { x: number; y: number }) => (
    <>
      <path d={`M${x} ${y}h56v56h-56z`} fill="#000" />
      <path d={`M${x + 8} ${y + 8}h40v40h-40z`} fill="#fff" />
      <path d={`M${x + 16} ${y + 16}h24v24h-24z`} fill="#000" />
    </>
  );
  return (
    <svg viewBox={`0 0 ${N * cell} ${N * cell}`} role="img" aria-label="取件二维码" className="block size-[200px]">
      <path d={p} fill="#000" />
      <F x={0} y={0} />
      <F x={(N - 7) * cell} y={0} />
      <F x={0} y={(N - 7) * cell} />
    </svg>
  );
}

/* ---------- page ---------- */

type SheetState = { type: "detail" | "qr" | "cancel" | "retry"; id: number } | null;

export function MyOrdersPage() {
  const navigate = useNavigate();
  const orders = myOrders.use();
  const [tab, setTab] = useState<TabKey>("all");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [last, setLast] = useState<NonNullable<SheetState>>({ type: "detail", id: 0 });
  const [key, setKey] = useState(0);
  const [reason, setReason] = useState("");

  const open = (s: NonNullable<SheetState>) => {
    setSheet(s);
    setLast(s);
    setKey((k) => k + 1);
    setReason("");
  };
  const close = () => setSheet(null);
  const o = orders.find((x) => x.id === last.id);

  const todo = orders.filter((x) => STATUS[x.st].g === "todo" && !x.retried).length;
  const list = orders.filter((x) => tab === "all" || STATUS[x.st].g === tab).sort((a, b) => b.id - a.id);

  const confirmCancel = () => {
    myOrders.set((s) => s.map((x) => (x.id === last.id ? { ...x, st: "cancelled", reason: "你取消了：" + reason } : x)));
    close();
  };
  const confirmRetry = () => {
    myOrders.set((s) => {
      const src = s.find((x) => x.id === last.id)!;
      const id = Math.max(...s.map((x) => x.id)) + 1;
      return [...s.map((x) => (x.id === src.id ? { ...x, retried: id } : x)), { ...src, id, st: "pending", at: "10-24 09:40", printer: undefined, pct: undefined, reason: undefined, retried: undefined }];
    });
    close();
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <Page>
      <PageHeader title="我的订单" actions={<Button icon="add" onClick={() => navigate("/submit")}>提交订单</Button>} />
      <FilterTabs
        label="订单筛选"
        value={tab}
        onChange={setTab}
        items={TABS.map(([k, l]) => ({ key: k, label: l, count: k === "all" ? orders.length : orders.filter((x) => STATUS[x.st].g === k).length, dot: k === "todo" && todo > 0 }))}
      />
      {list.length ? (
        <OrderGrid>
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((x) => {
              const s = STATUS[x.st];
              return (
                <motion.div key={x.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1, transition: t("medium2", "emphasizedDecelerate") }} exit={{ opacity: 0, scale: 0.96, transition: t("short3", "emphasizedAccelerate") }} className="flex">
                  <OrderCard
                    className="flex-1"
                    tabIndex={0}
                    role="button"
                    aria-label={`订单 ${x.id}，${s.t}`}
                    onClick={() => open({ type: "detail", id: x.id })}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        open({ type: "detail", id: x.id });
                      }
                    }}
                  >
                    <OrderHead id={x.id} chip={<StatusChip tone={s.tone}>{s.t}</StatusChip>} right={x.at} />
                    <OrderBody thumb={<Thumb fil={x.fil} />} name={x.file} meta={<PlateMeta parts={[`第 ${x.n} 盘 · ${x.model} · ${x.nozzle} mm`, `${x.time} · ${x.g} g`]} fil={x.fil} />} />
                    <OrderStatusBlock o={x} />
                    {(x.st === "ready" || x.st === "pending" || x.st === "queued" || (x.st === "failed" && !x.retried) || x.st === "rejected") && (
                      <OrderActions>
                        {x.st === "ready" && <Button icon="qr_code_2" onClick={(e) => (stop(e), open({ type: "qr", id: x.id }))}>出示取件码</Button>}
                        {(x.st === "pending" || x.st === "queued") && <Button variant="outlined" icon="cancel" onClick={(e) => (stop(e), open({ type: "cancel", id: x.id }))}>取消订单</Button>}
                        {x.st === "failed" && !x.retried && <Button icon="replay" onClick={(e) => (stop(e), open({ type: "retry", id: x.id }))}>一键重打</Button>}
                        {x.st === "rejected" && <Button variant="tonal" icon="send" onClick={(e) => (stop(e), navigate("/submit"))}>修改后重新提交</Button>}
                      </OrderActions>
                    )}
                  </OrderCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </OrderGrid>
      ) : (
        <Empty icon="description">这里还没有订单</Empty>
      )}

      {o && (
        <>
          <Sheet key={`d${key}`} open={sheet?.type === "detail"} onClose={close} title={`订单 #${o.id}`} sub={`${o.file} · 第 ${o.n} 盘`} footer={<Button variant="text" onClick={close}>关闭</Button>}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-note">
              {[["目标机型", `${o.model} · ${o.nozzle} mm`], ["预计", `${o.time} · ${o.g} g`], ["提交时间", o.at], [o.printer ? "打印机" : "状态", o.printer ?? STATUS[o.st].t]].map(([k, v]) => (
                <div key={k}>
                  <span className="block text-on-variant">{k}</span>
                  <b className="font-medium">{v}</b>
                </div>
              ))}
            </div>
            <Timeline o={o} />
          </Sheet>

          <Sheet open={sheet?.type === "qr"} onClose={close} title="取件码" footer={<Button variant="text" onClick={close}>关闭</Button>}>
            <div className="text-center text-note text-on-variant">{o.file} · #{o.id}</div>
            <div className="self-center rounded-2xl bg-white p-3">{o.code && <FakeQR code={o.code} />}</div>
            <div className="text-center font-num text-[28px] leading-9 font-semibold tracking-[3px]">{o.code}</div>
            <div className="text-center text-note text-on-variant">{o.slot} · 到现场出示给工作人员扫码</div>
          </Sheet>

          <Sheet
            open={sheet?.type === "cancel"}
            onClose={close}
            title={`取消订单 #${o.id}`}
            sub="取消后不能恢复；如果还要打，需要重新提交。"
            footer={
              <>
                <Button variant="text" onClick={close}>返回</Button>
                <Button variant="danger" disabled={!reason} onClick={confirmCancel}>确认取消</Button>
              </>
            }
          >
            <Field label="取消原因" required>
              {(id, cls) => <Select id={id} className={cls} options={CANCEL_WHY} placeholder="请选择" value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </Sheet>

          <Sheet
            open={sheet?.type === "retry"}
            onClose={close}
            title={`重打 #${o.id}`}
            sub={`将按已用耗材折算，派生一张新订单（第 ${o.n} 盘 · ${o.model}），进入「待审核」。原订单保持失败状态并结单。`}
            footer={
              <>
                <Button variant="text" onClick={close}>返回</Button>
                <Button onClick={confirmRetry}>生成新订单</Button>
              </>
            }
          />
        </>
      )}
    </Page>
  );
}
