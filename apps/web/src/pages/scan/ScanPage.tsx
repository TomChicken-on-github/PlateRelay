import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { FigmaIcon } from "../../components/icons/FigmaIcon";
import { Icon } from "../../components/icons/Icon";
import { ModelThumb } from "../../components/ModelThumb";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { t } from "../../lib/motion";
import { type Code, SIM_CODES, codes, redeemed } from "../../mock/pickup";

type OkCode = Extract<Code, { st: "ok" }> & { code: string };
type Result = { k: "bad"; t: string; s: string } | ({ k: "ok" } & OkCode) | ({ k: "done" } & OkCode) | null;

/* Pickup codes are XXXX-XX: letters and digits only, dash inserted after four. */
const norm = (s: string) => {
  const v = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v;
};

function Section({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4 ${className ?? ""}`}>
      <h2 className="m-0 text-[16px] leading-6 font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Viewfinder() {
  const corner = "absolute size-9 border-4 border-solid border-[#d0bcff]";
  return (
    <div
      aria-label="摄像头取景框（原型）"
      className="relative grid aspect-square place-items-center overflow-hidden rounded-xl text-[#e6e0e9] max-lg:mx-auto max-lg:w-[min(100%,400px)]"
      style={{ background: "radial-gradient(120% 90% at 50% 120%, #3a3640, #17151b)" }}
    >
      <i className={`${corner} top-[16%] left-[16%] rounded-tl-[14px] border-r-0 border-b-0`} />
      <i className={`${corner} top-[16%] right-[16%] rounded-tr-[14px] border-b-0 border-l-0`} />
      <i className={`${corner} bottom-[16%] left-[16%] rounded-bl-[14px] border-t-0 border-r-0`} />
      <i className={`${corner} right-[16%] bottom-[16%] rounded-br-[14px] border-t-0 border-l-0`} />
      <i className="scan-line absolute right-[18%] left-[18%] h-0.5 bg-[#d0bcff] shadow-[0_0_12px_#d0bcff]" />
      <p className="absolute bottom-[4%] m-0 text-note opacity-85">把用户的取件码对准框内</p>
    </div>
  );
}

export function ScanPage() {
  const all = codes.use();
  const recs = redeemed.use();
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Result>(null);
  const [ask, setAsk] = useState(false);
  const sim = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const lookup = (c: string) => {
    const x = all[c];
    setRes(
      !x
        ? { k: "bad", t: "取件码无效", s: "没有找到这个取件码，请让对方在「我的订单」里重新出示。" }
        : x.st === "used"
          ? { k: "bad", t: "这个取件码已核销", s: `#${x.id} 已于 ${x.at} 由 ${x.by} 核销给 ${x.owner}。` }
          : x.st === "notready"
            ? { k: "bad", t: "订单还不能取件", s: `#${x.id} ${x.label}，入库后才会生成可用的取件码。` }
            : { k: "ok", code: c, ...x },
    );
  };
  const reset = () => {
    setRes(null);
    setCode("");
    input.current?.focus();
  };
  const confirm = () => {
    if (res?.k !== "ok") return;
    codes.set((s) => ({ ...s, [res.code]: { st: "used", id: res.id, owner: res.owner, by: "Staff 陈一帆", at: "刚刚" } }));
    redeemed.set((s) => [{ id: res.id, file: res.file.replace(".gcode.3mf", ""), owner: res.owner, at: "刚刚" }, ...s]);
    setRes({ ...res, k: "done" });
    setAsk(false);
  };

  let body: ReactNode;
  if (!res)
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-8 text-center text-on-variant">
        <FigmaIcon name="scanLine" className="size-10 opacity-60" />
        <div>扫描或输入取件码后，这里显示订单信息</div>
      </div>
    );
  else if (res.k === "bad")
    body = (
      <>
        <div className="flex items-start gap-3 rounded-xl bg-err-bg p-3.5">
          <Icon name="cancel" className="text-err" />
          <div>
            <b className="block text-label-l font-medium">{res.t}</b>
            <span className="text-note text-on-variant">{res.s}</span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="outlined" onClick={reset}>继续扫码</Button>
        </div>
      </>
    );
  else if (res.k === "done")
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-6 text-center text-ok">
        <Icon name="check_circle" size={48} />
        <b className="text-[18px] leading-6 font-medium">已核销 · #{res.id}</b>
        <span className="text-note text-on-variant">
          {res.owner} 已取走 {res.file}（{res.slot}）
        </span>
        <Button className="mt-3" onClick={reset}>继续扫码</Button>
      </div>
    );
  else
    body = (
      <>
        <div className="flex items-center gap-3 rounded-xl bg-sc-high px-3.5 py-3">
          <Avatar name={res.owner} size={44} />
          <div>
            <b className="block text-[15px] leading-5 font-medium">{res.owner}</b>
            <small className="text-body-s text-on-variant">{res.role}</small>
          </div>
          <small className="ml-auto text-right text-body-s text-on-variant">请核对取件人</small>
        </div>
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3.5">
          <div className="size-16 overflow-hidden rounded-[10px] bg-sc-high">
            <ModelThumb c1={res.fil[0][0]} slot={false} />
          </div>
          <div className="min-w-0">
            <b className="block truncate text-label-l font-medium">{res.file}</b>
            <span className="text-body-s text-on-variant">
              #{res.id} · 第 {res.n} 盘 · {res.model} · {res.g} g
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ok-bg px-4 py-3.5 text-ok">
          <div>
            <small className="block text-body-s opacity-85">暂存位置 · 入库 {res.when}</small>
            <b className="font-num text-[22px] leading-7 font-semibold">{res.slot}</b>
          </div>
          <Icon name="inventory_2" />
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">
          <Button variant="outlined" onClick={reset}>取消</Button>
          <Button icon="check" onClick={() => setAsk(true)}>核销</Button>
        </div>
      </>
    );

  return (
    <Page>
      <PageHeader title="扫码核销" />
      <div className="grid grid-cols-[minmax(0,440px)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <Section title="扫描取件码">
          <Viewfinder />
          <div className="flex items-center gap-3 text-body-s text-on-variant before:h-px before:flex-1 before:bg-outline-variant after:h-px after:flex-1 after:bg-outline-variant">或手动输入</div>
          <form
            className="flex items-center gap-2"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (code) lookup(code);
            }}
          >
            <input
              ref={input}
              inputMode="text"
              maxLength={7}
              placeholder="如 7K3Q-92"
              aria-label="取件码"
              value={code}
              onChange={(e) => setCode(norm(e.target.value))}
              className="h-12 min-w-0 flex-1 rounded-t-lg border-0 bg-sc-high px-4 font-num text-[20px] leading-7 font-semibold tracking-[3px] text-on-surface uppercase shadow-[inset_0_-1px_0_var(--md-outline)] outline-0 placeholder:font-normal placeholder:tracking-normal focus:shadow-[inset_0_-2px_0_var(--md-primary)]"
            />
            <Button type="submit">查询</Button>
          </form>
          <Button
            variant="text"
            className="self-start"
            onClick={() => {
              const c = SIM_CODES[sim.current++ % SIM_CODES.length];
              setCode(c);
              lookup(c);
            }}
          >
            原型：模拟扫一个码
          </Button>
        </Section>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="订单信息" className="min-h-[220px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={res ? `${res.k}-${"id" in res ? res.id : res.t}` : "idle"}
                className="flex flex-1 flex-col gap-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: t("medium2", "emphasizedDecelerate") }}
                exit={{ opacity: 0, transition: t("short2", "emphasizedAccelerate") }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          </Section>
          <Section title={`今日核销 · ${recs.length}`}>
            {recs.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {recs.map((r, i) => (
                  <li key={`${r.id}-${i}`} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-t border-solid border-outline-variant py-2.5 first:border-t-0">
                    <Avatar name={r.owner} size={36} />
                    <div className="min-w-0">
                      <b className="block text-label-l font-medium">
                        {r.file} · #{r.id}
                      </b>
                      <small className="text-body-s text-on-variant">{r.owner}</small>
                    </div>
                    <time className="font-num text-body-s text-on-variant">{r.at}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-8 text-center text-on-variant">今天还没有核销记录</div>
            )}
          </Section>
        </div>
      </div>

      <Sheet
        open={ask && res?.k === "ok"}
        onClose={() => setAsk(false)}
        icon="task_alt"
        title={res && "id" in res ? `确认核销 #${res.id}？` : "确认核销"}
        footer={
          <>
            <Button variant="text" onClick={() => setAsk(false)}>返回</Button>
            <Button variant="text" onClick={confirm}>确认核销</Button>
          </>
        }
      >
        {res && res.k !== "bad" && (
          <div className="text-label-l font-normal text-on-variant">
            请确认 <b className="font-medium text-on-surface">{res.owner}</b> 本人在场，并取走 {res.file}（{res.slot}）。核销后不能撤销。
          </div>
        )}
      </Sheet>
    </Page>
  );
}
