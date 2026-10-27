import { ME as MOCK_ME } from "../mock/session";
import { LIVE, type Res, api, setUnauthenticatedHandler } from "./api";
import { createStore } from "./store";

/* Signed-in account. POST /api/auth/login sets an httpOnly session cookie; GET /api/auth/me reads it back. */
export type Me = { name: string; role: string; username?: string; permissions?: string[] };
type MeView = { id: string; username: string; displayName: string; role: { id: string; name: string }; permissions: string[] };
type State = { st: "loading" } | { st: "out" } | { st: "in"; me: Me };

const fromView = (v: MeView): Me => ({ name: v.displayName, role: v.role.name, username: v.username, permissions: v.permissions });

/* Mock mode starts signed in as the prototype user, so every page stays reachable without a server. */
export const session = createStore<State>(LIVE ? { st: "loading" } : { st: "in", me: MOCK_ME });
setUnauthenticatedHandler(() => session.set({ st: "out" }));

export function useMe(): Me {
  const s = session.use();
  return s.st === "in" ? s.me : { name: "", role: "" };
}

export async function loadMe() {
  const r = await api<MeView>("/api/auth/me");
  session.set(r.ok ? { st: "in", me: fromView(r.data) } : { st: "out" });
}

async function signIn(r: Promise<Res<MeView>>): Promise<Res<Me>> {
  const x = await r;
  if (!x.ok) return x;
  const me = fromView(x.data);
  session.set({ st: "in", me });
  return { ok: true, data: me };
}

export function login(username: string, password: string): Promise<Res<Me>> {
  if (!LIVE) return signIn(Promise.resolve({ ok: true, data: { id: "", username, displayName: MOCK_ME.name, role: { id: "builder", name: MOCK_ME.role }, permissions: [] } }));
  return signIn(api<MeView>("/api/auth/login", { method: "POST", json: { username, password } }));
}

export function register(username: string, displayName: string, password: string): Promise<Res<Me>> {
  if (!LIVE) return signIn(Promise.resolve({ ok: true, data: { id: "", username, displayName, role: { id: "user", name: "User" }, permissions: [] } }));
  return signIn(api<MeView>("/api/auth/register", { method: "POST", json: { username, displayName, password } }));
}

export async function logout() {
  if (LIVE) await api<null>("/api/auth/logout", { method: "POST" });
  session.set({ st: "out" });
}


/*
 * Which permission nodes open which page (any one is enough), mirroring the server's @RequirePerm.
 * The server still checks every request; this only hides what the account cannot use.
 */
const PAGE_PERMS: [prefix: string, perms: string[]][] = [
  ["/printers", ["overview:view"]],
  ["/submit", ["order:submit"]],
  ["/orders", ["order:submit", "order:cancel:own"]],
  ["/todo", ["order:store", "printer:operate"]],
  ["/scan", ["order:redeem"]],
  ["/review", ["order:review"]],
  ["/manage/orders", ["order:view:any"]],
  ["/manage/printers", ["printer:manage"]],
  ["/settings/form", ["form:configure"]],
  ["/settings/users", ["user:manage"]],
  ["/settings/policy", ["settings:manage"]],
  ["/settings/resources", ["resource:configure"]],
  ["/settings/notify", ["settings:manage"]],
  ["/settings/daemon", ["daemon:manage"]],
  ["/settings/audit", ["audit:view"]],
  ["/settings", ["settings:manage", "form:configure", "user:manage", "daemon:manage", "audit:view", "resource:configure"]],
];

/** Mock accounts carry no permission list and can open everything. */
export function canOpen(me: Me, path: string) {
  if (!me.permissions) return true;
  const rule = path === "/" ? ["overview:view"] : PAGE_PERMS.find(([p]) => path === p || path.startsWith(p + "/"))?.[1];
  return !rule || rule.some((p) => me.permissions!.includes(p));
}
