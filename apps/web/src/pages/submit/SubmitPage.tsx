import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, IconButton } from "../../components/Button";
import { StatusChip } from "../../components/Chip";
import { RowCheckbox } from "../../components/Checkbox";
import { Field, Select, TextArea, TextInput } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { FilamentDots, ModelThumb } from "../../components/ModelThumb";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import type { ParsedUpload, ParseErrorBody } from "@platerelay/shared";
import { LinearIndeterminate } from "../../components/WavyProgress";
import { cx } from "../../lib/cx";
import { t } from "../../lib/motion";
import { PRINTERS } from "../../mock/printers";

const QUEUE_AHEAD = 7, MAX_MB = 200;

/* Application form fields are configured by admins (系统设置 → 申请表单); these are the defaults. */
const FIELDS = [
  { id: "purpose", label: "用途", type: "select", req: true, opts: ["比赛零件", "调试测试", "备件替换", "其他"] },
  { id: "team", label: "队伍 / 编号", type: "text", req: true, ph: "例如 T-014" },
  { id: "reason", label: "打印理由", type: "textarea", req: true, min: 10, ph: "说明这个零件的用途和为什么需要打印（至少 10 个字）", wide: true },
  { id: "note", label: "备注", type: "textarea", req: false, ph: "选填：给审核人的补充说明", wide: true },
] as const;
type FieldDef = (typeof FIELDS)[number];

type Plate = { n: number; model: string; nozzle: string; time: string; g: number; fil: [string, string][]; st: "ok" | "warn" | "err"; note?: string; thumb?: string | null };

/* Canned result for the "使用示例文件" demo; real files go to the panel's parse endpoint. */
const SAMPLE = {
  name: "机械臂轴承座.gcode.3mf",
  mb: 38.4,
  plates: [
    { n: 1, model: "X2D", nozzle: "0.4", time: "2h 00m", g: 48, fil: [["#00c0e8", "PLA"], ["#ffcc00", "PLA"]], st: "ok" },
    { n: 2, model: "X2D", nozzle: "0.4", time: "1h 12m", g: 31, fil: [["#6155f5", "PETG"]], st: "warn", note: "预计排队较长：该机型当前只有 1 台空闲后可用" },
    { n: 3, model: "H2D", nozzle: "0.6", time: "3h 25m", g: 96, fil: [["#0088ff", "PLA"]], st: "err", note: "没有可用的 H2D 打印机（故障中），暂时不能提交这一盘" },
  ] as Plate[],
};

const mins = (s: string) => {
  const m = s.match(/(\d+)h\s*(\d+)m/);
  return m ? +m[1] * 60 + +m[2] : 0;
};
const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/* Availability still comes from the mock printer list until printer management has a backend. */
function toPlates(r: ParsedUpload): Plate[] {
  const model = r.printerModel?.replace(/^Bambu Lab\s+/, "") ?? r.plates[0]?.printerModelId ?? "未知机型";
  const fleet = PRINTERS.filter((p) => p.model === r.printerModel);
  return r.plates.map((p) => {
    const plate: Plate = {
      n: p.index,
      model,
      nozzle: [...new Set(p.nozzles.map((z) => z.diameter))].join(" / "),
      time: fmt(Math.round(p.printSeconds / 60)),
      g: Math.round(p.weightGrams),
      fil: p.filaments.map((f) => [f.color, f.type]),
      st: "ok",
      thumb: p.thumbnailUrl,
    };
    if (!fleet.length) return { ...plate, st: "err", note: `没有 ${model} 打印机，暂时不能提交这一盘` };
    if (p.outside) return { ...plate, st: "warn", note: "有物体超出打印区域，请在切片软件里检查后重新导出" };
    return plate;
  });
}

