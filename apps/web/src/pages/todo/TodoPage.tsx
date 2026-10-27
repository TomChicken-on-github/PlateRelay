import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { FilterTabs, StatusChip } from "../../components/Chip";
import { Field, Select } from "../../components/Field";
import { ModelThumb, ShotThumb } from "../../components/ModelThumb";
import { Empty, OrderActions, OrderBody, OrderCard, OrderGrid, OrderHead, PlateMeta, StatusBlock } from "../../components/OrderBits";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { LIVE, type Res } from "../../lib/api";
import { t } from "../../lib/motion";
import { ordersApi, useTasks } from "../../lib/ordersApi";
import { CELLS, ROWS, STOP_WHY, type Task, ZONES } from "../../mock/todo";

type TabKey = "all" | Task["kind"];
const KIND = { stock: { t: "铲件入库", tone: "ok" }, err: { t: "报错处理", tone: "err" }, clear: { t: "清理热床", tone: "neutral" }, skip: { t: "跳单提醒", tone: "warn" } } as const;

const SLOT_SELECT = "w-full box-border rounded-lg border-0 bg-transparent py-3 pr-1 pl-3 text-[16px] leading-6 text-on-surface outline-0 shadow-[inset_0_0_0_1px_var(--md-outline)] focus:shadow-[inset_0_0_0_2px_var(--md-primary)] disabled:opacity-50";

function StockSheet({ task, open, onClose, onDone }: { task: Task; open: boolean; onClose: () => void; onDone: (slot: string, photo: File | null) => void }) {
  const [zone, setZone] = useState("");
  const [row, setRow] = useState("");
  const [cell, setCell] = useState("");
  const [photo, setPhoto] = useState(false);
  /* real builds take a photo from the camera or the gallery; the prototype only pretends */
  const [file, setFile] = useState<{ f: File; url: string } | null>(null);
  const fin = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (file) URL.revokeObjectURL(file.url);
  }, [file]);
  const [clean, setClean] = useState(false);
  const ready = zone && row && cell && photo && clean;
  const sel = (label: string, opts: string[], v: string, set: (v: string) => void, disabled?: boolean) => (
    <select aria-label={label} className={SLOT_SELECT} value={v} disabled={disabled} onChange={(e) => set(e.target.value)}>
      <option value="">–</option>
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`铲件入库 #${task.order}`}
      sub={`铲件、放进暂存篮、拍照、确认热床已清理，一次提交，${task.printer} 会同时释放。`}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button disabled={!ready} onClick={() => onDone(`${zone}-${row}-${cell}`, file?.f ?? null)}>确认入库</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="text-note font-medium tracking-[0.1px] text-on-variant">
          暂存格位<em className="not-italic text-error"> *</em>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {sel("区域", ZONES, zone, (v) => (setZone(v), setRow(""), setCell("")))}
          {sel("层", ROWS, row, (v) => (setRow(v), setCell("")), !zone)}
          {sel("格", CELLS, cell, setCell, !row)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-note font-medium tracking-[0.1px] text-on-variant">
          入库照片<em className="not-italic text-error"> *</em>
        </div>
        <div className="flex items-center gap-3">
          {photo && (
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, transition: t("medium2", "emphasizedDecelerate") }} className="size-16 flex-none overflow-hidden rounded-[10px]">
              {file ? <img src={file.url} alt="入库照片" className="block size-full object-cover" /> : <ShotThumb c={task.fil[0]?.[0] ?? "#8a8590"} />}
            </motion.span>
          )}
          <Button variant="outlined" icon="photo_camera" onClick={() => (LIVE ? fin.current?.click() : setPhoto(true))}>{photo ? "重拍" : "拍照 / 选择照片"}</Button>
          <input
            ref={fin}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setFile({ f, url: URL.createObjectURL(f) });
              setPhoto(true);
            }}
          />
        </div>
      </div>
      <Checkbox checked={clean} onChange={setClean}>
        热床已清理，确认放行 {task.printer}
        <em className="not-italic text-error"> *</em>
      </Checkbox>
    </Sheet>
  );
}

function StopSheet({ task, open, onClose, onDone }: { task: Task; open: boolean; onClose: () => void; onDone: (why: string) => void }) {
  const [why, setWhy] = useState("");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`停止打印 #${task.order}`}
      sub="停止后订单记为打印失败，选手会收到通知，Builder 之后可以归因和重打。"
      footer={
        <>
          <Button variant="text" onClick={onClose}>返回</Button>
          <Button variant="danger" disabled={!why} onClick={() => onDone(why)}>确认停止</Button>
        </>
      }
    >
      <Field label="失败原因" required>
        {(id, cls) => <Select id={id} className={cls} options={STOP_WHY} placeholder="请选择" value={why} onChange={(e) => setWhy(e.target.value)} />}
      </Field>
    </Sheet>
  );
}

