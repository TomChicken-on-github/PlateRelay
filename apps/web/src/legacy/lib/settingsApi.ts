import type { DaemonView, FormField, FormFieldType, FormView, PanelSettings, UserView } from "@platerelay/shared";
import { type Daemon, type FormField as MockField, settings } from "../mock/settings";
import { LIVE, type Res, api } from "./api";
import { resource } from "./live";
import { fmtAt } from "./ordersApi";
import { session } from "./session";

/*
 * 系统设置 pages that have a backend: request form, users and roles, daemon tokens, registration.
 * 文件与排队 and 通知 have no server side yet and stay prototype-only.
 */

export const FIELD_TYPE_LABEL: Record<FormFieldType, string> = { text: "单行文本", textarea: "多行文本", single: "单选", multi: "多选", number: "数字" };
const TYPE_OF = Object.fromEntries(Object.entries(FIELD_TYPE_LABEL).map(([k, v]) => [v, k])) as Record<string, FormFieldType>;
export const typeOf = (label: string): FormFieldType => TYPE_OF[label] ?? "text";

export const ROLE_ID: Record<string, string> = { User: "user", Staff: "staff", Builder: "builder", Coreteam: "coreteam" };

/** Row shape of the form tab; `key` is the server's field id (the mock uses numbers). */
export type FieldRow = MockField & { key: string; options?: string[] };
export type UserRow = { id: string; n: string; role: string; username?: string };
export type DaemonRow = Daemon & { key: string };

const toField = (f: FormField, i: number): FieldRow => ({ id: i, key: f.id, name: f.label, type: FIELD_TYPE_LABEL[f.type], req: f.required, options: f.options });
const fromField = (f: FieldRow): FormField => ({ id: f.key, label: f.name, type: typeOf(f.type), required: f.req, ...(f.options?.length ? { options: f.options } : {}) });

/* A daemon counts as online when it reported in the last two minutes; nothing reports until the daemon link exists. */
const ONLINE_MS = 2 * 60e3;
const toDaemon = (d: DaemonView, i: number): DaemonRow => ({
  id: i,
  key: d.id,
  name: d.name,
  net: d.network || "未填写",
  seen: d.lastSeenAt ? `最后连接 ${fmtAt(d.lastSeenAt)}` : "尚未连接",
  on: d.enabled && !!d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < ONLINE_MS,
  tail: d.tokenTail,
});

const map = async <A, B>(r: Promise<Res<A>>, f: (a: A) => B): Promise<Res<B>> => {
  const x = await r;
  return x.ok ? { ok: true, data: f(x.data) } : x;
};

const live = {
  form: resource(() => map(api<FormView>("/api/form"), (v) => v.fields.map(toField))),
  users: resource(() => map(api<UserView[]>("/api/users"), (v) => v.map((u): UserRow => ({ id: u.id, n: u.displayName, role: u.roleName ?? "User", username: u.username })))),
  daemons: resource(() => map(api<DaemonView[]>("/api/daemons"), (v) => v.map(toDaemon))),
  /* only asked for with settings:manage, so a user manager does not leave a denied entry in the audit log */
  panel: resource(async (): Promise<Res<PanelSettings | null>> => {
    const s = session.get();
    return s.st === "in" && s.me.permissions?.includes("settings:manage") ? api<PanelSettings>("/api/settings") : { ok: true, data: null };
  }),
};

type Rows<T> = { rows: T[]; loading: boolean; error: string | null };
const rows = <T,>(s: { data: T[] | null; loading: boolean; error: string | null }): Rows<T> => ({ rows: s.data ?? [], loading: s.loading && !s.data, error: s.error });

export function useFields(): Rows<FieldRow> {
  const mock = settings.use().fields;
  return LIVE ? rows(live.form.use()) : { rows: mock.map((f) => ({ ...f, key: String(f.id) })), loading: false, error: null };
}
export function useUsers(): Rows<UserRow> {
  const mock = settings.use().users;
  return LIVE ? rows(live.users.use()) : { rows: mock.map((u) => ({ id: u.n, ...u })), loading: false, error: null };
}
export function useDaemons(): Rows<DaemonRow> {
  const mock = settings.use().daemons;
  return LIVE ? rows(live.daemons.use()) : { rows: mock.map((d) => ({ ...d, key: String(d.id) })), loading: false, error: null };
}
/** Self sign-up switch; null in the prototype, which has no such setting. */
export function useRegistration(): boolean | null {
  const s = LIVE ? live.panel.use().data : null;
  return s ? s.registration.enabled : null;
}

type Done = Res<null>;
const ok: Done = { ok: true, data: null };
const reload = async <T,>(r: Res<T>, which: keyof typeof live): Promise<Res<T>> => (await live[which].refresh(), r);

/** A new field id the server accepts: a lowercase letter, then letters, digits or _. */
export const newFieldKey = () => "f" + Date.now().toString(36) + Math.floor(Math.random() * 36 ** 2).toString(36);

export const settingsApi = {
  /** The form is saved whole; every save is a new version on the server. */
  async saveFields(next: FieldRow[]): Promise<Done> {
    if (!LIVE) return settings.set((s) => ({ ...s, fields: next.map(({ key: _k, options: _o, ...f }) => f) })), ok;
    return reload(await api<null>("/api/form", { method: "PUT", json: { fields: next.map(fromField) } }), "form");
  },

  async setRole(u: UserRow, role: string): Promise<Done> {
    if (!LIVE) return settings.set((s) => ({ ...s, users: s.users.map((x) => (x.n === u.n ? { ...x, role } : x)) })), ok;
    return reload(await api<null>(`/api/users/${u.id}/role`, { method: "PUT", json: { role: ROLE_ID[role] } }), "users");
  },

  async setRegistration(enabled: boolean): Promise<Done> {
    return reload(await api<null>("/api/settings/registration", { method: "PUT", json: { enabled } }), "panel");
  },

  /** Returns the token, shown once. */
  async createDaemon(name: string, network: string, mockToken: () => string): Promise<Res<string>> {
    if (!LIVE) {
      const tk = mockToken();
      settings.set((s) => ({ ...s, daemons: [...s.daemons, { id: Date.now(), name, net: network || "未填写", seen: "尚未连接", on: false, tail: tk.slice(-4) }] }));
      return { ok: true, data: tk };
    }
    const r = await map(api<DaemonView & { token: string }>("/api/daemons", { method: "POST", json: { name, network: network || null } }), (d) => d.token);
    return reload(r, "daemons");
  },

  async revokeDaemon(d: DaemonRow): Promise<Done> {
    if (!LIVE) return settings.set((s) => ({ ...s, daemons: s.daemons.filter((x) => x.id !== d.id) })), ok;
    return reload(await api<null>(`/api/daemons/${d.key}`, { method: "DELETE" }), "daemons");
  },
};