async function parseOnServer(f: File): Promise<ParsedUpload> {
  const body = new FormData();
  body.append("file", f);
  let res: Response;
  try {
    res = await fetch("/api/gcode3mf/parse", { method: "POST", body });
  } catch {
    throw new Error("连不上解析服务，请稍后再试。");
  }
  const json: unknown = await res.json().catch(() => null);
  /* A non-JSON answer comes from a proxy in front of a server that is down. */
  if (json === null) throw new Error(`连不上解析服务，请稍后再试（HTTP ${res.status}）。`);
  if (!res.ok) throw new Error((json as Partial<ParseErrorBody>).message || `解析失败（HTTP ${res.status}）`);
  return json as ParsedUpload;
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
  const [phase, setPhase] = useState<"idle" | "parsing" | "parsed">("idle");
  const [file, setFile] = useState<{ name: string; mb: number } | null>(null);
  const [parsed, setParsed] = useState<Plate[]>([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const [done, setDone] = useState<{ id: string; n: number; model: string; time: string }[] | null>(null);
  const [sumOpen, setSumOpen] = useState(false);
  const [over, setOver] = useState(false);
  const fin = useRef<HTMLInputElement>(null);

  const plates = phase === "parsed" ? parsed : [];
  const sel = plates.filter((p) => pick[p.n] && p.st !== "err");

  const show = (ps: Plate[]) => {
    setParsed(ps);
    setPick(Object.fromEntries(ps.map((p) => [p.n, p.st !== "err"])));
    setPhase("parsed");
  };
  const load = async (f: File | typeof SAMPLE) => {
    const mb = f instanceof File ? f.size / 1048576 : f.mb;
    setError("");
    if (!/\.gcode\.3mf$/i.test(f.name)) return setError("只能提交 .gcode.3mf 文件（由你自行切片后导出），当前文件格式不对。");
    if (mb > MAX_MB) return setError(`文件 ${mb.toFixed(0)} MB，超过 ${MAX_MB} MB 上限。`);
    setFile({ name: f.name, mb });
    setPhase("parsing");
    if (!(f instanceof File)) return void setTimeout(() => show(f.plates), 1100);
    try {
      show(toPlates(await parseOnServer(f)));
    } catch (e) {
      setPhase("idle");
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reset = () => {
    setPhase("idle");
    setFile(null);
    setError("");
    setPick({});
    setForm({});
    setTouched({});
    setAll(false);
    setDone(null);
  };

  const fieldErr = (f: FieldDef) => {
    const v = (form[f.id] || "").trim();
    if (f.req && !v) return "必填";
    if ("min" in f && v && v.length < f.min) return `至少 ${f.min} 个字，现在 ${v.length}`;
    return "";
  };
  const formOk = FIELDS.every((f) => !fieldErr(f));
  const canSubmit = phase === "parsed" && sel.length > 0 && formOk;
  const total = sel.reduce((a, p) => a + mins(p.time), 0), grams = sel.reduce((a, p) => a + p.g, 0);
  const checks: [boolean, string][] = [
    [phase === "parsed", "文件已解析"],
    [sel.length > 0, "至少一张订单可提交"],
    [formOk && phase === "parsed", "申请信息已填写"],
  ];

  const submit = () => {
    if (!canSubmit) return setAll(true);
    setDone(sel.map((p, i) => ({ id: "#" + (1048 + i), n: p.n, model: p.model, time: p.time })));
  };

  const sumDetail = (
    <>
      <dl className="m-0 flex flex-col gap-2.5">
        {[
          ["将生成", phase === "parsed" ? `${sel.length} 张订单` : "—"],
          ["预计总用时", sel.length ? fmt(total) : "—"],
          ["预计总用量", sel.length ? `${grams} g` : "—"],
          ["队列前方", `${QUEUE_AHEAD} 项`],
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
                      <div className="max-w-[420px] text-note text-on-variant">请自行切片后导出，选好目标机型、喷嘴和耗材；文件最大 {MAX_MB} MB。多个打印板会自动拆成各自独立的订单。</div>
                      <div className="mt-1 flex flex-wrap justify-center gap-2">
                        <Button variant="tonal">选择文件</Button>
                        <Button
                          variant="text"
                          onClick={(e) => {
                            e.stopPropagation();
                            void load(SAMPLE);
                          }}
                        >
                          使用示例文件
                        </Button>
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
                            {p.note && <div className={cx("text-body-s tracking-normal", p.st === "err" ? "text-error" : "text-warn")}>{p.note}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Step>
              )}

              {phase === "parsed" && (
                <Step n={3} title="申请信息" right="字段由管理员配置">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {FIELDS.map((f) => {
                      const v = form[f.id] || "";
                      const err = all || touched[f.id] ? fieldErr(f) : "";
                      const set = (val: string) => setForm({ ...form, [f.id]: val });
                      const blur = () => setTouched({ ...touched, [f.id]: true });
                      return (
                        <Field key={f.id} label={f.label} required={f.req} error={err || undefined} counter={"min" in f ? `${v.trim().length} / ${f.min}+` : undefined} className={"wide" in f ? "sm:col-span-2" : ""}>
                          {(id, cls) =>
                            f.type === "select" ? (
                              <Select id={id} className={cls} options={f.opts} placeholder="请选择" value={v} onChange={(e) => (set(e.target.value), blur())} />
                            ) : f.type === "textarea" ? (
                              <TextArea id={id} className={cls} placeholder={f.ph} value={v} onChange={(e) => set(e.target.value)} onBlur={blur} />
                            ) : (
                              <TextInput id={id} className={cls} placeholder={f.ph} value={v} onChange={(e) => set(e.target.value)} onBlur={blur} />
                            )
                          }
                        </Field>
                      );
                    })}
                  </div>
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
              <Button icon="send" disabled={!canSubmit} onClick={submit} className="w-full max-sm:w-auto">
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
