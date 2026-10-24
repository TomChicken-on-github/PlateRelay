import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/icons/Icon";
import { PickupQR } from "../../components/PickupQR";
import { type Issued, pickupApi, showCode } from "../../lib/pickupApi";

type St = { k: "loading" } | { k: "ok"; v: Issued } | { k: "err"; s: string };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Pickup QR for one order. Every time the dialog opens it asks the server for a fresh 10-minute code,
 * which also voids the previous one, so an old screenshot handed to someone else no longer works.
 */
export function PickupCode({ orderId, open }: { orderId: number; open: boolean }) {
  const [st, setSt] = useState<St>({ k: "loading" });
  const [now, setNow] = useState(Date.now);

  const issue = async () => {
    setSt({ k: "loading" });
    const r = await pickupApi.issue(orderId);
    setNow(Date.now());
    setSt(
      r.ok
        ? { k: "ok", v: r.data }
        : { k: "err", s: r.error.code === "order-not-ready" ? "订单现在不能取件，请刷新页面看看状态。" : "取件码生成失败，请重试。" },
    );
  };

  useEffect(() => {
    if (open) issue();
    /* reissue only when the dialog opens */
  }, [open, orderId]);

  useEffect(() => {
    if (!open || st.k !== "ok") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, st.k]);

  const left = st.k === "ok" ? Date.parse(st.v.expiresAt) - now : 0;
  const expired = st.k === "ok" && left <= 0;

  return (
    <>
      <div className="relative self-center rounded-2xl bg-white p-3">
        {st.k === "ok" ? (
          <div className={expired ? "opacity-15" : undefined}>
            <PickupQR code={st.v.code} />
          </div>
        ) : (
          <div className="size-[200px]" />
        )}
        {(st.k !== "ok" || expired) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[#1d1b20]">
            {st.k === "loading" ? (
              <span className="text-note">正在生成取件码…</span>
            ) : (
              <>
                <Icon name={expired ? "timer_off" : "error"} size={32} />
                <span className="text-note">{expired ? "取件码已过期" : st.k === "err" && st.s}</span>
                <Button icon="refresh" onClick={issue}>
                  {expired ? "重新生成" : "重试"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <div className={`text-center font-num text-[28px] leading-9 font-semibold tracking-[3px] ${expired || st.k !== "ok" ? "text-on-surface/38" : ""}`}>
        {st.k === "ok" ? showCode(st.v.code) : "····-····"}
      </div>
      <div className="text-center text-note text-on-variant" aria-live="polite">
        {st.k === "ok" && !expired ? (
          <>
            <span className="font-num">{mmss(left)}</span> 后失效 · 重新打开会换新码，旧码作废
          </>
        ) : (
          "取件码 10 分钟内有效"
        )}
      </div>
    </>
  );
}
