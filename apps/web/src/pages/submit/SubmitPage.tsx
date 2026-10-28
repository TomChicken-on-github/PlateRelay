import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton } from "../../components/Button";
import { StatusChip } from "../../components/Chip";
import { Checkbox, RowCheckbox } from "../../components/Checkbox";
import { Field, Select, TextArea, TextInput } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { FilamentDots, ModelThumb } from "../../components/ModelThumb";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { BED_TYPES, BED_TYPE_LABEL, COLOUR_PREFS, COLOUR_PREF_LABEL, type ColourPref, DEFAULT_COLOUR_PREF, type FormView, type OrderPreview, type OrderView, type ParsedUpload, type PlateCheck, type ResourcesView } from "@platerelay/shared";
import { LinearIndeterminate } from "../../components/WavyProgress";
import { useToast } from "../../components/Toast";
import { LIVE, api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { t } from "../../lib/motion";
import { fmtDur, live, shortModel } from "../../lib/ordersApi";
import { useResources } from "../../lib/resourcesApi";
import { useRules } from "../../lib/rulesApi";
import { Segmented } from "../../components/Segmented";
import { ResourcesPanel } from "./ResourcesPanel";

const MOCK_QUEUE_AHEAD = 7, MAX_MB = 200;

type FieldDef = { id: string; label: string; type: "select" | "multi" | "text" | "number" | "textarea"; req: boolean; opts?: string[]; min?: number; ph?: string; wide?: boolean };
type Answer = string | string[];

/* Application form fields are configured by admins (系统设置 → 申请表单); the prototype uses these. */
const MOCK_FIELDS: FieldDef[] = [
  { id: "purpose", label: "用途", type: "select", req: true, opts: ["比赛零件", "调试测试", "备件替换", "其他"] },
  { id: "team", label: "队伍 / 编号", type: "text", req: true, ph: "例如 T-014" },
  { id: "reason", label: "打印理由", type: "textarea", req: true, min: 10, ph: "说明这个零件的用途和为什么需要打印（至少 10 个字）", wide: true },
  { id: "note", label: "备注", type: "textarea", req: false, ph: "选填：给审核人的补充说明", wide: true },
];

const fromServer = (v: FormView): FieldDef[] =>
  v.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type === "single" ? "select" : f.type,
    req: f.required,
    opts: f.options,
    wide: f.type === "textarea" || f.type === "multi",
  }));

/** The request form as configured on the server, or the prototype's fields. */
function useFields() {
  const [fields, setFields] = useState<FieldDef[] | null>(LIVE ? null : MOCK_FIELDS);
  useEffect(() => {
    if (LIVE) void api<FormView>("/api/form").then((r) => setFields(r.ok ? fromServer(r.data) : []));
  }, []);
  return fields;
}

type Plate = { n: number; model: string; modelId?: string; nozzle: string; time: string; g: number; fil: [string, string][]; st: "ok" | "warn" | "err"; note?: string; res?: "models" | "materials"; thumb?: string | null; check?: PlateCheck };

/* Canned result for the "使用示例文件" demo; real files go to the panel's parse endpoint. */
const SAMPLE = {
  name: "机械臂轴承座.gcode.3mf",
  mb: 38.4,
  plates: [
    { n: 1, model: "X2D", modelId: "N6", nozzle: "0.4", time: "2h 00m", g: 48, fil: [["#0088ff", "PLA"], ["#ffcc00", "PLA"]], st: "ok" },
    { n: 2, model: "X2D", modelId: "N6", nozzle: "0.4", time: "1h 12m", g: 31, fil: [["#6155f5", "PETG"]], st: "ok", check: { block: [], missingColours: ["#6155f5"] } },
    { n: 3, model: "H2D", modelId: "O1D", nozzle: "0.6", time: "3h 25m", g: 96, fil: [["#0088ff", "PLA"]], st: "err", note: "本场的 H2D 没有 0.6 mm 喷嘴。请改用 0.4 mm 重新切片后再提交这一盘。", res: "models" },
  ] as Plate[],
};

