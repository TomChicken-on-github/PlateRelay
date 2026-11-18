import { useMutation } from "@tanstack/react-query";
import { Check, Clock, Copy, RotateCw, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { client, errorText, idem, unwrap } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * The pickup code for an order waiting to be collected. Opening it asks for a fresh code (which voids
 * the previous one). Phone: a bottom sheet. Desktop: a 400px dialog.
 */
export function PickupDialog({ orderId, name, slot, open, onOpenChange }: { orderId: string; name: string; slot?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const issue = useMutation({
    mutationFn: () => unwrap(client.POST("/orders/{orderId}/pickup-code", { params: { path: { orderId }, ...idem() }, body: { expectedStatus: "READY" } })),
  });
  const { mutate, reset } = issue;
  useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, mutate, reset]);

  const now = useNow(open);
  const left = issue.data ? Math.max(0, Math.round((new Date(issue.data.expiresAt).getTime() - now) / 1000)) : null;
  const expired = left === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col items-center gap-4 bg-card text-card-foreground outline-none",
            "inset-x-0 bottom-0 rounded-t-3xl px-6 pt-2.5 pb-[max(40px,env(safe-area-inset-bottom))] data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            "lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[400px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:px-6 lg:pt-6 lg:pb-7 lg:data-[state=closed]:slide-out-to-bottom-0 lg:data-[state=closed]:zoom-out-95 lg:data-[state=open]:slide-in-from-bottom-0 lg:data-[state=open]:zoom-in-95",
          )}
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-neutral-300 lg:hidden dark:bg-neutral-700" />
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="关闭" className="absolute top-4 right-4 hidden lg:inline-flex">
              <X className="size-5" />
            </Button>
          </Dialog.Close>
          <div className="flex flex-col items-center gap-1 pt-1">
            <Dialog.Title className="m-0 text-lg leading-[26px] font-bold">{name}</Dialog.Title>
            {slot && <span className="text-[13px] text-muted-foreground">存放于 {slot}</span>}
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-white shadow-[inset_0_0_0_1px_var(--border)]">
            {issue.data ? <QrCode text={issue.data.code} className={cn(expired && "blur-[5px]")} /> : <div className="size-[232px]" />}
            {(expired || issue.isError) && (
              <div className="absolute inset-0 grid place-items-center bg-white/35">
                <button
                  type="button"
                  aria-label="重新获取"
                  disabled={issue.isPending}
                  onClick={() => mutate()}
                  className="grid size-14 place-items-center rounded-full bg-neutral-900 text-neutral-50 shadow-[0_4px_12px_rgb(0_0_0/0.2)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <RotateCw className={cn("size-6", issue.isPending && "animate-spin")} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <CopyCode code={issue.data?.code} expired={expired} />
          <span className={cn("inline-flex items-center gap-1.5 text-[13px]", expired || issue.isError ? "text-alert" : "text-muted-foreground")}>
            <Clock className="size-3.5" aria-hidden="true" />
            {issue.isError ? errorText(issue.error) : expired ? "已失效" : left != null ? `${Math.floor(left / 60)} 分 ${left % 60} 秒后失效` : "获取中"}
          </span>

          <Dialog.Close asChild>
            <Button variant="secondary" size="lg" className="mt-1 w-full lg:hidden">
              关闭
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The code as one button that copies it, in the same form the pickup counter accepts.
 * The copy icon turns into a check for a moment. Once expired it is plain struck-through text.
 */
function CopyCode({ code, expired }: { code?: string; expired: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => setCopied(false), [code]);
  const mono = "font-mono text-2xl leading-8 font-semibold tracking-[2px]";
  if (!code || expired) return <span className={cn("flex h-[52px] items-center", mono, "text-faint line-through", !code && "invisible")}>{code ? code : "0000-0000"}</span>;
  const Icon = copied ? Check : Copy;
  const copy = async (e: MouseEvent<HTMLButtonElement>) => {
    if (await copyText(code, e.currentTarget.parentElement ?? undefined)) return setCopied(true);
    /* no clipboard at all: select the code so a long-press or Ctrl+C still works */
    const sel = window.getSelection();
    if (sel && text.current) sel.selectAllChildren(text.current);
  };
  return (
    <button
      type="button"
      aria-label={`复制取件码 ${code}`}
      onClick={copy}
      className="inline-flex h-[52px] items-center gap-3 rounded-[14px] bg-muted pr-2 pl-[18px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span ref={text} className={cn(mono, "select-text")}>
        {code}
      </span>
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] border border-border bg-card">
        <Icon className={cn("size-[18px]", copied ? "text-ok" : "text-muted-foreground")} />
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "已复制" : ""}
      </span>
    </button>
  );
}

/** The current time, ticking every second while `on`. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
