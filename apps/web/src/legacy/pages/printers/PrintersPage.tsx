import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../../components/Button";
import { StatusChip } from "../../components/Chip";
import { Field, Select, TextInput } from "../../components/Field";
import { Icon } from "../../components/icons/Icon";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { LIVE } from "../../lib/api";
import { cx } from "../../lib/cx";
import { canEncrypt, type PrinterInput, printersApi, refreshDaemonKeys, sealAccessCode, useDaemonKeys, useFleet } from "../../lib/printersApi";
import type { AccessCodeState } from "@platerelay/shared";
import { FLEET_STATUS, FOUND, type FleetPrinter, OFFLINE_WHY, fleet } from "../../mock/fleet";

const ipOk = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((n) => +n <= 255);
const COLS = "grid-cols-[minmax(0,1.2fr)_88px_110px_minmax(0,1fr)_120px_minmax(0,1.3fr)_40px] max-md:grid-cols-[minmax(0,1fr)_auto_auto]";

/* id is the name typed in; pid the row being edited */
type Form = {
  isNew: boolean; orig?: string; pid?: string; id: string; model: string; ip: string; sn: string; code: string;
  /** Server builds: the daemon the printer is under, and the stored code's state (never the code). */
  daemon: string; was?: { daemon: string; sn: string; code: AccessCodeState | null; pub: boolean };
  /** 开放给选手 */
  pub: boolean;
};
const EMPTY: Form = { isNew: true, id: "", model: "", ip: "", sn: "", code: "", daemon: "", pub: false };
type Found = (typeof FOUND)[number];

/** Spinner used while the LAN scan runs. */
const Spin = () => <span className="spin size-[18px] flex-none rounded-full border-2 border-solid border-outline border-t-primary" />;

