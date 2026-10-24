import { useLayoutEffect, useRef } from "react";
import { cx } from "../../lib/cx";
import type { DetailSpool } from "../../mock/printers";

/* AMS panel after the Figma component "AMS / Ext 耗材切换": header strip (left nozzle | right nozzle),
   slot tiles 45.5x100 with 16 gaps, disabled feed buttons and the humidity capsule.
   The 245px block is scaled uniformly to the card (k = width / 245, clamped 0.8 to 1.2); gaps never spread. */

const lum = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const TILE_H = 100, PAD = 8;

/* Text line occupying [lo, hi] px from the tile bottom: contrast colour over the filament fill, tinted colour above it,
   split with a hard gradient when the fill edge crosses the line. */
function lineInk(c: string, lo: number, hi: number, fill: number): React.CSSProperties {
  const over = lum(c) > 0.5 ? "#1d1b20" : "#ffffff", off = "var(--ink)";
  if (fill >= hi) return { color: over };
  if (fill <= lo) return { color: off };
  const cut = (((hi - fill) / (hi - lo)) * 100).toFixed(1);
  return { background: `linear-gradient(${off} ${cut}%, ${over} ${cut}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };
}

function Slot({ x }: { x: DetailSpool }) {
  const fill = Math.round((TILE_H * x.r) / 100);
  return (
    <div
      title={`${x.s} ${x.m} · 余 ${x.r}%`}
      className="relative flex h-[100px] flex-col justify-between overflow-hidden rounded-xl bg-sc-high py-2 pr-1.5 pl-2 tracking-[0.5px]"
      style={{ "--c": x.c, "--ink": `color-mix(in srgb, ${x.c} 40%, light-dark(#000, #fff))`, boxShadow: `inset 0 0 0 1.5px ${x.c}` } as React.CSSProperties}
    >
      <i className="absolute inset-x-0 bottom-0 rounded-b-[10px] transition-[height] duration-500 ease-standard" style={{ height: `${x.r}%`, background: x.c }} />
      <span
        className={cx("relative z-[1] self-start text-body-s font-medium tracking-[0.5px]", x.on && "-mx-[3px] rounded-[3px] bg-sc-high px-[3px]")}
        style={x.on ? { color: "var(--ink)" } : lineInk(x.c, TILE_H - PAD - 16, TILE_H - PAD, fill)}
      >
        {x.s}
      </span>
      <span className="relative z-[1] flex flex-col text-label-s font-medium">
        <b className="text-[11px] leading-5 font-medium" style={lineInk(x.c, PAD + 16, PAD + 36, fill)}>
          {x.m}
        </b>
        <em className="not-italic" style={lineInk(x.c, PAD, PAD + 16, fill)}>
          {x.r}%
        </em>
      </span>
    </div>
  );
}

function AmsIcon({ c }: { c: string[] }) {
  return (
    <svg className="h-[23px] w-9" viewBox="0 0 36 23" fill="none" aria-hidden="true">
      <path d="M30.3736 2.30005H5.62629C3.14127 2.30005 1.12677 4.35954 1.12677 6.90005V16.1C1.12677 18.6406 3.14127 20.7 5.62629 20.7H30.3736C32.8587 20.7 34.8732 18.6406 34.8732 16.1V6.90005C34.8732 4.35954 32.8587 2.30005 30.3736 2.30005Z" fill="currentColor" fillOpacity="0.0588" stroke="currentColor" strokeOpacity="0.149" strokeWidth="1.2" />
      <path d="M1.12677 14.95H34.8732V17.25C34.8732 19.1554 33.3623 20.7 31.4985 20.7H4.50141C2.63765 20.7 1.12677 19.1554 1.12677 17.25V14.95Z" fill="currentColor" fillOpacity="0.1216" />
      <path d="M10.6884 8.05C10.6884 6.77975 9.68106 5.75 8.43842 5.75C7.19577 5.75 6.18842 6.77975 6.18842 8.05V13.8C6.18842 15.0703 7.19577 16.1 8.43842 16.1C9.68106 16.1 10.6884 15.0703 10.6884 13.8V8.05Z" fill={c[0] ?? "transparent"} />
      <path d="M17.4384 8.05C17.4384 6.77975 16.4311 5.75 15.1884 5.75C13.9458 5.75 12.9384 6.77975 12.9384 8.05V13.8C12.9384 15.0703 13.9458 16.1 15.1884 16.1C16.4311 16.1 17.4384 15.0703 17.4384 13.8V8.05Z" fill={c[1] ?? "transparent"} />
      <path d="M24.1884 8.05C24.1884 6.77975 23.1811 5.75 21.9384 5.75C20.6958 5.75 19.6884 6.77975 19.6884 8.05V13.8C19.6884 15.0703 20.6958 16.1 21.9384 16.1C23.1811 16.1 24.1884 15.0703 24.1884 13.8V8.05Z" fill={c[2] ?? "transparent"} />
      <path d="M27.5539 6.06334C27.887 5.86416 28.2747 5.75 28.6884 5.75C29.1022 5.75 29.4898 5.86416 29.8229 6.06334M26.7342 6.90923C26.546 7.24544 26.4384 7.63487 26.4384 8.05V9.00833M26.4384 9.96667V11.8833M26.4384 12.8417V13.8C26.4384 14.2151 26.546 14.6046 26.7342 14.9408M27.5539 15.7867C27.887 15.9858 28.2747 16.1 28.6884 16.1C29.1022 16.1 29.4898 15.9858 29.8229 15.7867M30.6426 14.9408C30.8308 14.6046 30.9384 14.2151 30.9384 13.8V12.8417M30.9384 11.8833V9.96667M30.9384 9.00833V8.05C30.9384 7.63487 30.8308 7.24544 30.6426 6.90923" stroke="currentColor" strokeOpacity="0.302" />
    </svg>
  );
}

function ExtIcon({ c }: { c: string | null }) {
  return (
    <svg className="h-[19px] w-[15px]" viewBox="0 0 15 19" fill="none" aria-hidden="true">
      <rect width="15" height="19" rx="4" fill="currentColor" fillOpacity="0.0588" />
      <rect x="0.5" y="0.5" width="14" height="18" rx="3.5" stroke="currentColor" strokeOpacity="0.149" />
      <path
        d="M9.75 6.625C9.75 5.3547 8.74264 4.325 7.5 4.325C6.25736 4.325 5.25 5.3547 5.25 6.625V12.375C5.25 13.6452 6.25736 14.675 7.5 14.675C8.74264 14.675 9.75 13.6452 9.75 12.375V6.625Z"
        fill={c ?? "none"}
        stroke="currentColor"
        strokeOpacity="0.302"
      />
    </svg>
  );
}

const DROP = "M8.18335 12.6667C8.31669 12.6556 8.43058 12.6028 8.52502 12.5084C8.61946 12.4139 8.66669 12.3 8.66669 12.1667C8.66669 12.0112 8.61669 11.8862 8.51669 11.7917C8.41669 11.6973 8.28891 11.6556 8.13335 11.6667C7.6778 11.7 7.19447 11.575 6.68335 11.2917C6.17224 11.0084 5.85002 10.4945 5.71669 9.75004C5.69446 9.62782 5.63613 9.52782 5.54169 9.45004C5.44724 9.37226 5.33891 9.33337 5.21669 9.33337C5.06113 9.33337 4.93335 9.39171 4.83335 9.50837C4.73335 9.62504 4.70002 9.76115 4.73335 9.91671C4.92224 10.9278 5.36669 11.65 6.06669 12.0834C6.76669 12.5167 7.47224 12.7112 8.18335 12.6667ZM8.00002 14.6667C6.4778 14.6667 5.20835 14.1445 4.19169 13.1C3.17502 12.0556 2.66669 10.7556 2.66669 9.20004C2.66669 8.08893 3.10835 6.8806 3.99169 5.57504C4.87502 4.26948 6.21113 2.8556 8.00002 1.33337C9.78891 2.8556 11.125 4.26948 12.0084 5.57504C12.8917 6.8806 13.3334 8.08893 13.3334 9.20004C13.3334 10.7556 12.825 12.0556 11.8084 13.1C10.7917 14.1445 9.52224 14.6667 8.00002 14.6667ZM8.00002 13.3334C9.15558 13.3334 10.1111 12.9417 10.8667 12.1584C11.6222 11.375 12 10.3889 12 9.20004C12 8.38893 11.6639 7.47226 10.9917 6.45004C10.3195 5.42782 9.32224 4.31115 8.00002 3.10004C6.6778 4.31115 5.68058 5.42782 5.00835 6.45004C4.33613 7.47226 4.00002 8.38893 4.00002 9.20004C4.00002 10.3889 4.3778 11.375 5.13335 12.1584C5.88891 12.9417 6.84446 13.3334 8.00002 13.3334Z";
const SUN = "M8.00002 9.99996C8.55558 9.99996 9.0278 9.80552 9.41669 9.41663C9.80558 9.02774 10 8.55552 10 7.99996C10 7.4444 9.80558 6.97218 9.41669 6.58329C9.0278 6.1944 8.55558 5.99996 8.00002 5.99996C7.44447 5.99996 6.97224 6.1944 6.58335 6.58329C6.19447 6.97218 6.00002 7.4444 6.00002 7.99996C6.00002 8.55552 6.19447 9.02774 6.58335 9.41663C6.97224 9.80552 7.44447 9.99996 8.00002 9.99996ZM8.00002 11.3333C7.0778 11.3333 6.29169 11.0083 5.64169 10.3583C4.99169 9.70829 4.66669 8.92218 4.66669 7.99996C4.66669 7.07774 4.99169 6.29163 5.64169 5.64163C6.29169 4.99163 7.0778 4.66663 8.00002 4.66663C8.92224 4.66663 9.70835 4.99163 10.3584 5.64163C11.0084 6.29163 11.3334 7.07774 11.3334 7.99996C11.3334 8.92218 11.0084 9.70829 10.3584 10.3583C9.70835 11.0083 8.92224 11.3333 8.00002 11.3333ZM3.33335 8.66663H0.666687V7.33329H3.33335V8.66663ZM15.3334 8.66663H12.6667V7.33329H15.3334V8.66663ZM7.33335 3.33329V0.666626H8.66669V3.33329H7.33335ZM7.33335 15.3333V12.6666H8.66669V15.3333H7.33335ZM4.26669 5.16663L2.58335 3.54996L3.53335 2.56663L5.13335 4.23329L4.26669 5.16663ZM12.4667 13.4333L10.85 11.75L11.7334 10.8333L13.4167 12.45L12.4667 13.4333ZM10.8334 4.26663L12.45 2.58329L13.4334 3.53329L11.7667 5.13329L10.8334 4.26663ZM2.56669 12.4666L4.25002 10.85L5.16669 11.7333L3.55002 13.4166L2.56669 12.4666Z";

export function AmsPanel({ ams, extL, extR, humidity, drying, onDry }: { ams: DetailSpool[]; extL: string | null; extR: string | null; humidity: number; drying: boolean; onDry: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const block = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (wrap.current && block.current) block.current.style.zoom = Math.max(0.8, Math.min(1.2, wrap.current.clientWidth / 245)).toFixed(3);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="w-full">
      <div ref={block} className="mx-auto flex w-[245px] max-w-full flex-col gap-2.5">
        <div className="flex items-center gap-3 rounded-xl bg-sc-high p-2.5 text-on-surface">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AmsIcon c={ams.map((a) => a.c)} />
            <ExtIcon c={extL} />
          </div>
          <i className="h-[23px] w-px flex-none bg-outline-variant" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ExtIcon c={extR} />
          </div>
        </div>
        <div className="grid grid-cols-[repeat(4,45.5px)] gap-4">
          {ams.map((x) => (
            <Slot key={x.s} x={x} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {["进料", "退料"].map((l) => (
            <button key={l} type="button" disabled className="h-10 w-[61px] rounded-lg border-0 bg-on-surface/10 font-cjk text-label-l font-medium text-on-surface/38">
              {l}
            </button>
          ))}
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-sc-high px-2 py-1.5 text-label-s font-medium text-on-variant" title={`烘干${drying ? "中" : "未开启"}`}>
            <svg viewBox="0 0 16 16" className="size-4 text-bed" aria-hidden="true">
              <path d={DROP} fill="currentColor" />
            </svg>
            {humidity}%
            <i className="h-3 w-px bg-outline-variant" />
            <button
              type="button"
              onClick={onDry}
              aria-haspopup="dialog"
              aria-label={drying ? "烘干中，查看或停止" : "烘干设置"}
              className={cx("state-layer -m-1 inline-flex rounded-full border-0 bg-transparent p-1", drying ? "text-drying" : "text-on-variant")}
            >
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                <path d={SUN} fill="currentColor" />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
