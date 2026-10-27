import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Button, IconButton } from "../../components/Button";
import { FilterTabs, StatusChip } from "../../components/Chip";
import { Field, Select, TextArea } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { FilamentDots, ModelPreview } from "../../components/ModelThumb";
import { Empty, OrderActions, OrderBody, OrderCard, OrderGrid, OrderHead, PlateMeta, StatusBlock, Thumb } from "../../components/OrderBits";
import { VersionList, useVersionDownload } from "../../components/VersionList";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { SkipPartsSheet } from "../../components/SkipPartsSheet";
import { useToast } from "../../components/Toast";
import { LIVE } from "../../lib/api";
import { cx } from "../../lib/cx";
import { t } from "../../lib/motion";
import { live, ordersApi, toAdminDetail, useManageOrders, useReviewOrders } from "../../lib/ordersApi";
import { ADMIN_STATUS, ATTRIBUTION, type AdminOrder, CANCEL_WHY, adminOrders, answers, auditFor } from "../../mock/adminOrders";
import type { Version } from "../../mock/myOrders";

type Mode = "review" | "manage";
type SheetType = "reject" | "cancel" | "attr" | "skip";
type TabKey = "all" | "pending" | "queued" | "printing" | "pick" | "bad" | "end";
const TABS: [TabKey, string][] = [["all", "全部"], ["pending", "待审核"], ["queued", "排队中"], ["printing", "打印中"], ["pick", "入库取件"], ["bad", "异常"], ["end", "已结束"]];
const GROUP: Record<AdminOrder["st"], TabKey> = { pending: "pending", revising: "pending", queued: "queued", printing: "printing", awaiting: "pick", ready: "pick", paused: "bad", failed: "bad", rejected: "end", done: "end", cancelled: "end" };

const ATTR_IDS = ["machine", "model"] as const;

/** Large preview: the stored plate image, or the placeholder drawing. */
function Preview({ o }: { o: AdminOrder }) {
  return o.thumb ? <img src={o.thumb} alt={`#${o.id} 预览`} className="block size-full object-contain" /> : <ModelPreview c1={o.fil[0]?.[0] ?? "var(--md-outline)"} />;
}

/** One order with its answers and timeline: the server's detail, or the mock row. */
function useDetail(id: number | null, version: number): AdminOrder | null | undefined {
  const mock = adminOrders.use();
  const [d, setD] = useState<{ id: number; o: AdminOrder | null } | undefined>();
  useEffect(() => {
    if (!LIVE || id === null) return;
    let on = true;
    void ordersApi.detail(id).then((r) => on && setD({ id, o: r.ok ? toAdminDetail(r.data) : null }));
    return () => {
      on = false;
    };
  }, [id, version]);
  if (id === null) return undefined;
  /* undefined while loading, null when the server has no such order for this account */
  return LIVE ? (d?.id === id ? d.o : undefined) : mock.find((o) => o.id === id);
}

/** 版本记录: the server's list, or for mock rows a revision and the version before it. */
function versionsOf(o: AdminOrder): Version[] {
  if (o.vers) return o.vers;
  if (!o.rev) return [];
  const sec = (t: string) => (+(t.match(/(\d+)h/)?.[1] ?? 0) * 60 + +(t.match(/(\d+)m/)?.[1] ?? 0)) * 60;
  return [
    { n: o.rev.n, file: o.rev.file, model: o.rev.model, nozzle: o.nozzle, time: o.rev.time, sec: sec(o.rev.time), g: o.rev.g, fil: o.rev.fil, at: o.at, st: "已通过" },
    { n: o.rev.n + 1, file: o.file, model: o.model, nozzle: o.nozzle, time: o.time, sec: sec(o.time), g: o.g, fil: o.fil, at: o.at, st: "审核中" },
  ];
}

/* ---------- sheets ---------- */