function FormSheet({ init, open, onClose }: { init: Form; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(init);
  const [picker, setPicker] = useState(false);
  const [scan, setScan] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const ipBad = !!f.ip && !ipOk(f.ip.trim());
  const [saving, setSaving] = useState(false);

  /*
   * Real builds: the code is encrypted here with the chosen daemon's public key and only the ciphertext
   * goes to the panel (brief §0.9 #10). It cannot be read back, so an edit shows 已配置 and takes a new one.
   */
  const keys = useDaemonKeys();
  const daemon = keys.rows.find((d) => d.id === f.daemon);
  const stored = f.was?.code ?? null;
  const moved = !!f.was && (f.was.daemon !== f.daemon || f.was.sn !== f.sn.trim());
  const codeOff = LIVE && (!daemon?.keyId || !canEncrypt());
  const codeHint = !LIVE
    ? undefined
    : !canEncrypt()
      ? "当前页面不是 HTTPS 或 localhost，浏览器不能加密访问码"
      : !f.daemon
        ? "先选择 daemon，访问码要用它的公钥加密"
        : !daemon?.keyId
          ? "这个 daemon 还没连上面板，连上后再来填访问码"
          : stored && moved
            ? "换了 daemon 或序列号，原来的访问码会失效，请重新输入"
            : stored && !stored.current
              ? "daemon 换了密钥，原来的访问码已失效，请重新输入"
              : "在浏览器里用 daemon 的公钥加密，面板只保存密文，看不到访问码";
  const codeBad = LIVE && !!f.code && !/^[\x21-\x7e]{1,64}$/.test(f.code) ? "访问码只能是字母、数字和符号" : undefined;
  const valid = f.id.trim() && ipOk(f.ip.trim()) && f.sn.trim() && !codeBad && (f.isNew && !LIVE ? f.code.trim() : true);
  const runScan = () => {
    setScan("busy");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setScan("done"), 1200);
  };
  const pick = (d: Found) => {
    setF((s) => ({ ...s, ip: d.ip, sn: d.sn, model: d.model, id: s.id.trim() ? s.id : d.name }));
    setPicker(false);
  };
  const save = async () => {
    if (LIVE) {
      const input: PrinterInput = { name: f.id.trim(), ip: f.ip.trim(), serial: f.sn.trim(), daemonId: f.daemon || null };
      setSaving(true);
      if (f.code.trim() && daemon) {
        const sealed = await sealAccessCode(daemon, input.serial!, f.code.trim());
        if (!sealed.ok) return setSaving(false), toast(sealed.error.message);
        input.accessCode = sealed.data;
      }
      const r = f.isNew ? await printersApi.create(input) : await printersApi.update(f.pid!, input);
      if (!r.ok) {
        setSaving(false);
        /* the daemon made a new key since the form opened: reload it so the next try uses it */
        if (r.error.code === "daemon-key-changed") void refreshDaemonKeys();
        return toast(r.error.message || "保存失败，请重试");
      }
      const pid = f.isNew ? r.data?.id : f.pid;
      if (pid && f.pub !== (f.was?.pub ?? false)) {
        const o = await printersApi.setOpen(pid, f.pub);
        if (!o.ok) toast(o.error.message || "开放给选手没有保存，请重试");
      }
      setSaving(false);
      const codeNote = input.accessCode ? "，访问码已加密保存" : stored && moved ? "，原访问码已失效" : "";
      toast(f.isNew ? `已添加 ${input.name}${codeNote}，型号和喷嘴等 daemon 连上后由打印机上报` : `${input.name} 已保存${codeNote}`);
      return onClose();
    }
    if (f.isNew) {
      fleet.set((s) => [...s, { id: f.id.trim(), model: f.model || "连接后读取", ip: f.ip.trim(), sn: f.sn.trim().slice(0, 6) + "••••••", nozzle: "连接后读取", st: "idle", job: "—", open: f.pub }]);
      toast(`已添加 ${f.id.trim()}`);
    } else {
      fleet.set((s) => s.map((p) => (p.id === f.orig ? { ...p, id: f.id.trim(), ip: f.ip.trim(), open: f.pub } : p)));
      toast(f.code.trim() ? `${f.id.trim()} 已保存，访问码已更新` : `${f.id.trim()} 已保存`);
    }
    onClose();
  };

  if (picker)
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="选择打印机"
        footer={
          <>
            <Button variant="text" onClick={() => setPicker(false)}>返回</Button>
            <Button variant="outlined" icon="wifi_find" disabled={scan === "busy"} onClick={runScan}>重新扫描</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {LIVE ? (
            <div className="text-note text-on-variant">局域网扫描由 daemon 在场地网络里完成，daemon 还没接上，请手动填写 IP 和序列号。</div>
          ) : scan === "busy" ? (
            <div className="flex items-center gap-3 text-note font-medium text-on-variant">
              <Spin />
              正在扫描局域网…
            </div>
          ) : (
            FOUND.map((d) => (
              <button
                key={d.sn}
                type="button"
                disabled={d.added}
                onClick={() => pick(d)}
                className="state-layer grid w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-3 overflow-hidden rounded-xl border-0 bg-sc px-3 py-2.5 text-left text-on-surface shadow-[inset_0_0_0_1px_var(--md-outline-variant)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="print" className="text-on-variant" />
                <span>
                  <b className="block text-label-l font-medium">
                    {d.name} · {d.model}
                    {d.added && "（已添加）"}
                  </b>
                  <small className="block font-num text-body-s text-on-variant">
                    {d.ip} · {d.sn}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      </Sheet>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={f.isNew ? "添加打印机" : `编辑 ${f.orig}`}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>{f.isNew ? "添加" : "保存"}</Button>
        </>
      }
    >
      <Field label="名称" required>
        {(id, cls) => <TextInput id={id} className={cls} placeholder="例如 X2D-03" value={f.id} onChange={set("id")} />}
      </Field>
      <Field label="IP 地址" required error={ipBad ? "请输入正确的 IP 地址" : undefined}>
        {(id, cls) => (
          <div className="relative">
            <TextInput id={id} className={cx(cls, f.isNew && "pr-[52px]")} placeholder="192.168.0.1" inputMode="decimal" value={f.ip} onChange={set("ip")} />
            {f.isNew && (
              <IconButton
                icon="wifi_find"
                label="扫描局域网"
                size={40}
                className="absolute top-1 right-1 text-primary"
                onClick={() => {
                  setPicker(true);
                  runScan();
                }}
              />
            )}
          </div>
        )}
      </Field>
      <Field label="序列号" required>
        {(id, cls) => <TextInput id={id} className={cls} placeholder="打印机背面或设置里查看" value={f.sn} onChange={set("sn")} />}
      </Field>
      {LIVE && (
        <Field label="daemon" hint={keys.error ?? (keys.rows.length ? "场地里负责连这台打印机的电脑" : keys.loading ? undefined : "还没有 daemon，先到 系统设置 › daemon 生成连接令牌")}>
          {(id, cls) => (
            <select id={id} className={cls} value={f.daemon} onChange={set("daemon")}>
              <option value="">暂不指定</option>
              {keys.rows.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.network ? ` · ${d.network}` : ""}
                  {d.keyId ? "" : "（尚未连接）"}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="访问码" required={f.isNew && !LIVE} error={codeBad} hint={codeHint}>
        {(id, cls) => (
          <TextInput
            id={id}
            className={cls}
            type="password"
            autoComplete="new-password"
            disabled={codeOff}
            placeholder={stored && !moved && stored.current ? "已配置，输入新的访问码即可替换" : f.isNew || LIVE ? "局域网模式下的访问码" : "已保存，输入新的访问码即可替换"}
            value={codeOff ? "" : f.code}
            onChange={set("code")}
          />
        )}
      </Field>
      <div className="flex items-center gap-4 rounded-xl bg-sc-high px-4 py-3">
        <span className="min-w-0 flex-1">
          <b className="block text-label-l font-medium">开放给选手</b>
          <small className="block text-body-s text-on-variant">{f.pub ? "选手的订单可以派到这台，它也计入提交页的「本场可用资源」" : "只用于内部打印，不派选手的订单，也不出现在「本场可用资源」里"}</small>
        </span>
        <Switch checked={f.pub} label="开放给选手" onChange={(v) => setF((s) => ({ ...s, pub: v }))} />
      </div>
    </Sheet>
  );
}

function OfflineSheet({ p, open, onClose }: { p: FleetPrinter; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [why, setWhy] = useState("");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`下线 ${p.name ?? p.id}`}
      sub={`${p.st === "printing" ? "这台正在打印：下线会在当前任务结束后生效。" : "下线后调度器不会再给它派单。"}会记入审计日志。`}
      footer={
        <>
          <Button variant="text" onClick={onClose}>返回</Button>
          <Button
            disabled={!why}
            onClick={async () => {
              const r = await printersApi.maintenance(p.id, true, why);
              if (!r.ok) return toast(r.error.message || "下线失败，请重试");
              toast(`${p.name ?? p.id} 已下线：${why}`);
              onClose();
            }}
          >
            确认下线
          </Button>
        </>
      }
    >
      <Field label="下线原因" required>
        {(id, cls) => <Select id={id} className={cls} options={OFFLINE_WHY} placeholder="请选择" value={why} onChange={(e) => setWhy(e.target.value)} />}
      </Field>
    </Sheet>
  );
}

type SheetType = "form" | "menu" | "off" | "on";

export function PrintersPage() {
  const toast = useToast();
  const { rows: list0, loading, error } = useFleet();
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<SheetType | null>(null);
  const [target, setTarget] = useState<string>("");
  const [form, setForm] = useState<Form>(EMPTY);
  const [key, setKey] = useState(0);

  const open = (type: SheetType, id = target) => {
    setTarget(id);
    setSheet(type);
    setKey((k) => k + 1);
  };
  const close = () => setSheet(null);
  const edit = (p: FleetPrinter) => {
    const sn = p.sn === "—" ? "" : p.sn.replace(/•/g, "");
    const daemon = p.daemonId ?? "";
    setForm({ isNew: false, orig: p.name ?? p.id, pid: p.id, id: p.name ?? p.id, model: p.model, ip: p.ip === "—" ? "" : p.ip, sn, code: "", daemon, pub: !!p.open, was: { daemon, sn, code: p.code ?? null, pub: !!p.open } });
    open("form", p.id);
  };
  const add = () => {
    setForm(EMPTY);
    open("form", "");
  };

  const query = q.trim().toLowerCase();
  const list = list0.filter((p) => !query || `${p.name ?? p.id} ${p.model} ${p.ip}`.toLowerCase().includes(query));
  const p = list0.find((x) => x.id === target);

  return (
    <Page>
      <PageHeader title="打印机管理" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative max-w-[420px] flex-[1_1_280px] max-sm:max-w-none">
          <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-on-variant" />
          <input
            type="search"
            placeholder="搜索名称、型号、IP"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="box-border h-12 w-full rounded-[28px] border-0 bg-sc-high pr-4 pl-11 text-[16px] leading-6 text-on-surface outline-0 focus:outline-2 focus:outline-primary"
          />
        </label>
        <Button icon="add" className="ml-auto max-sm:ml-0" onClick={add}>添加打印机</Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-sc">
        {list.length ? (
          <>
            <div className={cx("grid min-h-11 items-center gap-3 bg-sc-high py-0 pr-2 pl-4 text-body-s font-medium tracking-[0.5px] text-on-variant max-md:hidden", COLS)}>
              <span>打印机</span>
              <span>型号</span>
              <span>状态</span>
              <span>IP 地址</span>
              <span>喷嘴（机台上报）</span>
              <span>当前任务</span>
              <span />
            </div>
            {list.map((x) => {
              const [label, tone] = FLEET_STATUS[x.st];
              return (
                <div
                  key={x.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${x.name ?? x.id}，${label}`}
                  onClick={() => edit(x)}
                  onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), edit(x))}
                  className={cx(
                    "grid min-h-16 cursor-pointer items-center gap-3 border-t border-solid border-outline-variant py-0 pr-2 pl-4 hover:bg-[color-mix(in_srgb,var(--md-on-surface)_4%,var(--md-sc))] max-md:gap-x-2 max-md:gap-y-1 max-md:py-3",
                    COLS,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2 font-num text-label-l font-semibold max-md:col-start-1">
                    {x.name ?? x.id}
                    {!x.open && <StatusChip className="bg-transparent font-sans shadow-[inset_0_0_0_1px_var(--md-outline-variant)]">仅内部</StatusChip>}
                  </span>
                  <span className="text-body-s text-on-variant max-md:hidden">{x.model}</span>
                  <span className="max-md:col-start-2 max-md:row-start-1">
                    <StatusChip tone={tone}>{label}</StatusChip>
                  </span>
                  <span className="font-num text-note max-md:hidden">{x.ip}</span>
                  <span className="text-body-s text-on-variant max-md:hidden">{/左/.test(x.nozzle) || x.nozzle === "连接后读取" || x.nozzle === "待上报" ? x.nozzle : `${x.nozzle} mm`}</span>
                  <span className="text-body-s text-on-variant max-md:col-span-2 max-md:col-start-1">{x.job}</span>
                  <IconButton
                    icon="more_vert"
                    label={`${x.name ?? x.id} 更多操作`}
                    size={40}
                    className="max-md:col-start-3 max-md:row-span-2 max-md:row-start-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      open("menu", x.id);
                    }}
                  />
                </div>
              );
            })}
          </>
        ) : (
          <div className="px-4 py-14 text-center text-on-variant">{error ? `加载失败：${error}` : loading ? "正在加载…" : list0.length ? "没有符合条件的打印机" : "还没有打印机，点右上角添加"}</div>
        )}
      </div>

      <FormSheet key={`f${key}`} init={form} open={sheet === "form"} onClose={close} />
      {p && (
        <>
          <Sheet open={sheet === "menu"} onClose={close} title={p.name ?? p.id} footer={<Button variant="text" onClick={close}>关闭</Button>}>
            <div className="flex flex-col gap-2">
              <Button variant="outlined" icon="edit" onClick={() => edit(p)}>编辑信息</Button>
              {p.st === "maint" ? (
                <Button icon="play_circle" onClick={() => open("on", p.id)}>上线</Button>
              ) : (
                <Button variant="outlined" icon="pause_circle" onClick={() => open("off", p.id)}>下线维护</Button>
              )}
            </div>
          </Sheet>
          <OfflineSheet key={`o${key}`} p={p} open={sheet === "off"} onClose={close} />
          <Sheet
            open={sheet === "on"}
            onClose={close}
            title={`上线 ${p.name ?? p.id}`}
            sub="上线后调度器会重新给它派单。请确认维护已经完成，喷嘴和耗材已就位。"
            footer={
              <>
                <Button variant="text" onClick={close}>返回</Button>
                <Button
                  onClick={async () => {
                    const r = await printersApi.maintenance(p.id, false);
                    if (!r.ok) return toast(r.error.message || "上线失败，请重试");
                    toast(`${p.name ?? p.id} 已上线`);
                    close();
                  }}
                >
                  确认上线
                </Button>
              </>
            }
          />
        </>
      )}
    </Page>
  );
}
