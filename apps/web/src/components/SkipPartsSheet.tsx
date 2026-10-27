import type { OrderPartsView } from "@platerelay/shared";
import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { ordersApi } from "../lib/ordersApi";
import { Button } from "./Button";
import { RowCheckbox } from "./Checkbox";
import { StatusChip } from "./Chip";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/** Pixel → part id from the pick map (r + g·256 + b·65536), plus where each part's label goes. */
type PlateMap = { top: ImageData; ids: Int32Array; w: number; h: number; centre: Map<number, [number, number]> };

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = src;
  });

async function plateMap(topUrl: string, pickUrl: string): Promise<PlateMap> {
  const [top, pick] = await Promise.all([loadImage(topUrl), loadImage(pickUrl)]);
  const w = top.naturalWidth, h = top.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(pick, 0, 0, w, h);
  const p = g.getImageData(0, 0, w, h).data;
  g.clearRect(0, 0, w, h);
  g.drawImage(top, 0, 0, w, h);
  const ids = new Int32Array(w * h);
  const acc = new Map<number, [number, number, number]>();
  for (let i = 0; i < w * h; i++) {
    if (!p[i * 4 + 3]) continue;
    const id = p[i * 4] + p[i * 4 + 1] * 256 + p[i * 4 + 2] * 65536;
    ids[i] = id;
    const a = acc.get(id) ?? [0, 0, 0];
    a[0] += i % w;
    a[1] += (i / w) | 0;
    a[2]++;
    acc.set(id, a);
  }
  const centre = new Map([...acc].map(([id, [x, y, n]]): [number, [number, number]] => [id, [(x / n / w) * 100, (y / n / h) * 100]]));
  return { top: g.getImageData(0, 0, w, h), ids, w, h, centre };
}

const rgb = (hex: string) => {
  const m = hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? [1, 2, 3].map((k) => parseInt(m[k], 16)) : [179, 38, 30];
};

/**
 * 跳过零件: the plate's top view and its part list, both pickable. Skipped parts are greyed out
 * and cannot be picked again; at least one part has to stay.
 */
