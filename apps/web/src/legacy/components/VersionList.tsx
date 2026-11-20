import { LIVE } from "../lib/api";
import { cx } from "../lib/cx";
import { ordersApi } from "../lib/ordersApi";
import type { Version } from "../mock/myOrders";
import { Button, IconButton } from "./Button";
import { StatusChip } from "./Chip";
import { Thumb } from "./OrderBits";
import { useToast } from "./Toast";

/** Downloads one version's original file. */
export function useVersionDownload(orderId: number) {
  const toast = useToast();
  return async (v: Version) => {
    if (!LIVE) return toast(`原型：正式环境会下载第 ${v.n} 版原始文件 ${v.file}`);
    const r = await ordersApi.versionFileUrl(orderId, v.n);
    if (r.ok) window.location.assign(r.data.url);
    else toast(r.error.message || "下载链接生成失败");
  };
}

/**
 * 版本记录, newest first: every version keeps its file and preview. `selected`/`onSelect` let the
 * review page switch the preview; `onRestore` shows 恢复 on the versions it accepts.
 */
export function VersionList({
  orderId,
  vers,
  selected,
  onSelect,
  canRestore,
  onRestore,
  showModel = true,
}: {
  orderId: number;
  vers: Version[];
  selected?: number;
  onSelect?: (n: number) => void;
  canRestore?: (v: Version) => boolean;
  onRestore?: (v: Version) => void;
  showModel?: boolean;
}) {
  const download = useVersionDownload(orderId);
  return (
    <ul className="m-0 list-none overflow-hidden rounded-xl bg-sc-high p-0">
      {[...vers].reverse().map((v, i) => (
        <li
          key={v.n}
          aria-current={onSelect ? v.n === selected : undefined}
          tabIndex={onSelect ? 0 : undefined}
          role={onSelect ? "button" : undefined}
          aria-label={onSelect ? `查看第 ${v.n} 版` : undefined}
          onClick={onSelect ? () => onSelect(v.n) : undefined}
          onKeyDown={
            onSelect
              ? (e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelect(v.n);
                  }
                }
              : undefined
          }
          className={cx(
            "grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pr-2 pl-3",
            i > 0 && "border-t border-solid border-outline-variant",
            onSelect && "state-layer cursor-pointer",
            onSelect && v.n === selected && "bg-secondary-container/60",
          )}
        >
          <span className="block size-12 overflow-hidden rounded-lg bg-sc">
            <Thumb fil={v.fil} url={v.thumb} alt={`第 ${v.n} 版预览`} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-l font-medium">
              第 {v.n} 版<StatusChip tone={v.st === "审核中" || v.st === "待审核" ? "warn" : v.st === "未通过" ? "err" : "neutral"}>{v.st}</StatusChip>
            </div>
            <div className="truncate text-body-s tracking-normal text-on-variant">
              {v.file}
              {v.from ? ` · 恢复自第 ${v.from} 版` : ""}
            </div>
            <div className="truncate text-body-s tracking-normal text-on-variant">
              {showModel ? `${v.model} · ` : ""}
              {v.time} · {v.g} g · {v.at}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {onRestore && canRestore?.(v) && (
              <Button variant="text" onClick={(e) => (e.stopPropagation(), onRestore(v))}>
                恢复
              </Button>
            )}
            <IconButton icon="download" size={40} label={`下载第 ${v.n} 版`} onClick={(e) => (e.stopPropagation(), void download(v))} />
          </div>
        </li>
      ))}
    </ul>
  );
}
