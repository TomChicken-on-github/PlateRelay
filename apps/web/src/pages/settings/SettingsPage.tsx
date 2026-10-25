import { type ReactNode, useEffect, useRef, useState } from "react";
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS, type AuditListQuery, type AuditLogView } from "@platerelay/shared";
import { Navigate, useNavigate, useParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Button, IconButton } from "../../components/Button";
import { FilterTabs, StatusChip } from "../../components/Chip";
import { Field, Select, TextInput } from "../../components/Field";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { Empty, StatusBlock } from "../../components/OrderBits";
import { Icon } from "../../components/icons/Icon";
import { LIVE } from "../../lib/api";
import { auditApi } from "../../lib/auditApi";
import { AUDIT_ACTIONS, AUDIT_TARGETS, auditAction, auditActor, auditChanges, auditNote, auditReason, auditRole, auditTarget } from "../../lib/auditPresentation";
import { canOpen, useMe } from "../../lib/session";
import { cx } from "../../lib/cx";
import { FIELD_TYPES, ROLES, genToken, settings } from "../../mock/settings";

const TABS = [
  ["form", "申请表单"],
  ["users", "用户与角色"],
  ["policy", "文件与排队"],
  ["notify", "通知"],
  ["daemon", "守护进程"],
  ["audit", "审计日志"],
] as const;
type TabKey = (typeof TABS)[number][0];

/* Settings mutations remain prototype-only, including their local audit entries. */
const ACTOR = { id: "00000000-0000-4000-8000-000000000001", name: "Tom_Chicken", role: "Builder" };
const log = (action: string, obj: string) => settings.set((s) => ({
  ...s,
  audit: [{
    id: Math.max(0, ...s.audit.map((row) => row.id)) + 1, at: new Date().toISOString(),
    actorType: "user", actorId: ACTOR.id, actor: ACTOR, action, targetType: "setting", targetId: null,
    target: { name: "系统设置" }, before: null, after: { description: obj }, reason: null, result: "ok", ip: null, device: null,
  }, ...s.audit],
}));

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[840px] min-w-0 flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4">
      <h2 className="m-0 text-title-m font-medium">{title}</h2>
      {hint && <div className="-mt-2 text-body-m text-on-variant">{hint}</div>}
      {children}
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-solid border-outline-variant py-2 first:border-t-0", className)}>{children}</div>;
}
const RowText = ({ title, sub }: { title: ReactNode; sub?: ReactNode }) => (
  <div className="min-w-0">
    <b className="block text-label-l font-medium">{title}</b>
    {sub && <small className="block text-body-s text-on-variant">{sub}</small>}
  </div>
);
const Tag = ({ children }: { children: ReactNode }) => <span className="inline-flex h-6 items-center rounded-lg bg-sc-high px-2 text-body-s font-medium text-on-variant">{children}</span>;
const Actions = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap justify-end gap-2 max-sm:[&>button]:flex-1">{children}</div>;

/* ---------- 申请表单 ---------- */

function FormTab() {
  const toast = useToast();
  const { fields } = settings.use();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [name, setName] = useState("");
  const [type, setType] = useState(FIELD_TYPES[0]);
  return (
    <Section title="申请表单" hint="选手提交订单时要填的信息。审核页会显示这些答案。">
      <div>
        {fields.map((f) => (
          <Row key={f.id}>
            <RowText title={f.name} sub={f.type} />
            <div className="flex items-center gap-2">
              <Tag>{f.req ? "必填" : "选填"}</Tag>
              <Switch checked={f.req} label={`${f.name} 必填`} onChange={(v) => settings.set((s) => ({ ...s, fields: s.fields.map((x) => (x.id === f.id ? { ...x, req: v } : x)) }))} />
              <IconButton
                icon="delete"
                label={`删除 ${f.name}`}
                size={40}
                onClick={() => {
                  settings.set((s) => ({ ...s, fields: s.fields.filter((x) => x.id !== f.id) }));
                  toast("已删除字段");
                }}
              />
            </div>
          </Row>
        ))}
      </div>
      <Actions>
        <Button
          variant="outlined"
          icon="add"
          onClick={() => {
            setName("");
            setType(FIELD_TYPES[0]);
            setKey((k) => k + 1);
            setOpen(true);
          }}
        >
          添加字段
        </Button>
      </Actions>
      <Sheet
        key={key}
        open={open}
        onClose={() => setOpen(false)}
        title="添加字段"
        footer={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>取消</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                settings.set((s) => ({ ...s, fields: [...s.fields, { id: Date.now(), name: name.trim(), type, req: false }] }));
                setOpen(false);
                toast("已添加字段");
              }}
            >
              添加
            </Button>
          </>
        }
      >
        <Field label="字段名称" required>
          {(id, cls) => <TextInput id={id} className={cls} placeholder="例如 指导老师" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="类型" required>
          {(id, cls) => <Select id={id} className={cls} options={FIELD_TYPES} value={type} onChange={(e) => setType(e.target.value)} />}
        </Field>
      </Sheet>
    </Section>
  );
}

