import type * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload as UploadIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { NotificationBell, PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, client, errorText, idem, type Schemas, unwrap, uploadFile } from "@/lib/api";
import { takePendingFile } from "@/lib/pending-file";
import { cn } from "@/lib/utils";
import { FileCard, type Upload } from "./file-card";
import { PlateCard } from "./plate-card";
import { ResourcesRow } from "./resources-row";

type FileCheck = Schemas["FileCheck"];
type ColourPref = Schemas["ColourPref"];

/* Why the server refused a file, by finding code. */
const REFUSED: Record<string, string> = {
  bad_extension: "只支持 .gcode.3mf 文件",
  too_large: "文件太大",
  not_zip: "文件已损坏",
  not_sliced: "文件没有切片",
  bad_metadata: "读不出切片信息",
  parse_timeout: "解析超时",
};

const COLOUR_PREFS: { value: ColourPref; label: string }[] = [
  { value: "EXACT", label: "一致" },
  { value: "SIMILAR", label: "相近" },
  { value: "ANY", label: "无所谓" },
];

export function SubmitPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resources = useQuery({ queryKey: ["resources"], queryFn: () => unwrap(client.GET("/resources")) }).data;
  const form = useQuery({ queryKey: ["form"], queryFn: () => unwrap(client.GET("/form")) });

  const [upload, setUpload] = useState<Upload | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const abort = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [colourPref, setColourPref] = useState<ColourPref>("SIMILAR");
  const [bedType, setBedType] = useState("");
  const [agreed, setAgreed] = useState(false);

  async function start(file: File) {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setCheck(null);
    setUpload({ phase: "uploading", file, progress: 0 });
    try {
      let c = await uploadFile(file, {
        signal: ctl.signal,
        onProgress: (progress) => !ctl.signal.aborted && setUpload({ phase: "uploading", file, progress }),
        onSent: () => !ctl.signal.aborted && setUpload({ phase: "parsing", file }),
      });
      /* The check usually comes back finished; if not, ask again until it is. */
      while (c.status === "QUEUED" || c.status === "RUNNING") {
        setUpload({ phase: c.status === "QUEUED" ? "parsing" : "checking", file });
        await new Promise((r) => setTimeout(r, 1000));
        if (ctl.signal.aborted) return;
        c = await unwrap(client.GET("/files/{fileId}/check", { params: { path: { fileId: c.fileId } } }));
      }
      if (ctl.signal.aborted) return;
      if (c.status === "ERROR" || c.verdict === "REJECT") {
        const f = c.findings.find((x) => x.severity === "REJECT");
        setUpload({ phase: "failed", file, reason: (f && REFUSED[f.code]) ?? "文件没有通过校验" });
        return;
      }
      setCheck(c);
      setUpload({ phase: "passed", file, sizeBytes: c.sizeBytes });
    } catch (e) {
      if (e instanceof ApiError && e.code === "aborted") return;
      setUpload({ phase: "failed", file, reason: errorText(e) });
    }
  }

  function cancel() {
    abort.current?.abort();
    setUpload(null);
    setCheck(null);
  }

  useEffect(() => {
    const f = takePendingFile();
    if (f) void start(f);
    return () => abort.current?.abort();
  }, []);

  const plates = check?.plates ?? [];
  const ready = plates.filter((p) => p.submittable);

  /* Bed types: what every model of the plates to submit can use. Null when applicants may not choose. */
  const beds = resources?.bedTypes
    ? [...new Set(ready.map((p) => p.modelId))].reduce<string[]>((acc, m) => acc.filter((b) => resources.printers.filter((r) => r.modelId === m).some((r) => r.bedTypes.includes(b))), resources.bedTypes)
    : null;
  useEffect(() => {
    if (bedType && beds && !beds.includes(bedType)) setBedType("");
  }, [bedType, beds]);

  const fields = form.data?.fields ?? [];
  const filled = fields.every((f) => !f.required || !isEmpty(answers[f.id]));
  const canSubmit = !!check && ready.length > 0 && filled && agreed && !!form.data;

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/orders", {
          params: idem(),
          body: {
            fileId: check!.fileId,
            plates: ready.map((p) => p.index),
            colourPref,
            ...(beds ? { bedType: bedType || null } : {}),
            formVersionId: form.data!.versionId,
            answers: fields.filter((f) => !isEmpty(answers[f.id])).map((f) => ({ fieldId: f.id, value: f.type === "number" ? Number(answers[f.id]) : answers[f.id] })),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      navigate("/orders");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "version_conflict") void form.refetch();
    },
  });

  const fileInput = (
    <input
      ref={picker}
      type="file"
      accept=".3mf"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void start(f);
      }}
    />
  );
  const pick = () => picker.current?.click();

  if (!upload)
    return (
      <>
        <PageHeader title="提交" actions={<NotificationBell />} />
        {fileInput}
        <EmptyDrop onFile={start} onPick={pick} />
        <ResourcesRow resources={resources} />
      </>
    );

  const agreeAndSubmit = (
    <>
      <label className="flex items-center gap-2.5 text-sm leading-5">
        <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        <span>
          我已阅读并同意提交须知<span className="text-alert">*</span>
        </span>
      </label>
      {submit.error && <Alert>{errorText(submit.error)}</Alert>}
      <Button size="lg" className="w-full" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
        {ready.length ? `提交 ${ready.length} 单` : "提交"}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title="提交" actions={<NotificationBell />} />
      {fileInput}
      <div className="grid items-start gap-4 pb-[120px] lg:grid-cols-[minmax(0,1fr)_400px] lg:pb-0">
        <div className="flex min-w-0 flex-col gap-2.5 lg:gap-4">
          <FileCard upload={upload} onCancel={cancel} onReplace={pick} />
          {check && plates.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="m-0 px-1 text-[15px] leading-[22px] font-semibold text-muted-foreground">将生成 {ready.length} 张订单</h2>
              {plates.map((p) => (
                <PlateCard key={p.index} plate={p} resources={resources} />
              ))}
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2.5 lg:gap-4">
          <section className="flex flex-col gap-4 rounded-2xl bg-card p-4">
            <h2 className="m-0 text-[15px] leading-[22px] font-semibold">申请</h2>
            {fields.map((f) => (
              <FormField key={f.id} field={f} value={answers[f.id]} onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))} />
            ))}
            <Row label="颜色要求">
              <Segmented label="颜色要求" value={colourPref} onChange={setColourPref} options={COLOUR_PREFS} />
            </Row>
            {beds && (
              <Row label="打印板" htmlFor="bed">
                <NativeSelect id="bed" value={bedType} onChange={(e) => setBedType(e.target.value)}>
                  <option value="">按切片</option>
                  {beds.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </Row>
            )}
          </section>
          <section className="hidden flex-col gap-3 rounded-2xl bg-card p-4 lg:flex">{agreeAndSubmit}</section>
          <ResourcesRow resources={resources} />
        </div>
      </div>

      {/* phone: the agreement and the button stay above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2.5 bg-card px-4 pt-3 pb-3 shadow-[0_-1px_0_var(--border)] lg:hidden">{agreeAndSubmit}</div>
    </>
  );
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function Row({ label, htmlFor, required, children }: { label: string; htmlFor?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm leading-5 font-medium text-subtle-foreground">
        {label}
        {required && <span className="text-alert">*</span>}
      </label>
      {children}
    </div>
  );
}

function FormField({ field: f, value, onChange }: { field: Schemas["FormField"]; value: unknown; onChange: (v: unknown) => void }) {
  const id = `field-${f.id}`;
  const str = typeof value === "string" ? value : "";
  let control: React.ReactNode;
  switch (f.type) {
    case "textarea":
      control = <Textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      control = <Input id={id} type="number" inputMode="decimal" value={str} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "single":
      control = (
        <NativeSelect id={id} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled={f.required}>
            请选择
          </option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </NativeSelect>
      );
      break;
    case "multi": {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-col gap-2">
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={picked.includes(o)} onCheckedChange={(v) => onChange(v === true ? [...picked, o] : picked.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    }
    default:
      control = <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Row label={f.label} htmlFor={f.type === "multi" ? undefined : id} required={f.required}>
      {control}
    </Row>
  );
}

/** No file yet. Phone: a dashed card with a button. Desktop: a tall drop zone. */
function EmptyDrop({ onFile, onPick }: { onFile: (f: File) => void; onPick: () => void }) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <section
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-faint px-4 py-10 lg:h-[380px]", over && "border-foreground bg-card")}
    >
      <UploadIcon className="size-7 text-muted-foreground" aria-hidden="true" />
      <span className="hidden text-[15px] leading-[22px] font-semibold lg:block">拖入 .gcode.3mf 文件</span>
      <Button onClick={onPick}>选择文件</Button>
      <span className="text-[13px] leading-[18px] text-muted-foreground lg:hidden">.gcode.3mf</span>
    </section>
  );
}