const mins = (s: string) => {
  const m = s.match(/(\d+)h\s*(\d+)m/);
  return m ? +m[1] * 60 + +m[2] : 0;
};
const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

function plateBase(r: ParsedUpload, p: ParsedUpload["plates"][number]): Plate {
  return {
    n: p.index,
    model: shortModel(r.printerModel, p.printerModelId),
    modelId: p.printerModelId,
    nozzle: [...new Set(p.nozzles.map((z) => z.diameter))].join(" / "),
    time: fmt(Math.round(p.printSeconds / 60)),
    g: Math.round(p.weightGrams),
    fil: p.filaments.map((f) => [f.color, f.type]),
    st: "ok",
    thumb: p.thumbnailUrl,
  };
}

/* Fleet availability comes from the server. Without a compatible printer the plate can still be
   submitted: it waits in the queue like the server's 等待兼容的打印机, so it is a warning, not a block. */
function previewPlates(r: OrderPreview): Plate[] {
  return r.plates.map((p) => {
    const plate = { ...plateBase(r, p), check: p.check };
    if (p.check.block.length) return { ...plate, st: "err", note: p.check.block.join("；"), res: "models" };
    if (p.outside) return { ...plate, st: "warn", note: "有物体超出打印区域，请在切片软件里检查后重新导出" };
    if (p.availability.state !== "ok") return { ...plate, st: "warn", note: p.availability.message, res: "models" };
    return plate;
  });
}

/* Prototype: the mock 可用资源 table stands in for the server's check (model only). */
function toPlates(r: ParsedUpload, res: ResourcesView | null): Plate[] {
  return r.plates.map((p) => {
    const plate = plateBase(r, p);
    if (res && !res.models.some((m) => m.model === plate.model && !m.hidden)) return { ...plate, st: "err", note: `本场没有开放 ${plate.model}`, res: "models" };
    if (p.outside) return { ...plate, st: "warn", note: "有物体超出打印区域，请在切片软件里检查后重新导出" };
    return plate;
  });
}

/** What the plate looks like under the chosen 颜色要求: missing colours matter only for 一致. */
function withColour(p: Plate, pref: ColourPref, mode: ResourcesView["colourMissing"]): Plate {
  const missing = p.check?.missingColours ?? [];
  if (p.st === "err" || !missing.length) return p;
  const types = [...new Set(p.fil.filter(([c]) => missing.includes(c.slice(0, 7).toLowerCase())).map(([, t]) => t))].join(" / ");
  const what = `本场没有这个颜色的 ${types}`;
  if (pref === "exact") return mode === "block" ? { ...p, st: "err", note: `${what}。颜色要求是「一致」，不能提交这一盘。`, res: "materials" } : { ...p, st: "warn", note: `${what}。颜色要求是「一致」，要等审核确认补料，可能多等一会。`, res: "materials" };
  if (pref === "similar") return p.note ? p : { ...p, note: `${what}，会用最接近的颜色打印。`, res: "materials" };
  return p;
}

const COLOUR_HINT: Record<ColourPref, string> = {
  exact: "只用和切片一样的颜色。本场没有这个颜色时，要等审核确认补料",
  similar: "本场没有这个颜色时，用同色系里最接近的",
  any: "任意颜色都可以，派单最快",
};

/* Prototype builds still parse real files on the server, only availability is mocked. */
async function parseOnServer<T>(url: string, f: File): Promise<T> {
  const body = new FormData();
  body.append("file", f);
  const r = await api<T>(url, { method: "POST", body });
  if (!r.ok) throw new Error(r.error.code === "network" ? "连不上解析服务，请稍后再试。" : r.error.message || "解析失败");
  return r.data;
}

