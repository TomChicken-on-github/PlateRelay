import { useEffect, useState } from "react";
import { printersApi } from "../lib/printersApi";
import type { DispatchOption } from "../mock/printers";
import { Button } from "./Button";
import { FigmaIcon } from "./icons/FigmaIcon";
import { Sheet } from "./Sheet";

type Opts = { suggested: number | null; rows: DispatchOption[] };

/** 派单: the orders this idle printer can take, the suggestion first and picked; Staff may pick any other. */
export function DispatchSheet({ printerId, printerName, open, busy, onClose, onConfirm }: { printerId: string; printerName: string; open: boolean; busy?: boolean; onClose: () => void; onConfirm: (o: DispatchOption) => void }) {
  const [opts, setOpts] = useState<Opts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setOpts(null);
    setErr(null);
    void printersApi.dispatchOptions(printerId).then((r) => {
      if (!live) return;
      if (!r.ok) return setErr(r.error.message || "订单列表加载失败");
      setOpts(r.data);
      setPick(r.data.suggested ?? r.data.rows[0]?.orderId ?? null);
    });
    return () => {
      live = false;
    };
  }, [open, printerId]);

  const chosen = opts?.rows.find((o) => o.orderId === pick);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<FigmaIcon name="queue" className="size-6" />}
      titleSize="lg"
      title={`派单到 ${printerName}`}
      sub={err ?? (opts && !opts.rows.length ? "没有这台机能打的订单" : undefined)}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button variant="text" disabled={!chosen || busy} onClick={() => chosen && onConfirm(chosen)}>确认派单</Button>
        </>
      }
    >
      {opts && opts.rows.length > 0 && (
        <div role="radiogroup" aria-label="选择订单" className="flex max-h-[50vh] flex-col self-stretch overflow-auto">
          {opts.rows.map((o) => (
            <label key={o.orderId} className="group relative -ml-3 flex min-h-14 cursor-pointer items-center gap-1">
              <input type="radio" name={`dispatch-${printerId}`} className="peer absolute size-12 cursor-pointer opacity-0" checked={pick === o.orderId} onChange={() => setPick(o.orderId)} />
              <span className="relative grid size-12 flex-none place-items-center rounded-full before:absolute before:inset-1 before:rounded-full before:bg-on-surface before:opacity-0 before:transition-opacity group-hover:before:opacity-8 peer-focus-visible:before:opacity-12 peer-focus-visible:outline-2 peer-focus-visible:outline-primary">
                <i className={`relative grid size-5 place-items-center rounded-full border-2 border-solid transition-colors duration-150 ease-standard ${pick === o.orderId ? "border-primary" : "border-on-variant"}`}>
                  <i className={`size-2.5 rounded-full bg-primary transition-transform duration-150 ease-standard ${pick === o.orderId ? "scale-100" : "scale-0"}`} />
                </i>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="truncate text-body-m font-medium text-on-surface">
                  #{o.orderId} · {o.file}
                </b>
                <small className="text-body-s text-on-variant">
                  {o.pos ? `队列第 ${o.pos} 位 · ` : ""}第 {o.n} 盘 · {o.time} · {o.owner}
                </small>
              </span>
              {o.orderId === opts.suggested && <span className="inline-flex h-6 flex-none items-center rounded-lg bg-secondary-container px-2 text-body-s font-medium text-on-secondary-container">建议</span>}
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}
