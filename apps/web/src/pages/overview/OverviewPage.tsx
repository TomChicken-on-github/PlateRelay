import { LayoutGroup } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { SelectChip } from "../../components/Chip";
import { FigmaIcon, type FigmaIconName } from "../../components/icons/FigmaIcon";
import { Page, PageHeader } from "../../components/Page";
import { cx } from "../../lib/cx";
import { PRINTERS, starStore, type PrinterState } from "../../mock/printers";
import { PrinterCard } from "./PrinterCard";

/* Masonry like the Figma board: round-robin into N columns. Cards stay between CARD_MIN and CARD_MAX;
   past that the page narrows and centres. The media row keeps Figma's 424px proportions and is zoomed. */
const CARD_MIN = 448, CARD_MAX = 540, GAP = 16, FIG_MEDIA = 424;
const ATTN: PrinterState[] = ["ERROR_PAUSED", "UNMANAGED_PRINTING", "CLEARING_REQUIRED"];

function useMasonry() {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ cols: 1, cardW: CARD_MAX, maxW: undefined as number | undefined });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const pad = window.innerWidth <= 640 ? 32 : 56;
      const avail = el.clientWidth - pad;
      const n = Math.max(1, Math.floor((avail + GAP) / (CARD_MIN + GAP)));
      const cardW = Math.min(CARD_MAX, (avail - GAP * (n - 1)) / n);
      setM({ cols: n, cardW, maxW: cardW < CARD_MAX ? undefined : n * CARD_MAX + GAP * (n - 1) + pad });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...m };
}

function Stat({ label, icon, warn, value, unit, sub, trend }: { label: string; icon: FigmaIconName; warn?: boolean; value: number; unit: string; sub: string; trend: string }) {
  return (
    <div className="flex min-h-[166px] flex-col gap-2.5 rounded-xl bg-sc p-5 max-sm:min-h-0 max-sm:gap-1.5 max-sm:p-3">
      <div className="flex h-5 items-center justify-between text-label-l font-medium text-on-variant max-sm:h-auto max-sm:text-body-s">
        {label}
        <FigmaIcon name={icon} className={cx("size-5 max-sm:hidden", warn ? "text-warn" : "text-primary")} />
      </div>
      <div className="flex items-baseline gap-2 font-num text-display font-normal tracking-normal text-on-surface tnum max-sm:gap-1 max-sm:text-[28px] max-sm:leading-[34px]">
        {value}
        <small className="font-sans text-body-m text-on-variant max-sm:text-body-s">{unit}</small>
      </div>
      <div className={cx("text-body-s", warn ? "text-warn" : "text-on-variant max-sm:hidden")}>{sub}</div>
      <div className="text-body-s text-on-variant max-sm:hidden">{trend}</div>
    </div>
  );
}

export function OverviewPage() {
  const [filter, setFilter] = useState<"star" | "all" | "attn">("all");
  const stars = starStore.use();
  const { ref, cols, cardW, maxW } = useMasonry();

  const n = (s: PrinterState) => PRINTERS.filter((p) => p.state === s).length;
  const starred = PRINTERS.filter((p) => stars[p.id]);
  const attn = PRINTERS.filter((p) => ATTN.includes(p.state));
  const list = filter === "star" ? starred : filter === "attn" ? attn : PRINTERS;
  const used = Math.max(1, Math.min(list.length, cols));
  const columns = Array.from({ length: used }, (_, c) => list.filter((_, i) => i % used === c));
  const zoom = Math.min(CARD_MAX - 40, cardW - 40) / FIG_MEDIA;

  return (
    <div ref={ref}>
      <Page style={{ maxWidth: maxW }}>
        <PageHeader title="概况" keepAccount />
        <section className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3 max-sm:grid-cols-3 max-sm:gap-2">
          <Stat label="排队 / 等待中" icon="queue" value={7} unit="项" sub="含 4 项待审核 · 1 项等待兼容打印机" trend="↓ 较 1 小时前 -2" />
          <Stat
            label="正在打印设备"
            icon="printer"
            value={n("PRINTING")}
            unit={`/ ${PRINTERS.length} 台`}
            sub={`当前利用率 ${Math.round((n("PRINTING") / PRINTERS.length) * 100)}% · ${n("PREPARING")} 台预热`}
            trend="↑ 较 1 小时前 +1 台"
          />
          <Stat label="待清台机器" icon="scanLine" warn value={n("CLEARING_REQUIRED")} unit="台" sub="未入库确认前禁止派单" trend="↑ 较 1 小时前 +1 台" />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="m-0 text-title-m font-semibold">设备状态</h2>
              <p className="m-0 text-body-s text-on-variant">
                {PRINTERS.length} 台设备 · {n("PRINTING")} 打印中 / {n("PREPARING")} 预热 / {n("CLEARING_REQUIRED")} 待清台 / {n("UNMANAGED_PRINTING")} 外部任务 / {n("IDLE")} 空闲 / {n("ERROR_PAUSED")} 故障 / {n("OFFLINE")} 离线 / {n("MAINTENANCE")} 维护
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SelectChip selected={filter === "star"} onClick={() => setFilter("star")}>
                星标设备 {starred.length}
              </SelectChip>
              <SelectChip selected={filter === "all"} onClick={() => setFilter("all")}>
                全部 {PRINTERS.length}
              </SelectChip>
              <SelectChip selected={filter === "attn"} onClick={() => setFilter("attn")}>
                需处理 {attn.length}
              </SelectChip>
            </div>
          </div>
          <LayoutGroup>
            <div className="flex items-start gap-4">
              {columns.map((col, i) => (
                <div key={i} className="flex min-w-0 max-w-[540px] flex-1 flex-col gap-4">
                  {col.map((p) => (
                    <PrinterCard key={p.id} p={p} zoom={zoom} />
                  ))}
                </div>
              ))}
            </div>
          </LayoutGroup>
        </section>
      </Page>
    </div>
  );
}