/* ---------- 用户与角色 ---------- */

const ROW_SELECT = "h-10 min-w-[120px] rounded-lg border-0 bg-transparent px-3 text-label-l text-on-surface outline-0 shadow-[inset_0_0_0_1px_var(--md-outline)] focus:shadow-[inset_0_0_0_2px_var(--md-primary)]";

function UsersTab() {
  const toast = useToast();
  const { users } = settings.use();
  return (
    <Section title="用户与角色" hint="账号来自登录系统，这里只分配角色。改角色会记入审计日志。">
      <div>
        {users.map((u, i) => (
          <Row key={u.n}>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={u.n} size={40} />
              <RowText title={u.n} sub={u.role} />
            </div>
            <select
              aria-label={`${u.n} 的角色`}
              className={ROW_SELECT}
              value={u.role}
              onChange={(e) => {
                const role = e.target.value;
                log("修改角色", `${u.n} ${u.role} → ${role}`);
                settings.set((s) => ({ ...s, users: s.users.map((x, j) => (j === i ? { ...x, role } : x)) }));
                toast(`${u.n} 已改为 ${role}`);
              }}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Row>
        ))}
      </div>
    </Section>
  );
}

/* ---------- 文件与排队 ---------- */

function PolicyTab() {
  const toast = useToast();
  const { policy } = settings.use();
  const [size, setSize] = useState(policy.size);
  const ok = +size > 0 && +size <= 2000;
  return (
    <Section title="文件与排队">
      <Field label="文件大小上限" error={ok ? undefined : "请输入 1 到 2000 之间的数字"}>
        {(id, cls) => (
          <div className="relative">
            <TextInput id={id} className={cx(cls, "pr-14")} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, ""))} />
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-label-l text-on-variant">MB</span>
          </div>
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-note font-medium tracking-[0.1px] text-on-variant">允许的文件类型</span>
        <div>
          <Tag>.gcode.3mf</Tag>
        </div>
      </div>
      <Field label="排队规则" hint="人工调整顺序只对管理员可见，选手看不到">
        {(id, cls) => <Select id={id} className={cls} options={[policy.rule]} value={policy.rule} onChange={() => {}} />}
      </Field>
      <Actions>
        <Button
          disabled={size === policy.size || !ok}
          onClick={() => {
            settings.set((s) => ({ ...s, policy: { ...s.policy, size } }));
            log("修改策略", `文件上限 ${size} MB`);
            toast("策略已保存");
          }}
        >
          保存
        </Button>
      </Actions>
    </Section>
  );
}

/* ---------- 通知 ---------- */