export function TodoPage() {
  const { rows: list0, loading, error } = useTasks();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("all");
  const [sheet, setSheet] = useState<{ type: "stock" | "stop"; id: string } | null>(null);
  const [last, setLast] = useState<{ type: "stock" | "stop"; id: string }>({ type: "stock", id: "" });
  const [key, setKey] = useState(0);

  const open = (s: { type: "stock" | "stop"; id: string }) => {
    setSheet(s);
    setLast(s);
    setKey((k) => k + 1);
  };
  const close = () => setSheet(null);
  const [busy, setBusy] = useState(false);
  /* runs the action; the list comes back from the server (or the mock store) without the task */
  const done = async <T,>(r: Promise<Res<T>>, msg: string | ((data: T) => string)) => {
    setBusy(true);
    const x = await r;
    setBusy(false);
    if (!x.ok) return toast(x.error.message || "操作失败，请重试");
    setSheet(null);
    toast(typeof msg === "string" ? msg : msg(x.data));
  };
  const task = list0.find((x) => x.id === last.id);
  const cnt = (k: TabKey) => (k === "all" ? list0.length : list0.filter((x) => x.kind === k).length);
  const list = list0.filter((x) => tab === "all" || x.kind === tab);

  return (
    <Page>
      <PageHeader title="待办" />
      <FilterTabs<TabKey>
        label="待办筛选"
        value={tab}
        onChange={setTab}
        items={(
          [
            ["all", "全部"],
            ["stock", "铲件入库"],
            ["err", "报错处理"],
            ["skip", "跳单提醒"],
          ] as [TabKey, string][]
        ).map(([k, l]) => ({ key: k, label: l, count: cnt(k) }))}
      />
      {list.length ? (
        <OrderGrid>
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((x) => (
              <motion.div key={x.id} layout className="flex" exit={{ opacity: 0, scale: 0.96, transition: t("short4", "emphasizedAccelerate") }}>
                <OrderCard interactive={false} className="flex-1">
                  <OrderHead id={x.order} chip={<StatusChip tone={KIND[x.kind].tone}>{KIND[x.kind].t}</StatusChip>} right={x.printer} />
                  <OrderBody thumb={x.thumb ? <img src={x.thumb} alt={`#${x.order} 预览`} className="block size-full object-contain" /> : <ModelThumb c1={x.fil[0]?.[0] ?? "var(--md-outline)"} slot={false} />} name={x.file} meta={<PlateMeta parts={[`第 ${x.n} 盘 · ${x.model} · ${x.nozzle} mm`, `${x.time} · ${x.g} g`]} fil={x.fil} />} />
                  {x.kind === "stock" ? (
                    <StatusBlock icon="inventory_2" title="打印完成，等待铲件入库" right={`已等 ${x.since}`}>
                      {x.printer} 在入库前不会释放，下一单会等它。取件人：{x.owner}
                    </StatusBlock>
                  ) : x.kind === "skip" ? (
                    <StatusBlock icon="schedule" title="被跳过" right={`已等 ${x.since}`}>
                      {x.why}
                    </StatusBlock>
                  ) : x.kind === "clear" ? (
                    <StatusBlock icon="cleaning_services" title="等待清理热床" right={`已等 ${x.since}`}>
                      {x.printer} 上的任务已结束，没有成品要入库。清理热床后才会派下一单。
                    </StatusBlock>
                  ) : (
                    <StatusBlock tone="err" icon="warning" title={`${x.printer} · 需要处理`} right={`${x.since}前`}>
                      {x.err}
                    </StatusBlock>
                  )}
                  {x.kind !== "skip" && <OrderActions>
                    {x.kind === "stock" ? (
                      <Button icon="inventory_2" onClick={() => open({ type: "stock", id: x.id })}>铲件入库</Button>
                    ) : x.kind === "clear" ? (
                      <Button icon="check" disabled={busy} onClick={() => void done(ordersApi.clearBed(x), `${x.printer} 已清台，可以接下一单`)}>已清理热床</Button>
                    ) : (
                      <>
                        <Button variant="outlined" icon="stop" iconFill onClick={() => open({ type: "stop", id: x.id })}>停止打印</Button>
                        <Button icon="play_arrow" iconFill disabled={busy} onClick={() => void done(ordersApi.resume(x), `${x.printer} 已继续打印 #${x.order}`)}>已处理，继续</Button>
                      </>
                    )}
                  </OrderActions>}
                </OrderCard>
              </motion.div>
            ))}
          </AnimatePresence>
        </OrderGrid>
      ) : (
        error ? (
          <Empty icon="cloud_off">加载失败：{error}</Empty>
        ) : loading ? (
          <Empty icon="hourglass_top">正在加载…</Empty>
        ) : (
          <Empty ok icon="check_circle" title="没有待办了">新的打印完成或报错会出现在这里</Empty>
        )
      )}

      {task && (
        <>
          <StockSheet key={`s${key}`} task={task} open={sheet?.type === "stock"} onClose={close} onDone={(slot, photo) => void done(ordersApi.store(task, slot, photo), `#${task.order} 已入库到 ${slot}，${task.printer} 已释放`)} />
          <StopSheet
            key={`p${key}`}
            task={task}
            open={sheet?.type === "stop"}
            onClose={close}
            onDone={(why) =>
              void done(ordersApi.stop(task, why), (d) =>
                d.commandSent ? `#${task.order} 已停止，记为打印失败` : `#${task.order} 已记为打印失败；停止命令没发到 ${task.printer}，请在打印机屏幕上停止`,
              )
            }
          />
        </>
      )}
    </Page>
  );
}
