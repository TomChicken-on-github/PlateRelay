import { Box } from "lucide-react";
import { useState } from "react";
import type { Schemas } from "@/lib/api";
import { duration } from "@/lib/format";

type Plate = Schemas["Plate"];
type Resources = Schemas["Resources"];
type CatalogRow = Schemas["CatalogRow"];

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/* `subType` is the slicer's filament preset id, so it is matched but not shown. */

/** The catalogue row a sliced filament is, by material, sub-type (when both name one) and colour. */
export function catalogRow(f: Schemas["SliceFilament"], catalog: CatalogRow[]): CatalogRow | undefined {
  return catalog.find((r) => !r.hidden && same(r.material, f.material) && (!r.subType || !f.subType || same(r.subType, f.subType)) && same(r.colour, f.colour));
}

export const nozzleText = (nozzles: Schemas["Nozzle"][]) => [...new Set(nozzles.map((n) => n.diameterMm))].join(" / ");

/** Why a plate cannot be submitted: no open printer of its model, or none with its nozzle. */
export function blockReason(p: Plate, res: Resources | undefined): string {
  const model = p.modelName ?? p.modelId;
  const of = res?.printers.filter((r) => r.modelId === p.modelId) ?? [];
  if (!of.length) return `本场没有开放的 ${model}`;
  return `本场 ${model} 没有 ${nozzleText(p.nozzles)} 喷嘴`;
}

/** One plate of the uploaded file: preview, time and weight, model and nozzle, the filaments it uses. */
export function PlateCard({ plate, resources }: { plate: Plate; resources: Resources | undefined }) {
  const catalog = resources?.catalog ?? [];
  const [broken, setBroken] = useState(false);
  const missing = plate.filaments.filter((f) => resources && !catalogRow(f, catalog));
  return (
    <article className="flex gap-3.5 rounded-2xl bg-card p-3.5 lg:gap-4 lg:p-4">
      <div className="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-xl bg-muted lg:size-[112px]">
        {plate.thumbnailUrl && !broken ? <img src={plate.thumbnailUrl} alt="" onError={() => setBroken(true)} className="size-full object-contain" /> : <Box className="size-7 text-faint" aria-hidden="true" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2.5 text-[15px] leading-[22px]">
            <b className="font-semibold">第 {plate.index} 盘</b>
            <span className="text-[13px] text-muted-foreground">
              {duration(plate.printSeconds)} · {Math.round(plate.weightGrams)} g
            </span>
          </span>
          <span className="truncate text-[13px] leading-[18px] text-subtle-foreground">
            {plate.modelName ?? plate.modelId} · {nozzleText(plate.nozzles)} 喷嘴
          </span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {plate.filaments.map((f) => {
            const row = catalogRow(f, catalog);
            return (
              <li key={f.slot} className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
                <i className="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: f.colour }} />
                <span className={row || !resources ? "truncate" : "truncate text-wait"}>
                  {f.material}
                  {row?.colourName && <span className="text-muted-foreground"> {row.colourName}</span>}
                </span>
                {row && !row.loaded && <span className="shrink-0 rounded-full bg-wait-surface px-2 text-[11px] leading-[18px] font-medium text-wait">需要换料</span>}
              </li>
            );
          })}
        </ul>
        {missing.length > 0 && plate.submittable && (
          <p className="m-0 text-xs leading-[18px] text-wait">本场耗材目录中没有 {[...new Set(missing.map((f) => f.material))].join("、")}</p>
        )}
        {!plate.submittable && <p className="m-0 rounded-lg bg-alert-surface px-2.5 py-1.5 text-xs leading-[18px] font-medium text-alert">{blockReason(plate, resources)}</p>}
      </div>
    </article>
  );
}
