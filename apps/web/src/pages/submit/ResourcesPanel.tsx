import { BED_TYPE_LABEL, type ResourcesView, WAIT_BUCKET_LABEL } from "@platerelay/shared";
import { StatusChip } from "../../components/Chip";
import { Icon } from "../../components/icons/Icon";
import { Segmented } from "../../components/Segmented";
import { cx } from "../../lib/cx";

const LONG = new Set(["1h-2h", "2h-4h", "gt4h"]);

export function Swatch({ color, name, stock }: { color: string; name: string | null; stock?: boolean }) {
  return (
    <span title={stock ? "库存中，打印前换料" : "已装在打印机上"} className={cx("inline-flex h-6 items-center gap-1.5 rounded-lg pr-2 pl-1.5 text-body-s font-medium", stock ? "text-on-variant shadow-[inset_0_0_0_1px_var(--md-outline-variant)]" : "bg-sc text-on-surface")}>
      <i className={cx("size-3 rounded-full", stock ? "shadow-[0_0_0_1px_var(--md-outline-variant),0_0_0_3px_var(--md-sc-high),0_0_0_4px_var(--md-outline)]" : "shadow-[0_0_0_1px_var(--md-outline-variant)]")} style={{ background: color }} />
      {name ?? color.toUpperCase()}
    </span>
  );
}

const Item = ({ icon, title, sub, children, right, hit }: { icon: string; title: string; sub: string; children?: React.ReactNode; right?: React.ReactNode; hit?: boolean }) => (
  <li className={cx("grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[40px_minmax(0,1fr)_auto] [&+li]:border-t [&+li]:border-solid [&+li]:border-outline-variant", hit && "shadow-[inset_3px_0_0_var(--md-primary)]")}>
    <span className="grid size-10 place-items-center rounded-full bg-secondary-container text-on-secondary-container">
      <Icon name={icon} size={20} />
    </span>
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-label-l font-medium">
        {title}
        <small className="text-body-s font-normal text-on-variant">{sub}</small>
      </div>
      {children}
    </div>
    {right}
  </li>
);

/** 本场可用资源: collapsible, above step 1. `fit` replaces the summary once a file is parsed. */
export function ResourcesPanel({ view, fit, used, open, onOpen, tab, onTab }: { view: ResourcesView; fit?: React.ReactNode; used: Set<string>; open: boolean; onOpen: (v: boolean) => void; tab: "models" | "materials"; onTab: (t: "models" | "materials") => void }) {
  const total = view.models.reduce((a, m) => a + m.count, 0);
  const allIds = view.models.map((m) => m.modelId);
  const modelName = (id: string) => view.models.find((m) => m.modelId === id)?.model ?? id;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4">
      <h2 className="m-0 -mx-2 -mt-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="res-body"
          onClick={() => onOpen(!open)}
          className="state-layer relative flex w-full cursor-pointer appearance-none items-center gap-4 overflow-hidden rounded-xl border-0 bg-transparent p-2 text-left text-title-m font-semibold text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary-container text-on-secondary-container">
            <Icon name="inventory_2" size={20} />
          </span>
          <span className="flex min-w-0 flex-col">
            本场可用资源
            <small className="text-note font-normal text-on-variant [&_b]:font-medium [&_b]:text-on-surface">
              {fit ?? `${total} 台开放打印机 · ${view.models.length} 种机型 · ${view.materials.length} 种耗材 · 切片前先看这里`}
            </small>
          </span>
          <Icon name="expand_more" className={cx("ml-auto flex-none text-on-variant transition-transform duration-200 ease-standard motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </h2>
      {open && (
        <div id="res-body" className="flex flex-col gap-3">
          {view.bulletin && (
            <p className="m-0 flex items-start gap-3 rounded-xl bg-primary/10 px-4 py-2.5 text-note text-on-surface">
              <Icon name="campaign" size={20} className="text-primary" />
              <span>{view.bulletin}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="资源分类" value={tab} onChange={onTab} items={[{ key: "models", label: "机型", count: view.models.length }, { key: "materials", label: "耗材", count: view.materials.length }]} />
          </div>
          {tab === "models" ? (
            <ul className="m-0 list-none overflow-hidden rounded-xl bg-sc-high p-0">
              {view.models.map((m) => (
                <Item
                  key={m.modelId}
                  icon="print"
                  title={m.model}
                  sub={`${m.count} 台 · ${m.idle ? `${m.idle} 台空闲` : "全部在忙"}`}
                  hit={used.has(m.modelId)}
                  right={m.wait && (
                    <div className="col-start-2 text-body-s whitespace-nowrap text-on-variant sm:col-start-auto sm:text-right">
                      <b className={cx("mr-1.5 font-num text-[16px] leading-6 font-medium sm:mr-0 sm:block", LONG.has(m.wait) ? "text-warn" : "text-on-surface")}>{WAIT_BUCKET_LABEL[m.wait]}</b>
                      预计等待
                    </div>
                  )}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {!!m.nozzles.length && <StatusChip className="bg-sc text-on-surface">{m.nozzles.join(" / ")} mm {m.dual ? "双" : "单"}喷嘴</StatusChip>}
                    {m.bedTypes.map((b) => <StatusChip key={b} className="bg-sc text-on-surface">{BED_TYPE_LABEL[b] ?? b}</StatusChip>)}
                  </div>
                  {m.note && <div className="text-body-s text-on-variant">{m.note}</div>}
                </Item>
              ))}
            </ul>
          ) : (
            <>
              <ul className="m-0 list-none overflow-hidden rounded-xl bg-sc-high p-0">
                {view.materials.map((f) => {
                  const on = allIds.filter((id) => f.colors.some((c) => c.modelIds.includes(id)));
                  return (
                    <Item key={f.type} icon="palette" title={f.type} sub={on.length === allIds.length ? "全部机型" : on.length === 1 ? `仅 ${modelName(on[0])}` : on.map(modelName).join(" · ")}>
                      {!!f.colors.length && <div className="flex flex-wrap gap-1.5">{f.colors.map((c) => <Swatch key={c.color + c.stock} {...c} />)}</div>}
                      {f.note && <div className="text-body-s text-on-variant">{f.note}</div>}
                    </Item>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-body-s text-on-variant">
                <span className="inline-flex items-center gap-1.5"><Swatch color="var(--md-on-variant)" name="已装载" />打印机上已经装好</span>
                <span className="inline-flex items-center gap-1.5"><Swatch color="var(--md-on-variant)" name="库存" stock />库里有，打印前换料，可能多等一会</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