/* 提交须知: shown as step 4; the submitter must agree before submitting. */
const NOTICE_CHECKS = [
  "悬空部分是否开启了支撑，支撑类型和接触面是否合适",
  "模型与热床的接触面积是否过小，必要时开启 Brim 或调整摆放方向",
  "切片的机型、喷嘴口径、热床板类型是否与要使用的打印机一致",
  "耗材类型、颜色及左右喷嘴分配是否正确",
  "只用到一个喷嘴的模型是否切给了单喷头机型，不要无端占用双喷头打印机",
  "模型是否有破面、壁厚过薄、尺寸或比例错误",
  "预计用时和耗材用量是否合理",
];
const NOTICE_RULES: [icon: string, title: string, text: string][] = [
  ["person", "模型或切片问题由提交者自行承担", "因模型缺陷或切片参数错误（包括但不限于机型、喷嘴、耗材设置不当）导致的打印失败、翘边变形、强度不足、尺寸偏差、外观瑕疵等问题，无论发生在打印过程中还是打印件上，均由提交者自行承担，打印方不对此负责。如需重打，应修正后重新提交排队。"],
  ["build", "设备原因由工作人员安排重打", "因打印机故障、耗材异常等设备原因导致的失败，由工作人员判定后安排重打，无需重新提交。"],
  ["fact_check", "审核不代表质量确认", "审核仅确认是否符合活动规则，不负责检查模型或切片参数，发现明显问题时有权打回，通过审核不代表文件无误。"],
];