export function SkipPartsSheet({ orderId, sub, open, onClose }: { orderId: number; sub: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<OrderPartsView | null>(null);
  const [map, setMap] = useState<PlateMap | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    let on = true;
    setSel(new Set());
    setPending(new Set());
    setConfirm(false);
    void ordersApi.parts(orderId).then(async (r) => {
      if (!on) return;
      if (!r.ok) return toast(r.error.message || "零件信息加载失败");
      setView(r.data);
      const m = await plateMap(r.data.topUrl, r.data.pickUrl).catch(() => null);
      if (on) setMap(m);
    });
    return () => {
      on = false;
    };
  }, [open, orderId]);

  const parts = view?.parts ?? [];
  const gone = (id: number) => !!view?.skipped.includes(id) || pending.has(id);
  const left = parts.filter((p) => !gone(p.id)).length - sel.size;
  const no = (id: number) => parts.findIndex((p) => p.id === id) + 1;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !map) return;
    cv.width = map.w;
    cv.height = map.h;
    const out = new ImageData(new Uint8ClampedArray(map.top.data), map.w, map.h);
    const d = out.data;
    const E = rgb(getComputedStyle(document.documentElement).getPropertyValue("--md-error"));
    for (let i = 0; i < map.w * map.h; i++) {
      const id = map.ids[i];
      if (!id) continue;
      const k = i * 4;
      if (gone(id)) {
        const y = (d[k] + d[k + 1] + d[k + 2]) / 3;
        d[k] = d[k + 1] = d[k + 2] = y;
        d[k + 3] *= 0.3;
      } else if (sel.has(id)) {
        for (let c = 0; c < 3; c++) d[k + c] = d[k + c] * 0.35 + E[c] * 0.65;
      } else if (hover === id) {
        for (let c = 0; c < 3; c++) d[k + c] = d[k + c] * 0.8 + 51;
      }
    }
    cv.getContext("2d")!.putImageData(out, 0, 0);
  });

  const at = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!map) return 0;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * map.w), y = Math.floor(((e.clientY - r.top) / r.height) * map.h);
    const id = map.ids[y * map.w + x] ?? 0;
    return id && parts.some((p) => p.id === id) && !gone(id) ? id : 0;
  };
  const toggle = (id: number, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const go = async () => {
    const ids = [...sel];
    setConfirm(false);
    setSel(new Set());
    setPending(new Set(ids));
    const r = await ordersApi.skipParts(orderId, ids);
    setPending(new Set());
    if (!r.ok) return toast(r.error.message || "跳过失败，请重试");
    setView((v) => v && { ...v, skipped: [...v.skipped, ...ids] });
    toast(`已跳过 ${ids.length} 个零件`);
  };

  const n = sel.size;
  const done = !!view?.skipped.length;
  return (
    <>
      <Sheet
        wide
        open={open}
        onClose={onClose}
        title={`跳过零件 #${orderId}`}
        sub={sub}
        footer={
          <>
            <Button variant="text" onClick={onClose}>{pending.size || done ? "关闭" : "取消"}</Button>
            <Button variant="danger" icon="skip_next" disabled={!n || left < 1} onClick={() => setConfirm(true)}>
              跳过{n ? ` ${n} 个` : ""}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 items-start gap-4 max-[640px]:grid-cols-1">
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-sc shadow-[inset_0_0_0_1px_var(--md-outline-variant)] max-[640px]:mx-auto max-[640px]:w-full max-[640px]:max-w-[320px]">
            {/* storage without CORS taints the canvas: then the plain top view, picking from the list only */}
            {view && !map && <img src={view.topUrl} alt="" className="absolute inset-0 size-full" />}
            <canvas
              ref={canvas}
              aria-label="打印板俯视图，点选要跳过的零件"
              className="absolute inset-0 size-full touch-manipulation"
              style={{ cursor: hover ? "pointer" : "default" }}
              onMouseMove={(e) => setHover(at(e) || null)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                const id = at(e);
                if (id) toggle(id, !sel.has(id));
              }}
            />
            {map &&
              parts.map((p, i) => {
                const c = map.centre.get(p.id);
                if (!c) return null;
                return (
                  <span
                    key={p.id}
                    className={cx(
                      "pointer-events-none absolute grid h-[22px] min-w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-1 font-num text-[12px] leading-none font-medium shadow-[0_1px_3px_rgb(0_0_0/0.35)]",
                      gone(p.id) ? "bg-sc-high text-on-variant line-through" : sel.has(p.id) ? "bg-error text-on-error" : "bg-surface text-on-surface",
                    )}
                    style={{ left: `${c[0]}%`, top: `${c[1]}%` }}
                  >
                    {i + 1}
                  </span>
                );
              })}
          </div>
          <ul className="m-0 flex max-h-[296px] list-none flex-col overflow-auto p-0 max-[640px]:max-h-none">
            {parts.map((p, i) => {
              const off = gone(p.id);
              return (
                <li key={p.id}>
                  <label className={cx("flex min-h-12 items-center gap-3 rounded-xl px-2", off ? "text-on-variant" : "cursor-pointer hover:bg-on-surface/8")}>
                    <RowCheckbox danger label={p.name} checked={sel.has(p.id)} disabled={off} onChange={(v) => toggle(p.id, v)} />
                    <span className={cx("grid size-[22px] flex-none place-items-center rounded-full font-num text-[12px] leading-none font-medium", sel.has(p.id) ? "bg-error text-on-error" : "bg-sc-high text-on-variant")}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-body-m">{p.name}</span>
                    {pending.has(p.id) ? (
                      <span role="status" aria-label="等待打印机确认" className="spin size-[18px] flex-none rounded-full border-2 border-solid border-outline border-t-primary" />
                    ) : (
                      view?.skipped.includes(p.id) && <StatusChip>已跳过</StatusChip>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </Sheet>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        icon="skip_next"
        iconTone="error"
        titleSize="lg"
        title={`跳过 ${n} 个零件？`}
        footer={
          <>
            <Button variant="text" onClick={() => setConfirm(false)}>返回</Button>
            <Button variant="text" style={{ color: "var(--md-error)" }} onClick={() => void go()}>跳过</Button>
          </>
        }
      >
        <div className="text-body-m text-on-variant">
          {[...sel].map((id) => (
            <div key={id}>
              {no(id)}. {parts.find((p) => p.id === id)?.name}
            </div>
          ))}
        </div>
        <div className="text-body-m text-on-variant">跳过后不能恢复。</div>
      </Sheet>
    </>
  );
}
