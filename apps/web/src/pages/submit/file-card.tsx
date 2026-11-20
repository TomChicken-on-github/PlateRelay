import { Check, FileBox, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Upload =
  | { phase: "uploading"; file: File; progress: number }
  | { phase: "parsing"; file: File }
  | { phase: "checking"; file: File }
  | { phase: "passed"; file: File; sizeBytes: number }
  | { phase: "failed"; file: File; reason: string };

/** The uploaded file: progress while it goes up, then the check result. */
export function FileCard({ upload, onCancel, onReplace }: { upload: Upload; onCancel: () => void; onReplace: () => void }) {
  const failed = upload.phase === "failed";
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-3.5 lg:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", failed ? "bg-alert-surface text-alert" : "bg-muted text-muted-foreground")}>
          <FileBox className="size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-[22px] font-semibold">{upload.file.name}</span>
          <Subline upload={upload} />
        </span>
        {upload.phase === "uploading" && (
          <Button variant="ghost" size="icon-sm" aria-label="取消上传" onClick={onCancel}>
            <X className="size-[18px]" />
          </Button>
        )}
        {upload.phase === "passed" && (
          <Button variant="secondary" size="sm" onClick={onReplace}>
            <FileUp className="size-4" aria-hidden="true" />
            更换文件
          </Button>
        )}
      </div>
      {upload.phase === "uploading" && (
        <div className="h-1 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
        </div>
      )}
      {(upload.phase === "parsing" || upload.phase === "checking") && (
        <div className="h-1 overflow-hidden rounded-full bg-track">
          <div className="animate-indeterminate h-full w-1/3 rounded-full bg-primary" />
        </div>
      )}
      {failed && (
        <Button variant="outline" size="sm" className="self-start" onClick={onReplace}>
          重新提交
        </Button>
      )}
    </section>
  );
}

function Subline({ upload }: { upload: Upload }) {
  const cls = "truncate text-[13px] leading-[18px]";
  switch (upload.phase) {
    case "uploading":
      return (
        <span className={cn(cls, "text-muted-foreground")}>
          {bytes(upload.file.size)} · 上传中 {Math.round(upload.progress * 100)}%
        </span>
      );
    case "parsing":
      return <span className={cn(cls, "text-muted-foreground")}>{bytes(upload.file.size)} · 解析中</span>;
    case "checking":
      return <span className={cn(cls, "text-muted-foreground")}>{bytes(upload.file.size)} · 校验中</span>;
    case "passed":
      return (
        <span className={cn(cls, "flex items-center gap-1 text-muted-foreground")}>
          {bytes(upload.sizeBytes)} ·
          <span className="inline-flex items-center gap-0.5 text-ok">
            <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
            校验通过
          </span>
        </span>
      );
    case "failed":
      return <span className={cn(cls, "text-alert")}>{upload.reason}</span>;
  }
}