function Notice({ agree, onAgree }: { agree: boolean; onAgree: (v: boolean) => void }) {
  const [open, setOpen] = useState(!agree);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="submit-notice"
        onClick={() => setOpen(!open)}
        className="relative flex min-h-12 w-full cursor-pointer appearance-none items-center gap-3 overflow-hidden rounded-xl border-0 bg-sc-high py-1.5 pr-3 pl-4 text-left text-on-surface before:absolute before:inset-0 before:bg-current before:opacity-0 before:transition-opacity hover:before:opacity-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon name="checklist" className="text-on-variant" />
        <span className="flex-1">
          <span className="block text-label-l font-medium">提交前请自行检查模型和切片参数</span>
          <small className="block text-body-s text-on-variant">
            {NOTICE_CHECKS.length} 项常见问题 · {NOTICE_RULES.length} 条责任说明
          </small>
        </span>
        <Icon name="expand_more" className={cx("text-on-variant transition-transform duration-200 ease-standard", open && "rotate-180")} />
      </button>
      {open && (
        <div id="submit-notice" className="flex flex-col gap-3">
          <ul className="m-0 grid list-none gap-x-6 gap-y-2 px-4 py-1 sm:grid-cols-2">
            {NOTICE_CHECKS.map((c) => (
              <li key={c} className="relative pl-4 text-body-m before:absolute before:top-2 before:left-0.5 before:size-1.5 before:rounded-full before:bg-primary">
                {c}
              </li>
            ))}
          </ul>
          <ul className="m-0 list-none overflow-hidden rounded-xl bg-sc-high p-0">
            {NOTICE_RULES.map(([icon, title, text]) => (
              <li key={title} className="flex items-start gap-4 px-4 py-3 text-body-m border-t border-solid border-outline-variant first:border-t-0">
                <Icon name={icon} className="text-on-variant" />
                <div>
                  <b className="mb-0.5 block font-medium">{title}</b>
                  <span className="text-on-variant">{text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Checkbox
        checked={agree}
        onChange={(v) => {
          onAgree(v);
          if (v) setOpen(false);
        }}
      >
        <span className="font-medium">
          我已阅读并同意提交须知<em className="ml-0.5 text-error not-italic">*</em>
        </span>
      </Checkbox>
    </>
  );
}

/** "你的文件：2 盘符合，1 盘耗材待确认，1 盘机型或喷嘴不符" */
function FileFit({ plates }: { plates: Plate[] }) {
  const bad = plates.filter((p) => p.st === "err").length, warn = plates.filter((p) => p.st === "warn").length, ok = plates.length - bad - warn;
  const parts = [ok && <><b>{ok} 盘</b>符合</>, warn && <><b>{warn} 盘</b>需要注意</>, bad && <><b>{bad} 盘</b>不能提交</>].filter(Boolean);
  return <>你的文件：{parts.map((x, i) => <span key={i}>{i ? "，" : ""}{x}</span>)}</>;
}

function Step({ n, title, right, done, children }: { n: number; title: string; right?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <motion.section layout="position" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: t("medium4", "emphasizedDecelerate") }} className="flex flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4">
      <h2 className="m-0 flex items-center gap-3 text-title-m font-semibold">
        <span className={cx("grid size-6 place-items-center rounded-full font-num text-[13px] leading-none font-medium transition-colors duration-200", done ? "bg-primary text-on-primary" : "bg-secondary-container text-on-secondary-container")}>{n}</span>
        {title}
        {right && <span className="ml-auto text-body-s font-normal text-on-variant">{right}</span>}
      </h2>
      {children}
    </motion.section>
  );
}

export function SubmitPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const FIELDS = useFields() ?? [];
  const [upload, setUpload] = useState<File | null>(null);
  const [queue, setQueue] = useState({ length: MOCK_QUEUE_AHEAD, aheadSeconds: 0 });
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<"idle" | "parsing" | "parsed">("idle");
  const [file, setFile] = useState<{ name: string; mb: number } | null>(null);
  const [parsed, setParsed] = useState<Plate[]>([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState<Record<string, Answer>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ id: string; n: number; model: string; time: string }[] | null>(null);
  const [sumOpen, setSumOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [colour, setColour] = useState<ColourPref>(DEFAULT_COLOUR_PREF);
  const [bed, setBed] = useState("");
  const [fileBed, setFileBed] = useState<string | null>(null);
  const [resOpen, setResOpen] = useState(true);
  const [resTab, setResTab] = useState<"models" | "materials">("models");
  const resRef = useRef<HTMLDivElement>(null);
  const showRes = (tab: "models" | "materials") => {
    setResTab(tab);
    setResOpen(true);
    resRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const fin = useRef<HTMLInputElement>(null);
  const res = useResources().data;
  const rules = useRules();

  const plates = phase === "parsed" ? parsed.map((p) => withColour(p, colour, res?.colourMissing ?? "warn")) : [];
  const sel = plates.filter((p) => pick[p.n] && p.st !== "err");

  const show = (ps: Plate[]) => {
    setParsed(ps);
    setPick(Object.fromEntries(ps.map((p) => [p.n, p.st !== "err"])));
    setPhase("parsed");
    setResOpen(false);
  };
  const load = async (f: File | typeof SAMPLE) => {
    const mb = f instanceof File ? f.size / 1048576 : f.mb;
    setError("");
    if (!/\.gcode\.3mf$/i.test(f.name)) return setError("只能提交 .gcode.3mf 文件（由你自行切片后导出），当前文件格式不对。");
    if (mb > MAX_MB) return setError(`文件 ${mb.toFixed(0)} MB，超过 ${MAX_MB} MB 上限。`);
    setFile({ name: f.name, mb });
    setPhase("parsing");
    if (!(f instanceof File)) return void setTimeout(() => (setFileBed("Textured PEI Plate"), show(f.plates)), 1100);
    try {
      if (LIVE) {
        const r = await parseOnServer<OrderPreview>("/api/orders/preview", f);
        setUpload(f);
        setQueue(r.queue);
        setFileBed(r.bedType);
        show(previewPlates(r));
      } else {
        const r = await parseOnServer<ParsedUpload>("/api/gcode3mf/parse", f);
        setFileBed(r.bedType);
        show(toPlates(r, res));
      }
    } catch (e) {
      setPhase("idle");
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reset = () => {
    setPhase("idle");
    setFile(null);
    setUpload(null);
    setError("");
    setPick({});
    setForm({});
    setTouched({});
    setAll(false);
    setAgree(false);
    setDone(null);
    setBed("");
    setFileBed(null);
  };

  const fieldErr = (f: FieldDef) => {
    const a = form[f.id];
    if (Array.isArray(a)) return f.req && !a.length ? "必填" : "";
    const v = (a || "").trim();
    if (f.req && !v) return "必填";
    if (f.min && v && v.length < f.min) return `至少 ${f.min} 个字，现在 ${v.length}`;
    if (f.type === "number" && v && !Number.isFinite(Number(v))) return "要填数字";
    return "";
  };
  const formOk = FIELDS.every((f) => !fieldErr(f));
  const canSubmit = phase === "parsed" && sel.length > 0 && formOk && agree;
  const total = sel.reduce((a, p) => a + mins(p.time), 0), grams = sel.reduce((a, p) => a + p.g, 0);
  const checks: [boolean, string][] = [
    [phase === "parsed", "文件已解析"],
    [sel.length > 0, "至少一张订单可提交"],
    [formOk && phase === "parsed", "申请信息已填写"],
    [agree, "已同意提交须知"],
  ];

  const submit = async () => {
    if (!canSubmit) return setAll(true);
    if (!LIVE || !upload) return setDone(sel.map((p, i) => ({ id: "#" + (1048 + i), n: p.n, model: p.model, time: p.time })));
    const body = new FormData();
    body.append("file", upload);
    body.append("answers", JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f.id, f.type === "number" && form[f.id] ? Number(form[f.id]) : (form[f.id] ?? "")]))));
    body.append("plates", JSON.stringify(sel.map((p) => p.n)));
    body.append("colour", colour);
    if (rules?.allowPlateChoice && bed) body.append("bedType", bed);
    setSending(true);
    const r = await api<{ orders: OrderView[] }>("/api/orders", { method: "POST", body });
    setSending(false);
    if (!r.ok) {
      const issues = (r.error as { issues?: { message: string }[] }).issues;
      return toast(issues?.length ? issues.map((i) => i.message).join("；") : r.error.message || "提交失败，请重试");
    }
    void live.mine.refresh();
    setDone(r.data.orders.map((o) => ({ id: "#" + o.id, n: o.plate.index, model: shortModel(o.printerModel, o.printerModelId), time: fmtDur(o.printSeconds) })));
  };

  const sumDetail = (
    <>
      <dl className="m-0 flex flex-col gap-2.5">
        {[
          ["将生成", phase === "parsed" ? `${sel.length} 张订单` : "—"],
          ["预计总用时", sel.length ? fmt(total) : "—"],
          ["预计总用量", sel.length ? `${grams} g` : "—"],
          ["颜色要求", COLOUR_PREF_LABEL[colour]],
          ["队列前方", `${queue.length} 项`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-body-m">
            <dt className="text-on-variant">{k}</dt>
            <dd className="m-0 text-right font-medium tnum">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="m-0 flex list-none flex-col gap-2 border-t border-solid border-outline-variant p-0 pt-3 text-note text-on-variant">
        {checks.map(([ok, label]) => (
          <li key={label} className={cx("flex items-center gap-2", ok && "text-on-surface")}>
            <Icon name={ok ? "check_circle" : "info"} size={18} className={ok ? "text-ok" : "text-outline"} />
            {label}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <Page>
      <PageHeader title="提交订单" />
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.section
            key="ok"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: t("medium4", "emphasizedDecelerate") }}
            className="flex flex-col items-center gap-3 rounded-xl bg-sc px-6 py-7 text-center"
          >
            <Icon name="check_circle" size={56} className="text-ok" />
            <h2 className="m-0 text-headline-s font-normal">已提交 {done.length} 张订单</h2>
            <p className="m-0 max-w-[460px] text-body-m text-on-variant">订单已进入「待审核」。通过后会自动排队，你可以在「我的订单」里查看进度；在开始打印前可以随时取消。</p>
            <ul className="m-0 mt-2 flex w-full max-w-[520px] list-none flex-col gap-2 p-0 text-left">
              {done.map((x) => (
                <li key={x.id} className="flex items-center gap-3 rounded-xl bg-sc-high px-3.5 py-2.5 text-body-m">
                  <Icon name="description" />
                  <b className="font-num text-label-l font-medium">{x.id}</b>
                  <span>
                    第 {x.n} 盘 · {x.model} · {x.time}
                  </span>
                  <StatusChip className="ml-auto">待审核</StatusChip>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button onClick={reset}>继续提交</Button>
              <Button variant="tonal" onClick={() => navigate("/orders")}>
                查看我的订单
              </Button>
            </div>
          </motion.section>
        ) : (
          <motion.div key="form" exit={{ opacity: 0, transition: t("short3", "emphasizedAccelerate") }} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              {res?.show && (
                <div ref={resRef} className="scroll-mt-4">
                <ResourcesPanel
                  view={res}
                  open={resOpen}
                  onOpen={setResOpen}
                  tab={resTab}
                  onTab={setResTab}
                  used={new Set(plates.map((p) => p.modelId ?? ""))}
                  fit={phase === "parsed" ? <FileFit plates={plates} /> : undefined}
                />
                </div>
              )}
              <Step n={1} title="上传文件" right="只收 .gcode.3mf" done={phase === "parsed"}>
                {phase === "idle" ? (
                  <>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="选择或拖入 .gcode.3mf 文件"
                      onClick={() => fin.current?.click()}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fin.current?.click())}
                      onDragOver={(e) => (e.preventDefault(), setOver(true))}
                      onDragLeave={() => setOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) void load(f);
                      }}
                      className={cx(
                        "flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-6 text-center transition-colors duration-150 ease-standard max-sm:min-h-[168px]",
                        error ? "border-error bg-error/8" : over ? "border-primary bg-primary/8" : "border-outline-variant hover:border-primary hover:bg-primary/8",
                      )}
                    >
                      <Icon name="upload_file" size={40} className="text-primary" />
                      <div className="text-title-m font-medium">拖入 .gcode.3mf 文件，或点击选择</div>
                      <div className="max-w-[420px] text-note text-on-variant">{res?.show ? "请按上方「本场可用资源」选好机型、喷嘴和耗材，" : "请"}自行切片后导出，选好目标机型、喷嘴和耗材；文件最大 {MAX_MB} MB。多个打印板会自动拆成各自独立的订单。</div>
                      <div className="mt-1 flex flex-wrap justify-center gap-2">
                        <Button variant="tonal">选择文件</Button>
                        {!LIVE && (
                          <Button
                            variant="text"
                            onClick={(e) => {
                              e.stopPropagation();
                              void load(SAMPLE);
                            }}
                          >
                            使用示例文件
                          </Button>
                        )}
                      </div>
                    </div>
                    {error && (
                      <div role="alert" className="flex items-start gap-2 text-body-m text-error">
                        <Icon name="error" size={20} />
                        <span>{error}</span>
                      </div>
                    )}
                    <input
                      ref={fin}
                      type="file"
                      accept=".3mf"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void load(f);
                      }}
                    />
                  </>
                ) : (
                  <div className="flex items-center gap-3.5 rounded-xl bg-sc-high px-3.5 py-3">
                    <Icon name="description" size={28} className="text-primary" />
                    <div className="min-w-0 flex-1">
                      <b className="block overflow-hidden text-label-l font-medium text-ellipsis whitespace-nowrap">{file!.name}</b>
                      <small className="block text-body-s text-on-variant">
                        {file!.mb.toFixed(1)} MB · {phase === "parsing" ? "正在解析，校验文件结构…" : `已解析，${plates.length} 个打印板`}
                      </small>
                      {phase === "parsing" && <LinearIndeterminate />}
                    </div>
                    {phase === "parsed" && <IconButton icon="delete" label="移除文件" onClick={reset} />}
                  </div>
                )}
              </Step>

              {phase === "parsed" && (
                <Step n={2} title="打印板" right={sel.length === plates.length ? `将生成 ${sel.length} 张独立订单` : `已选 ${sel.length} / ${plates.length} 盘`} done>
                  <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {plates.map((p) => {
                      const on = !!pick[p.n] && p.st !== "err";
                      return (
                        <li
                          key={p.n}
                          className={cx(
                            "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-xl bg-sc-high px-3.5 py-3 transition-opacity duration-200 sm:grid-cols-[auto_88px_minmax(0,1fr)]",
                            !on && "opacity-60",
                          )}
                        >
                          <RowCheckbox label={`第 ${p.n} 盘`} checked={on} disabled={p.st === "err"} onChange={(v) => setPick({ ...pick, [p.n]: v })} />
                          <div className="size-16 justify-self-start overflow-hidden rounded-[10px] bg-sc sm:size-[88px]">
                            {p.thumb ? (
                              <img src={p.thumb} alt={`第 ${p.n} 盘预览`} className="block size-full object-contain" />
                            ) : (
                              <ModelThumb c1={p.fil[0]?.[0] ?? "var(--md-outline)"} c2={p.fil[1]?.[0]} bg="var(--md-sc-high)" />
                            )}
                          </div>
                          <div className="col-span-full flex min-w-0 flex-col gap-1.5 sm:col-span-1">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-label-l font-medium tracking-normal">
                              第 {p.n} 盘
                              <StatusChip className="bg-sc">{p.model}</StatusChip>
                              <StatusChip className="bg-sc">{p.nozzle} mm 喷嘴</StatusChip>
                              {p.st === "ok" ? (
                                <StatusChip tone="ok" icon="check_circle">
                                  可提交
                                </StatusChip>
                              ) : p.st === "warn" ? (
                                <StatusChip tone="warn" icon="warning">
                                  注意
                                </StatusChip>
                              ) : (
                                <StatusChip tone="err" icon="error">
                                  无法提交
                                </StatusChip>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-note text-on-variant [&_b]:font-medium [&_b]:text-on-surface">
                              <span>
                                预计 <b className="tnum">{p.time}</b>
                              </span>
                              <span>
                                用量 <b className="tnum">{p.g} g</b>
                              </span>
                              <FilamentDots fil={p.fil} />
                            </div>
                            {p.note && (
                              <div className={cx("text-body-s tracking-normal", p.st === "err" ? "text-error" : p.st === "ok" ? "text-on-variant" : "text-warn")}>
                                {p.note}
                                {p.res && res?.show && (
                                  <button type="button" onClick={() => showRes(p.res!)} className="ml-1 cursor-pointer appearance-none border-0 bg-transparent p-0 font-medium text-primary">
                                    查看可用资源
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-col gap-2 rounded-xl bg-sc-high px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <b className="text-label-l font-medium">颜色要求</b>
                      <Segmented radio label="颜色要求" value={colour} onChange={setColour} items={COLOUR_PREFS.map((k) => ({ key: k, label: COLOUR_PREF_LABEL[k] }))} />
                    </div>
                    <div className="text-body-s text-on-variant">{COLOUR_HINT[colour]}。对这次提交的所有盘生效。</div>
                  </div>
                  {rules?.allowPlateChoice && (
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-sc-high px-4 py-3">
                      <b className="text-label-l font-medium">热床板</b>
                      <select aria-label="热床板" value={bed} onChange={(e) => setBed(e.target.value)} className="h-9 rounded-lg border-0 bg-transparent px-3 text-label-l text-on-surface shadow-[inset_0_0_0_1px_var(--md-outline)] outline-0 focus:shadow-[inset_0_0_0_2px_var(--md-primary)]">
                        <option value="">按文件{fileBed ? `（${BED_TYPE_LABEL[fileBed] ?? fileBed}）` : ""}</option>
                        {BED_TYPES.map((b) => <option key={b} value={b}>{BED_TYPE_LABEL[b]}</option>)}
                      </select>
                    </div>
                  )}
                </Step>
              )}

              {phase === "parsed" && (
                <Step n={3} title="申请信息" right="字段由管理员配置">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {FIELDS.map((f) => {
                      const a = form[f.id];
                      const v = typeof a === "string" ? a : "";
                      const err = all || touched[f.id] ? fieldErr(f) : "";
                      const set = (val: Answer) => setForm({ ...form, [f.id]: val });
                      const blur = () => setTouched({ ...touched, [f.id]: true });
                      return (
                        <Field key={f.id} label={f.label} required={f.req} error={err || undefined} counter={f.min ? `${v.trim().length} / ${f.min}+` : undefined} className={f.wide ? "sm:col-span-2" : ""}>
                          {(id, cls) =>
                            f.type === "select" ? (
                              <Select id={id} className={cls} options={f.opts ?? []} placeholder="请选择" value={v} onChange={(e) => (set(e.target.value), blur())} />
                            ) : f.type === "multi" ? (
                              <div id={id} className="flex flex-wrap gap-x-5 gap-y-1">
                                {(f.opts ?? []).map((o) => {
                                  const cur = Array.isArray(a) ? a : [];
                                  return (
                                    <Checkbox key={o} checked={cur.includes(o)} onChange={(on) => (set(on ? [...cur, o] : cur.filter((x) => x !== o)), blur())}>
                                      {o}
                                    </Checkbox>
                                  );
                                })}
                              </div>
                            ) : f.type === "textarea" ? (
                              <TextArea id={id} className={cls} placeholder={f.ph} value={v} onChange={(e) => set(e.target.value)} onBlur={blur} />
                            ) : (
                              <TextInput id={id} className={cls} placeholder={f.ph} inputMode={f.type === "number" ? "decimal" : undefined} value={v} onChange={(e) => set(e.target.value)} onBlur={blur} />
                            )
                          }
                        </Field>
                      );
                    })}
                  </div>
                </Step>
              )}

              {phase === "parsed" && (
                <Step n={4} title="提交须知" right="必读" done={agree}>
                  <Notice agree={agree} onAgree={setAgree} />
                </Step>
              )}
            </div>

            <aside
              aria-label="订单预览"
              className="flex flex-col gap-3.5 rounded-xl bg-sc p-5 lg:sticky lg:top-4 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:flex-row max-sm:items-center max-sm:rounded-none max-sm:px-4 max-sm:pt-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))] max-sm:shadow-[0_-1px_0_var(--md-outline-variant)]"
            >
              <h2 className="m-0 text-title-m font-semibold max-sm:hidden">订单预览</h2>
              <div className="flex flex-col gap-3.5 max-sm:hidden">{sumDetail}</div>
              <button type="button" onClick={() => setSumOpen(true)} aria-label="展开订单预览" className="hidden flex-1 appearance-none border-0 bg-transparent p-0 text-left text-note text-on-variant max-sm:block">
                <b className="flex items-center gap-1 text-label-l font-medium text-on-surface">
                  {sel.length ? `${sel.length} 张订单` : "未选择文件"}
                  <Icon name="expand_less" size={18} className="text-on-variant" />
                </b>
                {sel.length ? `预计 ${fmt(total)}` : "点开查看订单预览"}
              </button>
              <Button icon="send" disabled={!canSubmit || sending} onClick={() => void submit()} className="w-full max-sm:w-auto">
                提交审核
              </Button>
              <div className="text-body-s text-on-variant max-sm:hidden">提交后进入「待审核」，Builder 审核通过才会排队。待审核期间可以自行取消。</div>
            </aside>
          </motion.div>
        )}
      </AnimatePresence>
      <Sheet open={sumOpen} onClose={() => setSumOpen(false)} title="订单预览" titleSize="lg" footer={<Button variant="text" onClick={() => setSumOpen(false)}>关闭</Button>}>
        <div className="flex flex-col gap-3.5">{sumDetail}</div>
      </Sheet>
      <div className="h-16 sm:hidden" aria-hidden="true" />
    </Page>
  );
}
