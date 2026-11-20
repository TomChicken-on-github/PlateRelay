import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import { nozzleText } from "./plate-card";

/** "本场可用资源": a folded row; open, it lists the printer models and the filament catalogue. */
export function ResourcesRow({ resources }: { resources: Schemas["Resources"] | undefined }) {
  const [open, setOpen] = useState(false);
  if (!resources) return null;
  const catalog = resources.catalog.filter((r) => !r.hidden);
  return (
    <section className="flex flex-col rounded-2xl bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[52px] items-center gap-2 rounded-2xl px-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex-1 text-[15px] leading-[22px] font-semibold">本场可用资源</span>
        <span className="text-[13px] text-muted-foreground">
          {resources.printers.length} 种机型 · {catalog.length} 种耗材
        </span>
        <ChevronDown className={cn("size-[18px] text-faint transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="flex flex-col gap-4 px-4 pb-4">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {resources.printers.map((p) => (
                  <li key={p.modelId + nozzleText(p.nozzles)} className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px]">
                    <span className="truncate">
                      {p.modelName} · {nozzleText(p.nozzles)} 喷嘴
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.available} / {p.count} 台空闲
                    </span>
                  </li>
                ))}
              </ul>
              {catalog.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1.5 border-t p-0 pt-3">
                  {catalog.map((r) => (
                    <li key={r.id ?? r.autoKey ?? r.material + r.colour} className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
                      <i className="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: r.colour }} />
                      <span className="truncate">
                        {r.material}
                        {r.colourName && <span className="text-muted-foreground"> {r.colourName}</span>}
                      </span>
                      {!r.loaded && <span className="shrink-0 rounded-full bg-wait-surface px-2 text-[11px] leading-[18px] font-medium text-wait">需要换料</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