function NotifyTab() {
  const toast = useToast();
  const { notify } = settings.use();
  const [n, setN] = useState(notify);
  const dirty = JSON.stringify(n) !== JSON.stringify(notify);
  return (
    <Section title="通知" hint="可取件、审核驳回、打印失败等事件会通过这些渠道发给选手。">
      <div>
        <Row>
          <RowText title="邮箱" sub="发到选手账号绑定的邮箱" />
          <Switch checked={n.mail} label="邮箱通知" onChange={(v) => setN({ ...n, mail: v })} />
        </Row>
        <Row>
          <RowText title="飞书机器人" sub="推送到选手的飞书" />
          <Switch checked={n.fs} label="飞书机器人通知" onChange={(v) => setN({ ...n, fs: v })} />
        </Row>
      </div>
      {n.fs && (
        <>
          <Field label="发送方式">
            {(id, cls) => <Select id={id} className={cls} options={["直接调用飞书机器人", "经 passport 后端转发"]} value={n.fsMode} onChange={(e) => setN({ ...n, fsMode: e.target.value })} />}
          </Field>
          <Field label="机器人地址">
            {(id, cls) => <TextInput id={id} className={cls} value={n.hook} onChange={(e) => setN({ ...n, hook: e.target.value })} />}
          </Field>
        </>
      )}
      <Actions>
        <Button
          disabled={!dirty}
          onClick={() => {
            settings.set((s) => ({ ...s, notify: n }));
            log("修改通知设置", `邮件${n.mail ? "开启" : "关闭"}；飞书${n.fs ? "开启" : "关闭"}；模式：${n.fsMode}`);
            toast("通知设置已保存");
          }}
        >
          保存
        </Button>
      </Actions>
    </Section>
  );
}

/* ---------- 守护进程 ---------- */

