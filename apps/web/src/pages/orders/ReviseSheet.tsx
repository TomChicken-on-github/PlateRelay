import { type OrderPreview, type ParsedUpload, type QueueRules, revisionPlacesBack } from "@platerelay/shared";
import { useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { Sheet } from "../../components/Sheet";
import { LinearIndeterminate } from "../../components/WavyProgress";
import { useToast } from "../../components/Toast";
import { LIVE, api } from "../../lib/api";
import { fmtDur, ordersApi, shortModel } from "../../lib/ordersApi";
import { type MyOrder, myOrders } from "../../mock/myOrders";

type Version = { model: string; modelId: string; nozzle: string; dual: boolean; sec: number; g: number; fil: [string, string][]; block: string[] };
type Next = Pick<Version, "modelId" | "dual" | "sec" | "fil">;
type Parsed = { name: string; file: File; plates: (Version & { n: number })[] };

const secOf = (t: string) => {
  const m = t.match(/(\d+)h\s*(\d+)m/);
  return m ? (+m[1] * 60 + +m[2]) * 60 : 0;
};

async function parse(f: File): Promise<Parsed> {
  const body = new FormData();
  body.append("file", f);
  const r = await api<OrderPreview | ParsedUpload>(LIVE ? "/api/orders/preview" : "/api/gcode3mf/parse", { method: "POST", body });
  if (!r.ok) throw new Error(r.error.code === "network" ? "连不上解析服务，请稍后再试。" : r.error.message || "解析失败");
  return {
    name: f.name,
    file: f,
    plates: r.data.plates.map((p) => ({
      n: p.index,
      model: shortModel(r.data.printerModel, p.printerModelId),
      modelId: p.printerModelId,
      nozzle: [...new Set(p.nozzles.map((z) => z.diameter))].join(" / "),
      dual: p.nozzles.length > 1,
      sec: Math.round(p.printSeconds),
      g: Math.round(p.weightGrams),
      fil: p.filaments.map((x) => [x.color, x.type]),
      block: "check" in p ? p.check.block : [],
    })),
  };
}

const current = (o: MyOrder): Version => ({ model: o.model, modelId: o.modelId ?? o.model, nozzle: o.nozzle, dual: o.dual ?? o.fil.length > 1, sec: secOf(o.time), g: o.g, fil: o.fil, block: [] });

/** What a new version does to the order, as the server's policy will decide it: places back, review, counts. */
export function placement(o: MyOrder, rules: QueueRules | null, next: Next | undefined, restore = false) {
  const cur = current(o);
  const isSwitch = !!next && next.modelId !== cur.modelId;
  const delta = next ? next.sec - (o.baseSec ?? cur.sec) : 0;
  const r = rules?.revisions;
  let back: number | "tail" = r ? revisionPlacesBack(r, delta) : 0;
  /* dispatched but not started: the print is recalled and the order moves back extra places */
  if (r && o.st === "printing" && back !== "tail") back += r.dispatchedExtraPlaces;
  if (isSwitch && rules) back = rules.modelSwitch.position === "tail" ? "tail" : back === "tail" ? back : back + rules.modelSwitch.extraPlaces;
  const same = !!next && next.fil.length === cur.fil.length && next.fil.every(([c, t], i) => c.toLowerCase() === cur.fil[i][0].toLowerCase() && t === cur.fil[i][1]);
  const auto = restore || (o.st === "queued" && !!r?.autoApproveMinor && !isSwitch && same && delta <= r.thresholdMinutes * 60);
  const counts = !isSwitch || (next && cur.dual && !next.dual ? !!rules?.modelSwitch.dualToSingleCounts : !!rules?.modelSwitch.countsAsRevision);
  const nth = (o.revs ?? 0) + (counts ? 1 : 0);
  return { isSwitch, delta, back, same, auto, counts, nth };
}

export const Fil = ({ fil }: { fil: [string, string][] }) => (
  <>
    {fil.map(([c, t], i) => (
      <span key={i} className="mr-1.5 inline-flex items-center gap-1">
        <i className="inline-block size-2.5 rounded-full shadow-[0_0_0_1px_var(--md-outline-variant)]" style={{ background: c }} />
        {t}
      </span>
    ))}
  </>
);

/** 修改文件: pick a new .gcode.3mf for this plate, compare it with the current version, then send it. */
export function ReviseSheet({ o, rules, open, onClose }: { o: MyOrder; rules: QueueRules | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const fin = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"parse" | "send" | null>(null);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [n, setN] = useState(0);

  const pick = async (f: File) => {
    setError("");
    if (!/\.gcode\.3mf$/i.test(f.name)) return setError("只能提交 .gcode.3mf 文件");
    setBusy("parse");
    try {
      const p = await parse(f);
      setParsed(p);
      setN(p.plates.some((x) => x.n === o.n) ? o.n : p.plates[0]?.n ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const next = parsed?.plates.find((x) => x.n === n);
  const cur = current(o);
  const { isSwitch, delta, back, same, auto, counts, nth } = placement(o, rules, next);

  const send = async () => {
    if (!parsed || !next) return;
    setBusy("send");
    if (!LIVE) {
      myOrders.set((s) => s.map((x) => (x.id === o.id ? { ...x, file: parsed.name, model: next.model, modelId: next.modelId, nozzle: next.nozzle, time: fmtDur(next.sec), g: next.g, fil: next.fil, revs: nth, st: auto ? x.st : x.pos ? "revising" : "pending" } : x)));
      setBusy(null);
      return onClose();
    }
    const res = await ordersApi.revise(o.id, parsed.file, parsed.plates.length > 1 ? next.n : undefined);
    setBusy(null);
    if (!res.ok) return toast(res.error.message || "修改失败，请重试");
    onClose();
  };

  const row = (k: string, v: React.ReactNode) => (
    <div key={k}>
      <span className="block text-on-variant">{k}</span>
      <b className="font-medium">{v}</b>
    </div>
  );
  const cmp = (k: string, a: React.ReactNode, b: React.ReactNode, eq: boolean) =>
    row(k, eq ? b : <><s className="font-normal text-on-variant">{a}</s> → {b}</>);
  const mins = Math.round(delta / 60);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`修改文件 #${o.id}`}
      sub={parsed ? parsed.name : `${o.file} · 第 ${o.n} 盘`}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          {parsed && <Button disabled={!next || !!next.block.length || !!busy} onClick={() => void send()}>提交修改</Button>}
        </>
      }
    >
      {!parsed ? (
        <>
          <button
            type="button"
            onClick={() => fin.current?.click()}
            disabled={!!busy}
            className="flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-outline-variant bg-transparent p-4 text-on-surface hover:border-primary hover:bg-primary/8"
          >
            <Icon name="upload_file" size={32} className="text-primary" />
            <b className="text-label-l font-medium">选择新的 .gcode.3mf</b>
          </button>
          {busy === "parse" && <LinearIndeterminate />}
          {error && <div role="alert" className="text-body-m text-error">{error}</div>}
          <input ref={fin} type="file" accept=".3mf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
        </>
      ) : (
        <>
          {parsed.plates.length > 1 && (
            <Field label="打印板">
              {(id, cls) => (
                <select id={id} className={cls} value={n} onChange={(e) => setN(+e.target.value)}>
                  {parsed.plates.map((p) => <option key={p.n} value={p.n}>第 {p.n} 盘</option>)}
                </select>
              )}
            </Field>
          )}
          {next && (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-note">
                {cmp("机型", `${cur.model} · ${cur.nozzle} mm`, `${next.model} · ${next.nozzle} mm`, cur.model === next.model && cur.nozzle === next.nozzle)}
                {cmp("预计时长", fmtDur(cur.sec), fmtDur(next.sec), Math.round(cur.sec / 60) === Math.round(next.sec / 60))}
                {cmp("耗材重量", `${cur.g} g`, `${next.g} g`, cur.g === next.g)}
                {cmp("耗材", <Fil fil={cur.fil} />, <Fil fil={next.fil} />, same)}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-solid border-outline-variant pt-3 text-note">
                {row("时长变化", `${mins > 0 ? "+" : ""}${mins} 分钟`)}
                {row("排队位置", o.pos ? (back === "tail" ? "通过后排到队尾" : back ? `通过后后移 ${back} 位` : `保持第 ${o.pos} 位`) : "—")}
                {row("审核", auto ? "自动通过" : "重新审核")}
                {counts && row("修改次数", o.revMax ? `第 ${nth} 次，最多 ${o.revMax} 次` : `第 ${nth} 次`)}
                {isSwitch && row("换机型", `是（只能换 ${o.maxSwitches ?? rules?.modelSwitch.max ?? 1} 次）`)}
              </div>
              {!!next.block.length && <div role="alert" className="text-body-m text-error">{next.block.join("；")}</div>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