function RejectSheet({ order, open, onClose, onDone }: { order?: AdminOrder; open: boolean; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const toast = useToast();
  return (
    <Sheet
      open={open && !!order}
      onClose={onClose}
      title={`驳回 #${order?.id}`}
      sub="驳回原因会发给选手，让对方改完重新提交。"
      footer={
        <>
          <Button variant="text" onClick={onClose}>返回</Button>
          <Button
            variant="danger"
            disabled={!why.trim()}
            onClick={async () => {
              if (!order) return;
              const r = await ordersApi.reject(order.id, why.trim());
              if (!r.ok) return toast(r.error.message || "驳回失败，请重试");
              toast(`#${order.id} 已驳回，已通知选手`);
              onDone();
            }}
          >
            确认驳回
          </Button>
        </>
      }
    >
      <Field label="驳回原因" required>
        {(id, cls) => <TextArea id={id} className={cls} rows={3} placeholder="例如：壁厚过薄，请加厚到 1.2 mm 以上" value={why} onChange={(e) => setWhy(e.target.value)} />}
      </Field>
    </Sheet>
  );
}

function PickSheet({ title, sub, label, options, confirm, danger, open, onClose, onDone }: { title: string; sub: ReactNode; label: string; options: string[]; confirm: string; danger?: boolean; open: boolean; onClose: () => void; onDone: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      footer={
        <>
          <Button variant="text" onClick={onClose}>返回</Button>
          <Button variant={danger ? "danger" : "filled"} disabled={!v} onClick={() => onDone(v)}>{confirm}</Button>
        </>
      }
    >
      <Field label={label} required>
        {(id, cls) => <Select id={id} className={cls} options={options} placeholder="请选择" value={v} onChange={(e) => setV(e.target.value)} />}
      </Field>
    </Sheet>
  );
}

/* ---------- review queue ---------- */

async function approve(o: AdminOrder, toast: (m: string) => void) {
  const r = await ordersApi.approve(o.id);
  toast(r.ok ? `#${o.id} 已通过，进入排队` : r.error.message || "通过失败，请重试");
  return r.ok;
}

function ReviewQueue({ onReject }: { onReject: (id: number) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { rows: list, loading, error } = useReviewOrders();
  return (
    <>
      <PageHeader title="审核队列" />
      <div className="text-note text-on-variant">共享审核池：有审核权限的人都能审，修改版排在最前，其余按提交先后。{list.length} 单待审核。</div>
      {list.length ? (
        <OrderGrid>
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((o) => {
              const a = answers(o);
              const [first, second] = [a[0]?.[1] ?? "未填写申请信息", a[1]?.[1]];
              return (
                <motion.div key={o.id} layout className="flex" exit={{ opacity: 0, scale: 0.96, transition: t("short4", "emphasizedAccelerate") }}>
                  <OrderCard className="flex-1" tabIndex={0} role="button" aria-label={`订单 ${o.id}`} onClick={() => navigate(`/review/${o.id}`)} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && navigate(`/review/${o.id}`)}>
                    <OrderHead
                      id={o.id}
                      chip={
                        <>
                          <StatusChip tone={o.rev ? "warn" : "neutral"}>{o.rev ? `修改版 · 第 ${o.rev.n} 次` : "待审核"}</StatusChip>
                          {o.missing && <StatusChip tone="err">缺色</StatusChip>}
                        </>
                      }
                      right={o.at}
                    />
                    <OrderBody thumb={<Preview o={o} />} name={o.file} meta={<PlateMeta parts={[`${o.model} · ${o.nozzle} mm`, `${o.time} · ${o.g} g`]} fil={o.fil} />} />
                    {o.rev && (
                      <StatusBlock icon="replay" title="上一版" right={o.rev.pos ? `保留第 ${o.rev.pos} 位${o.rev.back === "tail" ? " · 通过后排到队尾" : o.rev.back ? ` · 通过后后移 ${o.rev.back} 位` : ""}` : undefined}>
                        <s>{o.rev.time} · {o.rev.g} g</s> → {o.time} · {o.g} g
                        {o.rev.model !== o.model && <> · <s>{o.rev.model}</s> → {o.model}</>}
                      </StatusBlock>
                    )}
                    <StatusBlock title={first} right={second}>申请人：{o.owner}</StatusBlock>
                    <OrderActions>
                      <Button variant="outlined" icon="cancel" onClick={(e) => (e.stopPropagation(), onReject(o.id))}>驳回</Button>
                      <Button
                        icon="check"
                        onClick={(e) => {
                          e.stopPropagation();
                          void approve(o, toast);
                        }}
                      >
                        通过
                      </Button>
                    </OrderActions>
                  </OrderCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </OrderGrid>
      ) : (
        error ? <Empty icon="cloud_off">加载失败：{error}</Empty> : loading ? <Empty icon="hourglass_top">正在加载…</Empty> : <Empty ok icon="check_circle" title="没有待审核的订单了" />
      )}
    </>
  );
}

/* ---------- order management table ---------- */

const COLS = "grid-cols-[40px_104px_minmax(0,1.5fr)_minmax(0,1fr)_96px_110px_110px] max-md:grid-cols-[minmax(0,1fr)_auto]";

function RowCells({ o, pos, handle }: { o: AdminOrder; pos?: number; handle?: ReactNode }) {
  const [label, tone] = ADMIN_STATUS[o.st];
  return (
    <>
      <span className="max-md:hidden">{handle}</span>
      <b className="font-num text-label-l font-semibold whitespace-nowrap max-md:col-start-1 max-md:row-start-1">
        #{o.id}
        {pos != null && <small className="ml-1 text-body-s font-normal text-on-variant">第 {pos} 位</small>}
      </b>
      <div className="min-w-0 max-md:col-span-full">
        <div className="truncate text-label-l font-medium">{o.file}</div>
        <div className="text-body-s text-on-variant">
          {o.model} · {o.nozzle} mm · {o.time} · {o.g} g
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 max-md:col-start-1">
        <Avatar name={o.owner} size={28} />
        <span className="truncate text-note">{o.owner}</span>
      </div>
      <span className="text-body-s text-on-variant max-md:hidden">{o.printer || "—"}</span>
      <span className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end">
        <StatusChip tone={tone}>{label}</StatusChip>
      </span>
      <span className="font-num text-body-s text-on-variant max-md:col-start-2 max-md:justify-self-end">{o.at}</span>
    </>
  );
}

const ROW = cx("relative grid min-h-[60px] cursor-pointer items-center gap-3 border-t border-solid border-outline-variant py-0 pr-4 pl-2 hover:bg-[color-mix(in_srgb,var(--md-on-surface)_4%,var(--md-sc))] max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-3", COLS);

function QueueRow({ o, pos, onOpen, onDrop }: { o: AdminOrder; pos: number; onOpen: () => void; onDrop: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={o}
      as="div"
      dragListener={false}
      dragControls={controls}
      role="button"
      tabIndex={0}
      aria-label={`订单 ${o.id}，排队第 ${pos} 位`}
      onClick={onOpen}
      className={cx(ROW, "bg-sc")}
      whileDrag={{ scale: 1.01, boxShadow: "0 6px 16px rgb(0 0 0 / .25)", zIndex: 2 }}
      onDragEnd={onDrop}
    >
      <RowCells
        o={o}
        pos={pos}
        handle={
          <span
            aria-hidden="true"
            className="grid size-10 cursor-grab touch-none place-items-center text-on-variant active:cursor-grabbing"
            onPointerDown={(e) => {
              e.stopPropagation();
              controls.start(e);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="drag_indicator" size={20} />
          </span>
        }
      />
    </Reorder.Item>
  );
}

function ManageList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { rows: all, loading, error } = useManageOrders();
  const [tab, setTab] = useState<TabKey>("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = all.filter((o) => (tab === "all" || GROUP[o.st] === tab) && (!query || `#${o.id} ${o.file} ${o.owner} ${o.printer ?? ""}`.toLowerCase().includes(query)));
  /* the server sends newest first; the queue tab shows queue order */
  if (tab === "queued" && list.every((o) => o.pos != null)) list.sort((a, b) => a.pos! - b.pos!);
  const canMove = tab === "queued" && !query;
  const open = (id: number) => navigate(`/manage/orders/${id}`);

  /* Dragging reorders the queued orders among themselves; other orders keep their slots. */
  const reorder = (next: AdminOrder[]) => {
    const put = (s: AdminOrder[]) => {
      let i = 0;
      return s.map((o) => (o.st === "queued" ? next[i++] : o));
    };
    if (LIVE) live.manage.patch((s) => put(s).map((o) => (o.st === "queued" ? { ...o, pos: next.indexOf(o) + 1 } : o)));
    else adminOrders.set(put);
  };
  /* After a drag the moved row has its new place locally; send it once the row is let go. */
  const commit = async (o: AdminOrder, from: number | undefined) => {
    const now = live.manage.get()?.find((x) => x.id === o.id)?.pos;
    if (!LIVE || now == null || now === from) return;
    const r = await ordersApi.reorder(o.id, now);
    toast(r.ok ? `#${o.id} 已调整到第 ${now} 位` : r.error.message || "调整失败，已恢复原顺序");
    if (!r.ok) void live.manage.refresh();
  };

  return (
    <>
      <PageHeader title="订单管理" />
      <label className="relative w-full max-w-[420px] max-sm:max-w-none">
        <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-on-variant" />
        <input
          type="search"
          placeholder="搜索订单号、文件、申请人、打印机"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="box-border h-12 w-full rounded-[28px] border-0 bg-sc-high pr-4 pl-11 text-[16px] leading-6 text-on-surface outline-0 focus:outline-2 focus:outline-primary"
        />
      </label>
      <FilterTabs label="状态筛选" value={tab} onChange={setTab} items={TABS.map(([k, l]) => ({ key: k, label: l, count: k === "all" ? all.length : all.filter((o) => GROUP[o.st] === k).length }))} />
      {tab === "queued" && <div className="text-note text-on-variant">排队中的订单可以拖动左侧手柄调整顺序；调整只记入审计日志，选手看不到。</div>}
      <div className="overflow-hidden rounded-xl bg-sc">
        {list.length ? (
          <>
            <div className={cx("grid min-h-11 items-center gap-3 bg-sc-high py-0 pr-4 pl-2 text-body-s font-medium tracking-[0.5px] text-on-variant max-md:hidden", COLS)}>
              <span />
              <span>订单</span>
              <span>文件 · 喷嘴 · 耗时 · 用量</span>
              <span>申请人</span>
              <span>打印机</span>
              <span>状态</span>
              <span>提交时间</span>
            </div>
            {canMove ? (
              <Reorder.Group axis="y" values={list} onReorder={reorder} as="div">
                {list.map((o, i) => (
                  <QueueRow key={o.id} o={o} pos={i + 1} onOpen={() => open(o.id)} onDrop={() => void commit(o, o.pos)} />
                ))}
              </Reorder.Group>
            ) : (
              list.map((o) => (
                <div key={o.id} role="button" tabIndex={0} aria-label={`订单 ${o.id}，${ADMIN_STATUS[o.st][0]}`} className={ROW} onClick={() => open(o.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(o.id))}>
                  <RowCells o={o} />
                </div>
              ))
            )}
          </>
        ) : (
          <div className="px-4 py-14 text-center text-on-variant">{error ? `加载失败：${error}` : loading ? "正在加载…" : "没有符合条件的订单"}</div>
        )}
      </div>
    </>
  );
}

/* ---------- order detail ---------- */

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4">
      <h2 className="m-0 text-[16px] leading-6 font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx("min-w-0 rounded-xl bg-sc-high px-3.5 py-3", wide && "col-span-full")}>
      <span className="block text-body-s text-on-variant">{label}</span>
      {children}
    </div>
  );
}
const Big = ({ v, unit }: { v: ReactNode; unit?: string }) => (
  <b className="mt-0.5 block font-num text-[20px] leading-7 font-medium max-sm:text-[18px]">
    {v}
    {unit && <small className="ml-[3px] font-sans text-note font-normal text-on-variant">{unit}</small>}
  </b>
);
const Small = ({ children }: { children: ReactNode }) => <b className="mt-1.5 block text-label-l font-medium">{children}</b>;

function Detail({ mode, o, onReject, onCancel, onAttr, onSkip }: { mode: Mode; o: AdminOrder; onReject: () => void; onCancel: () => void; onAttr: () => void; onSkip: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [label, tone] = ADMIN_STATUS[o.st];
  const live = !["done", "cancelled", "rejected", "failed"].includes(o.st);
  const back = () => navigate(mode === "review" ? "/review" : "/manage/orders");
  const vers = versionsOf(o);
  const [ver, setVer] = useState<number | undefined>();
  /* the version under review (or the current one) until another is picked */
  const shown = vers.length > 1 ? (vers.find((v) => v.n === ver) ?? vers[vers.length - 1]) : undefined;
  const downloadVersion = useVersionDownload(o.id);
  const acts = (
    <>
      {mode === "review" && (o.st === "pending" || o.st === "revising") && (
        <>
          <Button variant="outlined" icon="cancel" onClick={onReject}>驳回</Button>
          <Button
            icon="check"
            onClick={() => {
              void approve(o, toast).then((ok) => ok && back());
            }}
          >
            通过
          </Button>
        </>
      )}
      {mode === "manage" && o.parts?.allowed && <Button variant="tonal" icon="skip_next" onClick={onSkip}>跳过零件</Button>}
      {mode === "manage" && live && <Button variant="outlined" icon="cancel" onClick={onCancel}>取消订单</Button>}
      {o.st === "failed" && !o.attributed && <Button icon="info" onClick={onAttr}>失败归因</Button>}
    </>
  );
  return (
    <>
      <PageHeader
        lead={<IconButton icon="arrow_back" label={mode === "review" ? "返回审核队列" : "返回订单管理"} className="-ml-2" onClick={back} />}
        title={`订单 #${o.id}`}
        after={<StatusChip tone={tone}>{label}</StatusChip>}
        actions={<div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>button]:flex-1">{acts}</div>}
      />
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <Box title="模型预览">
            <div className="relative grid aspect-square place-items-center overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--md-outline-variant)] max-lg:mx-auto max-lg:w-full max-lg:max-w-[420px]" style={{ background: "radial-gradient(100% 80% at 50% 110%, var(--md-sc-high), var(--md-sc))" }}>
              <div className="size-[78%]">
                {shown ? <Thumb fil={shown.fil} url={shown.thumb} alt={`#${o.id} 第 ${shown.n} 版预览`} /> : <Preview o={o} />}
              </div>
              {!(shown ? shown.thumb : o.thumb) && <span className="absolute bottom-3 left-3 rounded-lg bg-sc-high px-2.5 py-0.5 text-body-s leading-5 font-medium text-on-variant">示意{shown ? ` · 第 ${shown.n} 版` : ""}</span>}
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-sc-high px-3.5 py-3 max-sm:flex-wrap">
              <Icon name="folder_zip" className="text-on-variant" />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-label-l font-medium">{shown?.file ?? o.file}</b>
                <small className="text-body-s text-on-variant">
                  {o.plate ? o.plate + " · " : ""}
                  {shown ? `${shown.time} · ${shown.g} g` : `${o.mb} MB`}
                </small>
              </div>
              <Button variant="outlined" icon="download" className="max-sm:w-full" onClick={async () => {
                  if (shown) return void downloadVersion(shown);
                  if (!LIVE) return toast(`原型：正式环境会下载原始文件 ${o.file}`);
                  const r = await ordersApi.fileUrl(o.id);
                  if (r.ok) window.location.assign(r.data.url);
                  else toast(r.error.message || "下载链接生成失败");
                }}>
                下载
              </Button>
            </div>
          </Box>
          {vers.length > 1 && (
            <Box title="版本记录">
              <VersionList orderId={o.id} vers={vers} selected={shown?.n} onSelect={setVer} showModel={false} />
            </Box>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Box title="打印参数">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="预计耗时"><Big v={o.time} /></Tile>
              <Tile label="耗材用量"><Big v={o.g} unit="g" /></Tile>
              <Tile label="喷嘴"><Big v={o.nozzle} unit="mm" /></Tile>
              <Tile label="目标机型"><Big v={o.model} /></Tile>
              <Tile label="耗材" wide><Small><FilamentDots fil={o.fil} /></Small></Tile>
              <Tile label="申请人">
                <Small>
                  <span className="flex items-center gap-2">
                    <Avatar name={o.owner} size={28} />
                    {o.owner}
                  </span>
                </Small>
              </Tile>
              <Tile label="打印机"><Small>{o.printer || "尚未派单"}</Small></Tile>
              {o.colour && <Tile label="颜色要求" wide={!o.missing}><Small>{o.colour}</Small></Tile>}
              {o.missing && <Tile label="本场缺少"><Small><FilamentDots fil={o.missing} /></Small></Tile>}
              <Tile label="提交时间" wide><Small>{o.at}</Small></Tile>
            </div>
          </Box>
          {o.rev && (
            <Box title="与上一版对比">
              <div className="grid grid-cols-2 gap-3">
                <Tile label="上一版文件" wide><Small>{o.rev.file}</Small></Tile>
                <Tile label="预计耗时"><Small><s className="font-normal text-on-variant">{o.rev.time}</s> → {o.time}</Small></Tile>
                <Tile label="耗材用量"><Small><s className="font-normal text-on-variant">{o.rev.g} g</s> → {o.g} g</Small></Tile>
                <Tile label="目标机型"><Small>{o.rev.model === o.model ? o.model : <><s className="font-normal text-on-variant">{o.rev.model}</s> → {o.model}</>}</Small></Tile>
                <Tile label="排队位置"><Small>{!o.rev.pos ? "—" : o.rev.back === "tail" ? `第 ${o.rev.pos} 位 → 队尾` : o.rev.back ? `第 ${o.rev.pos} 位 → 第 ${o.rev.pos + o.rev.back} 位` : `第 ${o.rev.pos} 位`}</Small></Tile>
                <Tile label="耗材" wide><Small><span className="inline-flex flex-wrap items-center gap-2"><FilamentDots fil={o.rev.fil} /> → <FilamentDots fil={o.fil} /></span></Small></Tile>
              </div>
            </Box>
          )}
          <Box title="申请表答案">
            <div className="grid grid-cols-2 gap-3">
              {!answers(o).length && <Tile label="申请表" wide><Small>{LIVE && !o.answers ? "正在加载…" : "没有填写项"}</Small></Tile>}
              {answers(o).map(([k, v]) => (
                <Tile key={k} label={k} wide>
                  <Small>{v}</Small>
                </Tile>
              ))}
            </div>
          </Box>
          <Box title="操作记录">
            <div className="text-note text-on-variant">仅管理员可见</div>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-note">
              {LIVE && !o.log && <li className="text-on-variant">正在加载…</li>}
              {auditFor(o).map(([a, b], i) => (
                <li key={i} className="flex items-start gap-3">
                  <time className="w-[104px] shrink-0 font-num text-body-s leading-5 text-on-variant">{a}</time>
                  <span className="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]">{b}</span>
                </li>
              ))}
            </ul>
          </Box>
        </div>
      </div>
    </>
  );
}

/* ---------- page ---------- */

export function OrderAdminPage({ mode }: { mode: Mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const order = useDetail(id ? +id : null, version);
  /* rows behind the sheets; the lists below keep their own subscription */
  const mock = adminOrders.use();
  const orders = LIVE ? ((mode === "review" ? live.review : live.manage).get() ?? []) : mock;
  const [sheet, setSheet] = useState<{ type: SheetType; id: number } | null>(null);
  const [last, setLast] = useState<{ type: SheetType; id: number }>({ type: "reject", id: 0 });
  const [key, setKey] = useState(0);
  const open = (type: SheetType, oid: number) => {
    setSheet({ type, id: oid });
    setLast({ type, id: oid });
    setKey((k) => k + 1);
  };
  const close = () => setSheet(null);
  const target = order && order.id === last.id ? order : orders.find((o) => o.id === last.id);
  /* the detail page re-reads its order after an action */
  const changed = () => setVersion((v) => v + 1);

  return (
    <Page>
      {id && order ? (
        <Detail mode={mode} o={order} onReject={() => open("reject", order.id)} onCancel={() => open("cancel", order.id)} onAttr={() => open("attr", order.id)} onSkip={() => open("skip", order.id)} />
      ) : id && LIVE ? (
        order === null ? <Empty icon="search_off">找不到订单 #{id}</Empty> : <Empty icon="hourglass_top">正在加载订单 #{id}…</Empty>
      ) : mode === "review" ? (
        <ReviewQueue onReject={(oid) => open("reject", oid)} />
      ) : (
        <ManageList />
      )}

      <RejectSheet
        key={`r${key}`}
        order={target}
        open={sheet?.type === "reject"}
        onClose={close}
        onDone={() => {
          close();
          if (id) navigate(mode === "review" ? "/review" : `/manage/orders/${id}`);
          changed();
        }}
      />
      {target && (
        <>
          <SkipPartsSheet
            orderId={target.id}
            sub={`${target.file} · ${target.printer ?? ""}`}
            open={sheet?.type === "skip"}
            onClose={() => {
              close();
              changed();
            }}
          />
          <PickSheet
            key={`c${key}`}
            open={sheet?.type === "cancel"}
            onClose={close}
            title={`取消订单 #${target.id}`}
            sub={`${target.st === "printing" ? `这单正在 ${target.printer} 打印：会先停止打印机，之后仍需要人工清板。` : "取消后不能恢复。"}会记入审计日志。`}
            label="取消原因"
            options={CANCEL_WHY}
            confirm="确认取消"
            danger
            onDone={async (v) => {
              const r = await ordersApi.cancelAny(target.id, v);
              if (!r.ok) return toast(r.error.message || "取消失败，请重试");
              toast(`#${target.id} 已取消`);
              close();
              changed();
            }}
          />
          <PickSheet
            key={`a${key}`}
            open={sheet?.type === "attr"}
            onClose={close}
            title={`失败归因 #${target.id}`}
            sub={`${target.note ?? ""}。归因决定后续怎么处理，选手会收到通知。`}
            label="归因"
            options={ATTRIBUTION}
            confirm="确认"
            onDone={async (v) => {
              const r = await ordersApi.attribute(target.id, ATTR_IDS[ATTRIBUTION.indexOf(v)]);
              if (!r.ok) return toast(r.error.message || "归因失败，请重试");
              toast(`#${target.id} 已归因：${v.split("（")[0]}${r.data.retry ? `，重打为 #${r.data.retry}` : ""}`);
              close();
              changed();
            }}
          />
        </>
      )}
    </Page>
  );
}
