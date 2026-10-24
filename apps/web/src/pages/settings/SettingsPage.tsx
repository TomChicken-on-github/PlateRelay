import { type ReactNode, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Button, IconButton } from "../../components/Button";
import { FilterTabs } from "../../components/Chip";
import { Field, Select, TextInput } from "../../components/Field";
import { Page, PageHeader } from "../../components/Page";
import { Sheet } from "../../components/Sheet";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
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

/* The signed-in admin in this prototype */
const ACTOR = "Tom_Chicken";
const log = (action: string, obj: string) => settings.set((s) => ({ ...s, audit: [["刚刚", ACTOR, action, obj], ...s.audit] }));

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[840px] min-w-0 flex-col gap-4 rounded-xl bg-sc p-5 max-sm:p-4">
      <h2 className="m-0 text-[16px] leading-6 font-medium">{title}</h2>
      {hint && <div className="-mt-2 text-note text-on-variant">{hint}</div>}
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
            log("修改通知设置", "");
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

function AuditTab() {
  const { audit } = settings.use();
  return (
    <Section title="审计日志" hint="只记谁、什么时候、做了什么，不记访问码、令牌等凭据。">
      <ul className="m-0 list-none p-0">
        {audit.map(([t, w, a, o], i) => (
          <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-solid border-outline-variant py-3 text-note first:border-t-0 max-sm:grid-cols-1">
            <time className="font-num text-body-s leading-[18px] text-on-variant">{t}</time>
            <div>
              <b className="font-medium">{w}</b> {a}
              {o && (
                <>
                  <br />
                  <span className="text-on-variant">{o}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const BODY: Record<TabKey, () => ReactNode> = { form: FormTab, users: UsersTab, policy: PolicyTab, notify: NotifyTab, daemon: DaemonTab, audit: AuditTab };

export function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  if (!TABS.some(([k]) => k === tab)) return <Navigate to="/settings/form" replace />;
  const Body = BODY[tab as TabKey];
  return (
    <Page>
      <PageHeader title="系统设置" />
      <FilterTabs<TabKey> label="设置分类" value={tab as TabKey} onChange={(k) => navigate(`/settings/${k}`)} items={TABS.map(([k, l]) => ({ key: k, label: l }))} />
      <Body key={tab} />
    </Page>
  );
}