function DaemonTab() {
  const toast = useToast();
  const { daemons } = settings.use();
  const [gen, setGen] = useState(false);
  const [revoke, setRevoke] = useState<number | null>(null);
  const [lastRevoke, setLastRevoke] = useState<number | null>(null);
  const [key, setKey] = useState(0);
  const [name, setName] = useState("");
  const [net, setNet] = useState("");
  const [token, setToken] = useState("");
  const target = daemons.find((d) => d.id === lastRevoke);

  const create = () => {
    const tk = genToken();
    setToken(tk);
    settings.set((s) => ({ ...s, daemons: [...s.daemons, { id: Date.now(), name: name.trim(), net: net.trim() || "未填写", seen: "尚未连接", on: false, tail: tk.slice(-4) }] }));
    /* only the name goes into the audit log, never the token */
    log("生成守护进程 token", name.trim());
  };
  const copy = () => {
    navigator.clipboard?.writeText(token).then(
      () => toast("已复制"),
      () => toast("请手动选中复制"),
    ) ?? toast("请手动选中复制");
  };

  return (
    <Section title="守护进程" hint="守护进程部署在和打印机同一网段的机器上，负责连接打印机并向面板汇报。每个守护进程用一个 token 接入。">
      <div>
        {daemons.length ? (
          daemons.map((d) => (
            <Row key={d.id}>
              <div className="min-w-0">
                <b className="block text-label-l font-medium">{d.name}</b>
                <small className="block text-body-s text-on-variant">
                  {d.net} · token ••••{d.tail}
                </small>
                <small className={cx("block text-body-s", d.on ? "text-ok" : "text-on-variant")}>
                  {d.on ? "在线" : "离线"} · {d.seen}
                </small>
              </div>
              <Button
                variant="outlined"
                icon="block"
                onClick={() => {
                  setRevoke(d.id);
                  setLastRevoke(d.id);
                }}
              >
                吊销
              </Button>
            </Row>
          ))
        ) : (
          <div className="text-note text-on-variant">还没有守护进程</div>
        )}
      </div>
      <Actions>
        <Button
          icon="key"
          onClick={() => {
            setName("");
            setNet("");
            setToken("");
            setKey((k) => k + 1);
            setGen(true);
          }}
        >
          生成新 token
        </Button>
      </Actions>

      {/* While the token is on screen the sheet can only be closed with 我已保存 */}
      <Sheet
        key={key}
        open={gen}
        dismissible={!token}
        onClose={() => setGen(false)}
        title={token ? "token 已生成" : "生成新 token"}
        sub={token ? "请现在复制并保存到守护进程的配置里。关闭后不会再显示，面板也不会保存明文。" : undefined}
        footer={
          token ? (
            <Button
              onClick={() => {
                setGen(false);
                setToken("");
                toast("已保存。token 不会再显示");
              }}
            >
              我已保存
            </Button>
          ) : (
            <>
              <Button variant="text" onClick={() => setGen(false)}>取消</Button>
              <Button disabled={!name.trim()} onClick={create}>生成</Button>
            </>
          )
        }
      >
        {token ? (
          <div className="flex items-center gap-1 rounded-xl bg-sc py-2 pr-2 pl-4 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]">
            <code className="min-w-0 flex-1 font-num text-label-l font-medium break-all select-all">{token}</code>
            <IconButton icon="content_copy" label="复制 token" size={40} onClick={copy} />
          </div>
        ) : (
          <>
            <Field label="守护进程名称" required>
              {(id, cls) => <TextInput id={id} className={cls} placeholder="例如 场馆 C 区边缘节点" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="所在网段（可选）">
              {(id, cls) => <TextInput id={id} className={cls} placeholder="例如 192.168.2.0/24" value={net} onChange={(e) => setNet(e.target.value)} />}
            </Field>
          </>
        )}
      </Sheet>

      <Sheet
        open={revoke != null && !!target}
        onClose={() => setRevoke(null)}
        icon="block"
        title={`吊销 ${target?.name ?? ""}？`}
        footer={
          <>
            <Button variant="text" onClick={() => setRevoke(null)}>返回</Button>
            <Button
              variant="text"
              className="text-error"
              onClick={() => {
                if (!target) return;
                settings.set((s) => ({ ...s, daemons: s.daemons.filter((d) => d.id !== target.id) }));
                log("吊销守护进程 token", target.name);
                setRevoke(null);
                toast(`已吊销 ${target.name}`);
              }}
            >
              吊销
            </Button>
          </>
        }
      >
        <div className="text-label-l font-normal text-on-variant">吊销后这个守护进程立即断开，它管的打印机会显示离线，需要重新生成 token 才能接入。会记入审计日志。</div>
      </Sheet>
    </Section>
  );
}

/* ---------- 审计日志 ---------- */

type AuditDraft = Record<"actorType" | "actorName" | "actorId" | "action" | "targetType" | "targetId" | "result" | "from" | "to", string>;
const BLANK_AUDIT: AuditDraft = { actorType: "", actorName: "", actorId: "", action: "", targetType: "", targetId: "", result: "", from: "", to: "" };
const ACTOR_LABELS = { user: "账户", system: "系统", daemon: "守护进程", printer: "打印机" };
const RESULT_LABELS = { ok: "成功", failed: "失败", denied: "拒绝" };
const RESULT_APPEARANCE = {
  ok: { tone: "ok", icon: "check_circle" },
  failed: { tone: "err", icon: "error" },
  denied: { tone: "warn", icon: "block" },
} as const;
const AUDIT_FILTER_ACTIONS = AUDIT_ACTIONS.filter(({ value }) => !LIVE || /^[a-z]/.test(value));

function auditClient(value: string | null): string {
  if (value === null) return "未记录";
  const browser = /Edg\//.test(value) ? "Microsoft Edge" : /Firefox\//.test(value) ? "Firefox" : /Chrome\//.test(value) ? "Chrome" : /Safari\//.test(value) ? "Safari" : "";
  const system = /Android/.test(value) ? "Android" : /iPhone|iPad/.test(value) ? "iOS" : /Windows/.test(value) ? "Windows" : /Macintosh|Mac OS X/.test(value) ? "macOS" : /Linux/.test(value) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ") || "未识别的客户端";
}

function formatAuditTime(iso: string) {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return { dateStr, timeStr };
}

function AuditTab() {
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<AuditDraft>({ ...BLANK_AUDIT });
  const [appliedDraft, setAppliedDraft] = useState<AuditDraft>({ ...BLANK_AUDIT });
  const [errors, setErrors] = useState<Partial<AuditDraft>>({});
  const [applied, setApplied] = useState<AuditListQuery>({});
  const [rows, setRows] = useState<AuditLogView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<AuditLogView | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const generation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const draftChanged = (Object.keys(draft) as (keyof AuditDraft)[]).some((key) => draft[key] !== appliedDraft[key]);
  const selectedChanges = selected ? auditChanges(selected) : null;
  const selectedNote = selected ? auditNote(selected) : null;
  const appliedLabels = [
    applied.actorId || applied.actorName ? ["actor", `操作人：${appliedDraft.actorName}`] as const : null,
    applied.action ? ["action", AUDIT_ACTIONS.find((item) => item.value === applied.action)?.label ?? "其他操作"] as const : null,
    applied.targetType ? ["targetType", AUDIT_TARGETS.find((item) => item.value === applied.targetType)?.label ?? "其他业务记录"] as const : null,
    applied.targetId ? ["targetId", applied.targetType === "order" ? `订单 #${applied.targetId}` : targetLabel || "所选内容"] as const : null,
    applied.result ? ["result", RESULT_LABELS[applied.result]] as const : null,
    applied.actorType ? ["actorType", ACTOR_LABELS[applied.actorType]] as const : null,
    applied.from ? ["from", `从 ${new Date(applied.from).toLocaleString(undefined, { hour12: false })}`] as const : null,
    applied.to ? ["to", `至 ${new Date(applied.to).toLocaleString(undefined, { hour12: false })}`] as const : null,
  ].filter((item) => item !== null);

  async function load(query: AuditListQuery, append = false, beforeId?: number) {
    const current = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    if (!append) { setRows([]); setLoaded(false); setMore(false); }
    const response = await auditApi.list({ ...query, limit: 50, ...(beforeId === undefined ? {} : { beforeId }) });
    if (!mounted.current || generation.current !== current) return;
    pending.current = false;
    setBusy(false);
    if (!response.ok) {
      setError(response.error.code === "forbidden" ? "没有查看审计日志的权限" : response.error.message);
      return;
    }
    setRows((previous) => append ? [...previous, ...response.data.filter((row) => !previous.some((old) => old.id === row.id))] : response.data);
    setLoaded(true);
    setMore(response.data.length === 50);
  }

  useEffect(() => {
    mounted.current = true;
    void load({});
    return () => { mounted.current = false; generation.current++; pending.current = false; };
  }, []);

  function apply(next: AuditDraft) {
    const invalid: Partial<AuditDraft> = {};
    const query: AuditListQuery = {};
    if (next.actorId) query.actorId = next.actorId;
    else if (next.actorName.trim()) query.actorName = next.actorName.trim();
    if (next.targetType === "order" && next.targetId && (!/^[1-9]\d*$/.test(next.targetId) || !Number.isSafeInteger(Number(next.targetId)))) invalid.targetId = "请输入有效的订单编号";
    for (const key of ["action", "targetType", "targetId"] as const) if (next[key].trim()) query[key] = next[key].trim();
    if (next.actorType) query.actorType = next.actorType as AuditListQuery["actorType"];
    if (next.result) query.result = next.result as AuditListQuery["result"];
    for (const key of ["from", "to"] as const) {
      if (!next[key]) continue;
      const date = new Date(next[key]);
      if (Number.isNaN(date.getTime())) invalid[key] = "请输入有效时间";
      else query[key] = date.toISOString();
    }
    if (query.from && query.to && query.from > query.to) invalid.to = "结束时间不能早于开始时间";
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    setApplied(query);
    setAppliedDraft({ ...next });
    setSelected(null);
    setFilterOpen(false);
    void load(query);
  }

  return (
    <Section title="审计日志" hint={LIVE ? "查看谁在什么时候处理了什么，以及操作的结果。" : "原型模拟数据，未连接审计后端"}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <button
            type="button"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
            className="state-layer inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-label-l font-medium text-primary transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Icon name="filter_list" size={18} />
            <span>筛选记录{appliedLabels.length > 0 ? ` · ${appliedLabels.length} 项` : ""}</span>
            <Icon name="expand_more" size={18} className={cx("transition-transform duration-150", filterOpen && "rotate-180")} />
          </button>
          <Button variant="text" icon="refresh" disabled={busy} onClick={() => void load(applied)}>
            刷新
          </Button>
        </div>

        {filterOpen && (
          <div className="rounded-2xl bg-sc-low p-4 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]">
            <form
              className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-6 max-sm:grid-cols-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (!pending.current || draftChanged) apply(draft);
              }}
            >
              <Field label="操作人" labelPlacement="outline">
                {(id, cls) => <TextInput id={id} className={cls} placeholder=" " maxLength={80} value={draft.actorName} onChange={(e) => setDraft({ ...draft, actorName: e.target.value, actorId: "" })} />}
              </Field>
              <Field label="操作来源" labelPlacement="outline">
                {(id, cls) => (
                  <div className="relative">
                    <select id={id} className={cx(cls, "appearance-none pr-12")} value={draft.actorType} onChange={(e) => setDraft({ ...draft, actorType: e.target.value })}>
                      <option value="">全部来源</option>
                      {AUDIT_ACTOR_TYPES.map((type) => <option key={type} value={type}>{ACTOR_LABELS[type]}</option>)}
                    </select>
                    <Icon name="arrow_drop_down" className="pointer-events-none absolute top-4 right-4 text-on-variant" />
                  </div>
                )}
              </Field>
              <Field label="操作" labelPlacement="outline">
                {(id, cls) => (
                  <div className="relative">
                    <select id={id} className={cx(cls, "appearance-none pr-12")} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
                      <option value="">全部操作</option>
                      {AUDIT_FILTER_ACTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Icon name="arrow_drop_down" className="pointer-events-none absolute top-4 right-4 text-on-variant" />
                  </div>
                )}
              </Field>
              <Field label="结果" labelPlacement="outline">
                {(id, cls) => (
                  <div className="relative">
                    <select id={id} className={cx(cls, "appearance-none pr-12")} value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })}>
                      <option value="">全部结果</option>
                      {AUDIT_RESULTS.map((result) => <option key={result} value={result}>{RESULT_LABELS[result]}</option>)}
                    </select>
                    <Icon name="arrow_drop_down" className="pointer-events-none absolute top-4 right-4 text-on-variant" />
                  </div>
                )}
              </Field>
              <Field label="涉及内容" labelPlacement="outline">
                {(id, cls) => (
                  <div className="relative">
                    <select id={id} className={cx(cls, "appearance-none pr-12")} value={draft.targetType} onChange={(e) => { setDraft({ ...draft, targetType: e.target.value, targetId: "" }); setTargetLabel(""); }}>
                      <option value="">全部内容</option>
                      {AUDIT_TARGETS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <Icon name="arrow_drop_down" className="pointer-events-none absolute top-4 right-4 text-on-variant" />
                  </div>
                )}
              </Field>
              <Field label="订单编号" labelPlacement="outline" error={errors.targetId}>
                {(id, cls) => (
                  <TextInput
                    id={id}
                    className={cls}
                    placeholder=" "
                    inputMode="numeric"
                    disabled={!!draft.targetType && draft.targetType !== "order"}
                    value={draft.targetType === "order" ? draft.targetId : ""}
                    aria-invalid={!!errors.targetId}
                    aria-describedby={errors.targetId ? `${id}-support` : undefined}
                    onChange={(e) => { setDraft({ ...draft, targetType: "order", targetId: e.target.value.trim().replace(/^#/, "") }); setTargetLabel(""); }}
                  />
                )}
              </Field>
              {([["from", "开始时间"], ["to", "结束时间"]] as const).map(([key, label]) => (
                <Field key={key} label={label} labelPlacement="outline" error={errors[key]}>
                  {(id, cls) => <TextInput id={id} className={cls} type="datetime-local" step="1" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-support` : undefined} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />}
                </Field>
              ))}
              <div className="col-span-full">
                <Actions>
                  <Button type="button" variant="text" disabled={busy && !Object.values(appliedDraft).some(Boolean)} onClick={() => { setDraft({ ...BLANK_AUDIT }); setTargetLabel(""); apply({ ...BLANK_AUDIT }); }}>重置</Button>
                  <Button type="submit" icon="filter_list" disabled={busy && !draftChanged}>筛选</Button>
                </Actions>
              </div>
            </form>
          </div>
        )}
      </div>
      {appliedLabels.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-2" aria-label="已应用的筛选">
          {appliedLabels.map(([key, label]) => (
            <Button
              key={key}
              variant="tonal"
              icon="close"
              className="h-auto! max-w-full py-2 whitespace-normal! [overflow-wrap:anywhere]"
              aria-label={`移除筛选：${label}`}
              onClick={() => {
                const next = { ...appliedDraft };
                if (key === "actor") { next.actorId = ""; next.actorName = ""; }
                else next[key] = "";
                if (key === "targetType") next.targetId = "";
                if (key === "targetId" || key === "targetType") setTargetLabel("");
                setDraft(next);
                apply(next);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      <div aria-busy={busy} aria-live="polite" className="min-w-0 border-t border-solid border-outline-variant pt-4">
        {busy && !loaded && <StatusBlock icon="hourglass_empty" title="正在加载审计日志…" />}
        {!loaded && error && <StatusBlock tone="err" icon="error" title={error}><Button variant="text" icon="refresh" disabled={busy} onClick={() => void load(applied)}>重试</Button></StatusBlock>}
        {loaded && rows.length === 0 && <Empty icon="history" title="没有符合条件的审计日志" />}
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const { dateStr, timeStr } = formatAuditTime(row.at);
            return (
              <li key={row.id} className="grid min-h-[84px] grid-cols-[124px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 border-t border-solid border-outline-variant py-3.5 first:border-t-0 max-sm:grid-cols-1">
                <time dateTime={row.at} className="flex flex-col pt-0.5 text-on-variant tnum max-sm:flex-row max-sm:items-center max-sm:gap-2 max-sm:pt-0">
                  <span className="text-body-s font-medium text-on-surface/85">{dateStr}</span>
                  <span className="text-body-s text-on-variant">{timeStr}</span>
                </time>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px] items-center gap-2 [overflow-wrap:anywhere]">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 truncate">
                        {row.actorId && row.actorType === "user" ? (
                          <button
                            type="button"
                            className="cursor-pointer truncate text-left text-label-l font-semibold text-primary transition-colors hover:underline underline-offset-2 focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-primary"
                            title="只看此人的操作"
                            onClick={() => {
                              const next = { ...appliedDraft, actorId: row.actorId!, actorName: auditActor(row), actorType: "user" };
                              setDraft(next);
                              apply(next);
                            }}
                          >
                            {auditActor(row)}
                          </button>
                        ) : (
                          <b className="truncate text-label-l font-medium text-on-surface">{auditActor(row)}</b>
                        )}
                      </div>
                      <div className="flex-none">
                        <StatusChip {...RESULT_APPEARANCE[row.result]}>{RESULT_LABELS[row.result]}</StatusChip>
                      </div>
                    </div>
                    <div className="text-body-m font-medium text-on-surface">{auditAction(row)}</div>
                    {row.targetId && row.targetType ? (
                      <button
                        type="button"
                        className="w-fit cursor-pointer text-left text-body-m text-on-variant transition-colors hover:text-primary hover:underline underline-offset-2 focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-primary"
                        title="只看相关操作"
                        onClick={() => {
                          const next = { ...appliedDraft, targetType: row.targetType!, targetId: row.targetId! };
                          setDraft(next);
                          setTargetLabel(auditTarget(row));
                          apply(next);
                        }}
                      >
                        {auditTarget(row)}
                      </button>
                    ) : (
                      <div className="text-body-m text-on-variant">{auditTarget(row)}</div>
                    )}
                  </div>
                  <IconButton icon="chevron_right" label="查看详情" title="查看详情" size={40} onClick={() => setSelected(row)} />
                </div>
              </li>
            );
          })}
        </ul>
        {loaded && more && !error && <Actions><Button variant="outlined" icon="expand_more" disabled={busy} onClick={() => { if (!pending.current) void load(applied, true, rows.at(-1)?.id); }}>{busy ? "正在加载…" : "加载更多"}</Button></Actions>}
      </div>
      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected ? auditAction(selected) : "操作详情"} titleSize="lg" sub={selected ? new Date(selected.at).toLocaleString(undefined, { hour12: false }) : undefined} footer={<Button variant="text" onClick={() => setSelected(null)}>关闭</Button>}>
        {selected && <>
          <dl className="m-0 flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]">
            <div className="flex items-center justify-between gap-4 border-b border-solid border-outline-variant pb-4"><dt className="text-body-m text-on-variant">操作结果</dt><dd className="m-0"><StatusChip {...RESULT_APPEARANCE[selected.result]}>{RESULT_LABELS[selected.result]}</StatusChip></dd></div>
            {([
              ["操作人", auditActor(selected)], ["当前角色", selected.actorType === "user" ? auditRole(selected.actor?.role ?? null) : ACTOR_LABELS[selected.actorType]],
              ["涉及内容", auditTarget(selected)], ["原因说明", auditReason(selected)],
            ] as const).filter(([, value]) => value !== null).map(([label, value]) => <div key={label} className="flex min-w-0 flex-col gap-1"><dt className="text-body-s text-on-variant">{label}</dt><dd className="m-0 whitespace-pre-wrap text-body-m">{value}</dd></div>)}
          </dl>
          {selectedNote && <StatusBlock icon="info" title={selectedNote} />}
          <section className="flex min-w-0 flex-col gap-4 border-t border-solid border-outline-variant pt-4">
            <h3 className="m-0 text-title-m font-medium">操作内容</h3>
            {selected.result !== "ok" && <p className="m-0 text-body-s text-on-variant">失败或拒绝记录中的请求内容，不代表变更已经生效。</p>}
            {selectedChanges?.length ? selectedChanges.map((change) => <div key={change.label} className="flex min-w-0 flex-col gap-2">
              <div className="text-label-l font-medium">{change.label}</div>
              <div className="flex min-w-0 flex-col gap-2">
                {change.before !== null && <div className="min-w-0 rounded-xl bg-sc-low p-3 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]"><dt className="text-body-s font-medium text-on-variant">操作前</dt><dd className="m-0 mt-1 whitespace-pre-wrap text-body-m text-on-surface [overflow-wrap:anywhere]">{change.before}</dd></div>}
                {change.after !== null && <div className="min-w-0 rounded-xl bg-sc-low p-3 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]"><dt className="text-body-s font-medium text-on-variant">{selected.result === "ok" && change.before !== null ? "操作后" : "内容"}</dt><dd className="m-0 mt-1 whitespace-pre-wrap text-body-m text-on-surface [overflow-wrap:anywhere]">{change.after}</dd></div>}
              </div>
            </div>) : <p className="m-0 text-body-m text-on-variant">这条记录没有附加变更内容。</p>}
          </section>
          <details className="min-w-0 border-t border-solid border-outline-variant pt-4">
            <summary className="w-fit cursor-pointer rounded-sm text-label-l text-primary">来源信息</summary>
            <dl className="m-0 mt-3 flex min-w-0 flex-col gap-3 text-body-m [overflow-wrap:anywhere]">
              <div><dt className="text-body-s text-on-variant">来源 IP</dt><dd className="m-0">{selected.ip ?? "未记录"}</dd></div>
              <div><dt className="text-body-s text-on-variant">访问客户端</dt><dd className="m-0 whitespace-pre-wrap">{auditClient(selected.device)}</dd></div>
            </dl>
          </details>
        </>}
      </Sheet>
    </Section>
  );
}

const BODY: Record<TabKey, () => ReactNode> = { form: FormTab, users: UsersTab, policy: PolicyTab, notify: NotifyTab, daemon: DaemonTab, audit: AuditTab };

export function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const visibleTabs = TABS.filter(([key]) => canOpen(me, `/settings/${key}`));
  if (!TABS.some(([key]) => key === tab)) return visibleTabs.length ? <Navigate to={`/settings/${visibleTabs[0][0]}`} replace /> : null;
  if (!canOpen(me, `/settings/${tab}`)) return null;
  const Body = BODY[tab as TabKey];
  return (
    <Page>
      <PageHeader title="系统设置" />
      <div className="mx-auto flex w-full max-w-[840px] min-w-0 flex-col gap-6 max-sm:gap-4">
        <FilterTabs<TabKey> label="设置分类" value={tab as TabKey} onChange={(k) => navigate(`/settings/${k}`)} items={visibleTabs.map(([k, l]) => ({ key: k, label: l }))} />
        <Body key={tab} />
      </div>
    </Page>
  );
}
