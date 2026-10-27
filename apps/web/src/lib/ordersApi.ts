import { COLOUR_PREF_LABEL, type FailureAttribution, type OrderDetail, type OrderList, type OrderTimelineEntry, type OrderVersionView, type OrderView, type OverviewStats, type PersonView, type PrinterView, type TodoView } from "@platerelay/shared";
import { type AdminOrder, adminOrders } from "../mock/adminOrders";
import { type MyOrder, myOrders, type OrderStatus, type Version, type VersionSt } from "../mock/myOrders";
import { type Task, tasks } from "../mock/todo";
import { type ApiErr, LIVE, type Res, api } from "./api";
import { resource, stableLink } from "./live";

/*
 * Orders, review, order management and 待办. With VITE_API=http the pages read apps/server through the
 * resources below; otherwise they keep running on the mock stores. Server views are mapped onto the
 * row shapes the pages already draw, so layouts do not depend on where the data came from.
 */

/* ---------- formatting ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
/** "10-24 09:12", local time. */
export function fmtAt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "1h 40m". */
export const fmtDur = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};
/** "38 分钟", "2 小时 5 分钟". */
export function fmtSince(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ""}`;
}
export const shortModel = (model: string | null, id: string) => model?.replace(/^Bambu Lab\s+/, "") ?? id;
const nozzleText = (v: Pick<OrderView, "nozzles">) => [...new Set(v.nozzles.map((n) => n.diameter))].join(" / ");
const fil = (v: Pick<OrderView, "filaments">): [string, string][] => [...v.filaments].sort((a, b) => a.slot - b.slot).map((f) => [f.color, f.type]);
const person = (p: PersonView | null | undefined) => (p ? (p.role ? `${p.role} ${p.name}` : p.name) : undefined);
const thumb = (v: OrderView) => stableLink(`order:${v.id}`, v.thumbUrl);

export function pageStatus(v: Pick<OrderView, "status" | "waitingForHandler"> & { revision?: OrderView["revision"] }): OrderStatus {
  switch (v.status) {
    case "PENDING_REVIEW":
      return v.revision ? "revising" : "pending";
    case "QUEUED":
      return "queued";
    case "PRINTING":
      return v.waitingForHandler ? "paused" : "printing";
    case "PRINTED_AWAITING_STORAGE":
      return "awaiting";
    case "STORED_READY_PICKUP":
      return "ready";
    case "COMPLETED":
      return "done";
    case "REJECTED":
      return "rejected";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
  }
}

const ATTR_LABEL: Record<FailureAttribution, string> = { machine: "机器故障", model: "模型或切片问题" };

/* ---------- mapping ---------- */

export function toMyOrder(v: OrderView): MyOrder {
  const st = pageStatus(v);
  return {
    id: v.id,
    file: v.fileName,
    n: v.plate.index,
    model: shortModel(v.printerModel, v.printerModelId),
    nozzle: nozzleText(v),
    time: fmtDur(v.printSeconds),
    g: Math.round(v.weightGrams),
    fil: fil(v),
    st,
    at: fmtAt(v.submittedAt),
    printer: v.printer?.name,
    pct: v.progress ?? undefined,
    pos: v.queue?.position,
    ahead: v.queue && v.queue.aheadSeconds > 0 ? `约 ${fmtDur(v.queue.aheadSeconds)}` : undefined,
    wait: v.waitReason ?? undefined,
    why: st === "paused" ? "打印机报错" : undefined,
    done: fmtAt(v.printedAt) || undefined,
    slot: v.stored?.slot,
    when: st === "done" ? fmtAt(v.redeemed?.at) : fmtAt(v.stored?.at) || undefined,
    reason: st === "rejected" ? (v.review?.reason ?? undefined) : st === "failed" ? v.failure?.reason : st === "cancelled" ? (v.cancel?.by?.id && v.cancel.by.id === v.owner.id ? "你取消了：" : "工作人员取消：") + v.cancel?.reason : undefined,
    by: person(v.review?.by),
    retried: v.retriedAs ?? undefined,
    thumb: thumb(v),
    storer: person(v.stored?.by),
    redeemer: person(v.redeemed?.by),
    canceller: v.cancel?.by?.name,
    canRevise: v.canRevise,
    canCancel: v.canCancelOwn,
    revs: v.revisions.count,
    revMax: v.revisions.max,
    switches: v.revisions.switches,
    maxSwitches: v.revisions.maxSwitches,
    baseSec: v.revisions.baselineSeconds,
    modelId: v.printerModelId,
    dual: v.nozzles.length > 1,
    canWithdraw: v.canWithdraw,
  };
}

function versionSt(x: OrderVersionView, queued: boolean): VersionSt {
  switch (x.state) {
    case "pending":
      return queued ? "审核中" : "待审核";
    case "approved":
      return x.current ? "当前" : "已通过";
    case "withdrawn":
      return "已撤回";
    case "rejected":
      return "未通过";
  }
}

/** 版本记录 rows; `queued`: the order already holds a place (a pending version is then a revision). */
export function toVersions(d: Pick<OrderDetail, "id" | "versions" | "queue">): Version[] {
  return (d.versions ?? []).map((x) => ({
    n: x.n,
    file: x.fileName,
    model: shortModel(x.printerModel, x.printerModelId),
    modelId: x.printerModelId,
    nozzle: nozzleText(x),
    time: fmtDur(x.printSeconds),
    sec: x.printSeconds,
    g: Math.round(x.weightGrams),
    fil: fil(x),
    at: fmtAt(x.at),
    st: versionSt(x, !!d.queue),
    from: x.restoredFrom ?? undefined,
    thumb: stableLink(`order:${d.id}:v${x.n}`, x.thumbUrl),
    reason: x.reason ?? undefined,
  }));
}

export function toAdminOrder(v: OrderView): AdminOrder {
  const st = pageStatus(v);
  const note =
    st === "rejected"
      ? (v.review?.reason ?? undefined)
      : st === "failed"
        ? v.failure?.reason + (v.failure?.attribution ? ` · 归因：${ATTR_LABEL[v.failure.attribution]}` : "")
        : st === "cancelled"
          ? `${v.cancel?.by?.id === v.owner.id ? "选手" : "管理员"}取消：${v.cancel?.reason ?? ""}`
          : st === "paused"
            ? (v.error?.message ?? "打印机报错，等待处理")
            : undefined;
  return {
    id: v.id,
    file: v.fileName,
    plate: v.plate.count > 1 ? `第 ${v.plate.index} 盘 / 共 ${v.plate.count} 盘` : undefined,
    owner: v.owner.name,
    model: shortModel(v.printerModel, v.printerModelId),
    nozzle: nozzleText(v),
    time: fmtDur(v.printSeconds),
    g: Math.round(v.weightGrams),
    mb: Math.round((v.sizeBytes / 1048576) * 10) / 10,
    fil: fil(v),
    st,
    at: fmtAt(v.submittedAt),
    printer: v.printer?.name,
    pct: v.progress ?? undefined,
    note,
    thumb: thumb(v),
    pos: v.queue?.position,
    attributed: !!v.failure?.attribution,
    retried: v.retriedAs ?? undefined,
    mine: v.isMine,
    colour: COLOUR_PREF_LABEL[v.colourPref],
    missing: v.missingColours?.length ? v.missingColours.map((c): [string, string] => [c, v.filaments.find((f) => f.color.slice(0, 7).toLowerCase() === c)?.type ?? ""]) : undefined,
    rev: v.revision
      ? {
          n: v.revision.n,
          file: v.revision.prev.fileName,
          model: shortModel(v.revision.prev.printerModel, v.revision.prev.printerModelId),
          time: fmtDur(v.revision.prev.printSeconds),
          g: Math.round(v.revision.prev.weightGrams),
          fil: fil(v.revision.prev),
          pos: v.queue?.position,
          back: v.revision.placesBack,
        }
      : undefined,
  };
}

const answerText = (v: string | string[] | number | null) => (v === null || v === "" ? "未填写" : Array.isArray(v) ? v.join("、") : String(v));

function eventText(e: OrderTimelineEntry): string {
  const by = e.by ?? "系统";
  const d = e.data ?? {};
  switch (e.kind) {
    case "submit":
      return `${by} 提交订单`;
    case "approve":
      return `${by} 审核通过`;
    case "reject":
      return `${by} 驳回：${d.reason ?? ""}`;
    case "dispatch":
      return `派单到 ${d.printer ?? "打印机"}`;
    case "printing-started":
      return "开始打印";
    case "error-paused":
      return `打印机报错暂停${d.message ? `：${d.message}` : ""}`;
    case "resumed":
      return "已继续打印";
    case "requeue":
      return "没能开始打印，回到队列原位";
    case "finish":
      return "打印完成，等待入库";
    case "fail":
      return `${by} 停止打印：${d.reason ?? ""}`;
    case "store":
      return `${by} 入库到 ${d.slot ?? "暂存篮"}`;
    case "redeem":
      return `${by} 核销取件`;
    case "cancelOwn":
    case "cancelAny":
      return `${by} 取消订单：${d.reason ?? ""}`;
    case "attribute":
      return `${by} 失败归因：${ATTR_LABEL[d.attribution as FailureAttribution] ?? ""}${d.retry ? `，重打为 #${d.retry}` : ""}`;
    case "retry":
      return `由 #${d.retryOf} 失败重打生成`;
    default:
      return `${by} ${e.kind}`;
  }
}

export function toAdminDetail(v: OrderDetail): AdminOrder {
  return {
    ...toAdminOrder(v),
    answers: (v.answers ?? []).map((a) => [a.label, answerText(a.value)]),
    vers: toVersions(v),
    log: v.timeline.map((e) => [fmtAt(e.at), eventText(e)]),
  };
}

function toTasks(t: TodoView): Task[] {
  const base = (o: OrderView | null, p: PrinterView | null) => ({
    order: o?.id ?? 0,
    file: o?.fileName ?? "非系统下发的任务",
    n: o?.plate.index ?? 1,
    model: o ? shortModel(o.printerModel, o.printerModelId) : shortModel(p?.model ?? null, p?.modelId ?? "—"),
    nozzle: o ? nozzleText(o) : "—",
    time: o ? fmtDur(o.printSeconds) : "—",
    g: o ? Math.round(o.weightGrams) : 0,
    fil: o ? fil(o) : [],
    printer: p?.name ?? o?.printer?.name ?? "—",
    owner: o?.owner.name ?? "—",
    printerId: p?.id ?? o?.printer?.id,
    thumb: o ? thumb(o) : null,
  });
  return [
    ...t.store.map((x): Task => ({ id: `s${x.order.id}`, kind: "stock", since: fmtSince(x.since), ...base(x.order, x.printer) })),
    ...t.clear.map((x): Task => ({ id: `c${x.printer.id}`, kind: "clear", since: fmtSince(x.since), ...base(x.order, x.printer) })),
    ...t.errors.map(
      (x): Task => ({
        id: `e${x.printer.id}`,
        kind: "err",
        since: fmtSince(x.since),
        err: x.printer.error?.message ?? x.printer.error?.vendorCode ?? "打印机报错，已暂停",
        pct: x.order?.progress ?? undefined,
        hms: x.printer.error?.vendorCode,
        actions: x.printer.error?.actions,
        ...base(x.order, x.printer),
      }),
    ),
    ...t.skipped.map((x): Task => ({ id: `k${x.order.id}`, kind: "skip", since: fmtSince(x.since), why: x.order.waitReason ?? undefined, ...base(x.order, null), printer: x.order.queue ? `队列第 ${x.order.queue.position} 位` : "—" })),
  ];
}

/* ---------- resources ---------- */

const mapRes = async <A, B>(r: Promise<Res<A>>, f: (a: A) => B): Promise<Res<B>> => {
  const x = await r;
  return x.ok ? { ok: true, data: f(x.data) } : x;
};

/** Generous page for 订单管理; filtering and search then stay instant. Paging comes when events need it. */
const MANAGE_LIMIT = 200;

export const live = {
  mine: resource(() => mapRes(api<OrderView[]>("/api/orders/mine"), (v) => v.map(toMyOrder))),
  review: resource(() => mapRes(api<OrderDetail[]>("/api/review"), (v) => v.map((o) => ({ ...toAdminOrder(o), answers: (o.answers ?? []).map((a): [string, string] => [a.label, answerText(a.value)]), vers: toVersions(o) })))),
  manage: resource(() => mapRes(api<OrderList>(`/api/orders?limit=${MANAGE_LIMIT}`), (v) => v.orders.map(toAdminOrder))),
  todo: resource(() => mapRes(api<TodoView>("/api/todo"), toTasks)),
  overview: resource(() => api<OverviewStats>("/api/overview")),
};

type Rows<T> = { rows: T[]; loading: boolean; error: string | null };
const rows = <T,>(s: { data: T[] | null; loading: boolean; error: string | null }): Rows<T> => ({ rows: s.data ?? [], loading: s.loading && !s.data, error: s.error });

/* Own orders change as printers work, and reading them is not audited, so they poll; staff lists reload on focus and after actions. */
export const useMyOrders = (): Rows<MyOrder> => (LIVE ? rows(live.mine.use(20e3)) : { rows: myOrders.use(), loading: false, error: null });
export const useReviewOrders = (): Rows<AdminOrder> => (LIVE ? rows(live.review.use()) : { rows: adminOrders.use().filter((o) => o.st === "pending" || o.st === "revising").sort((a, b) => +!!b.rev - +!!a.rev || a.at.localeCompare(b.at)), loading: false, error: null });
export const useManageOrders = (): Rows<AdminOrder> => (LIVE ? rows(live.manage.use()) : { rows: adminOrders.use(), loading: false, error: null });
/** `pollMs` keeps 报错处理 fresh: an error clears when the printer reports it recovered, not when someone clicks. */
export const useTasks = (pollMs?: number): Rows<Task> => (LIVE ? rows(live.todo.use(pollMs)) : { rows: tasks.use(), loading: false, error: null });

/** Navigation badges and 概况 numbers; cheap and not audited, so it polls. */
export function useCounts(): { pending: number; todo: number; stats: OverviewStats | null } {
  if (!LIVE) {
    const pending = adminOrders.use().filter((o) => o.st === "pending" || o.st === "revising").length;
    return { pending, todo: tasks.use().length, stats: null };
  }
  const s = live.overview.use(30e3).data;
  return { pending: s?.pendingReview ?? 0, todo: s?.todo ?? 0, stats: s };
}

/* ---------- actions ---------- */

type Done = Res<null>;
const ok: Done = { ok: true, data: null };
const json = (method: string, body?: unknown) => ({ method, json: body });

/** Reloads whatever the action may have changed, including the badges. */
async function after<T>(r: Res<T>, ...which: (keyof typeof live)[]): Promise<Res<T>> {
  await Promise.all([...which, "overview" as const].map((k) => live[k].refresh()));
  return r;
}

const updateAdmin = (id: number, f: (o: AdminOrder) => Partial<AdminOrder>) => adminOrders.set((s) => s.map((o) => (o.id === id ? { ...o, ...f(o) } : o)));

export const ordersApi = {
  async detail(id: number): Promise<Res<OrderDetail>> {
    return api<OrderDetail>(`/api/orders/${id}`);
  },

  async cancelMine(id: number, reason: string): Promise<Done> {
    if (!LIVE) {
      myOrders.set((s) => s.map((x) => (x.id === id ? { ...x, st: "cancelled", reason: "你取消了：" + reason } : x)));
      return ok;
    }
    return after(await api<null>(`/api/orders/${id}/cancel`, json("POST", { reason })), "mine");
  },

  /** 撤回修改: free; back to the last approved version in the same place. */
  async withdraw(id: number): Promise<Done> {
    if (!LIVE) {
      myOrders.set((s) =>
        s.map((x) => {
          if (x.id !== id || !x.vers) return x;
          const back = [...x.vers].reverse().find((v) => v.st === "已通过" || v.st === "当前")!;
          const vers = x.vers.map((v): Version => (v.st === "审核中" ? { ...v, st: "已撤回" } : v.n === back.n ? { ...v, st: "当前" } : v));
          return { ...x, vers, file: back.file, model: back.model, nozzle: back.nozzle, time: back.time, g: back.g, fil: back.fil, st: "queued", canWithdraw: false, revs: Math.max(0, (x.revs ?? 1) - 1) };
        }),
      );
      return ok;
    }
    return after(await api<null>(`/api/orders/${id}/withdraw`, json("POST")), "mine", "review", "manage");
  },

  /** 恢复: an approved version comes back as a new one (counts as a revision, no review). */
  async restore(id: number, n: number, placesBack: number | "tail"): Promise<Done> {
    if (!LIVE) {
      myOrders.set((s) =>
        s.map((x) => {
          if (x.id !== id || !x.vers) return x;
          const v = x.vers.find((y) => y.n === n)!;
          const next = Math.max(...x.vers.map((y) => y.n)) + 1;
          const vers: Version[] = [...x.vers.map((y): Version => (y.st === "当前" ? { ...y, st: "已通过" } : y)), { ...v, n: next, st: "当前", from: n, at: fmtAt(new Date().toISOString()) }];
          const pos = x.pos == null ? x.pos : placesBack === "tail" ? x.pos : x.pos + placesBack;
          return { ...x, vers, file: v.file, model: v.model, nozzle: v.nozzle, time: v.time, g: v.g, fil: v.fil, revs: (x.revs ?? 0) + 1, pos };
        }),
      );
      return ok;
    }
    return after(await api<null>(`/api/orders/${id}/versions/${n}/restore`, json("POST")), "mine", "manage");
  },

  /** 版本记录 of one order: from the order detail in real builds. */
  async versions(id: number): Promise<Res<Version[]>> {
    if (!LIVE) return { ok: true, data: myOrders.get().find((x) => x.id === id)?.vers ?? [] };
    return mapRes(api<OrderDetail>(`/api/orders/${id}`), toVersions);
  },

  async versionFileUrl(id: number, n: number): Promise<Res<{ url: string }>> {
    return api<{ url: string }>(`/api/orders/${id}/versions/${n}/file`);
  },

  /** 修改文件: a new version of the order's plate; `plate` picks it in a multi-plate file. */
  async revise(id: number, file: File, plate?: number): Promise<Res<OrderView>> {
    const body = new FormData();
    body.append("file", file);
    if (plate != null) body.append("plate", String(plate));
    const r = await api<OrderView>(`/api/orders/${id}/revise`, { method: "POST", body });
    return after(r, "mine", "review", "manage");
  },

  async approve(id: number): Promise<Done> {
    if (!LIVE) return updateAdmin(id, () => ({ st: "queued", note: "", rev: undefined })), ok;
    return after(await api<null>(`/api/orders/${id}/approve`, json("POST")), "review", "manage");
  },

  async reject(id: number, reason: string): Promise<Done> {
    /* a rejected revision falls back to the version before it and keeps queueing */
    if (!LIVE) return updateAdmin(id, (o) => (o.rev ? { st: "queued", file: o.rev.file, model: o.rev.model, time: o.rev.time, g: o.rev.g, fil: o.rev.fil, rev: undefined } : { st: "rejected", note: reason })), ok;
    return after(await api<null>(`/api/orders/${id}/reject`, json("POST", { reason })), "review", "manage");
  },

  async cancelAny(id: number, reason: string): Promise<Done> {
    if (!LIVE) return updateAdmin(id, () => ({ st: "cancelled", note: "管理员取消：" + reason })), ok;
    return after(await api<null>(`/api/orders/${id}/cancel`, json("POST", { reason })), "manage", "todo");
  },

  async attribute(id: number, attribution: FailureAttribution): Promise<Res<{ retry: number | null }>> {
    if (!LIVE) {
      updateAdmin(id, (o) => ({ note: (o.note ?? "") + " · 归因：" + ATTR_LABEL[attribution], attributed: true }));
      return { ok: true, data: { retry: null } };
    }
    const r = await mapRes(api<{ retry: OrderView }>(`/api/orders/${id}/attribute`, json("POST", { attribution })), (x) => ({ retry: x.retry.id }));
    return after(r, "manage");
  },

  /** Moves a queued order to a 1-based place. */
  async reorder(id: number, toPosition: number): Promise<Done> {
    if (!LIVE) return ok;
    return after(await api<null>("/api/queue/reorder", json("POST", { orderId: id, toPosition })), "manage");
  },

  async fileUrl(id: number): Promise<Res<{ url: string }>> {
    return api<{ url: string }>(`/api/orders/${id}/file`);
  },

  /* 待办 */

  async store(t: Task, slot: string, photo: File | null): Promise<Done> {
    if (!LIVE) return tasks.set((s) => s.filter((x) => x.id !== t.id)), ok;
    if (!photo) return { ok: false, error: { code: "bad-photo", message: "要拍一张入库照片" } };
    const body = new FormData();
    body.append("photo", photo);
    body.append("slot", slot);
    body.append("bedCleared", "true");
    return after(await upload(`/api/orders/${t.order}/store`, body), "todo");
  },

  /** Sends one of the error's own actions; the task stays until the printer reports it recovered. */
  async resolve(t: Task, action: string): Promise<Done> {
    /* the mock printer recovers a moment later */
    if (!LIVE) return setTimeout(() => tasks.set((s) => s.filter((x) => x.id !== t.id)), 2400), ok;
    return after(await api<null>(`/api/printers/${t.printerId}/resolve`, json("POST", { action })), "todo");
  },

  async stop(t: Task, reason: string): Promise<Res<{ commandSent: boolean }>> {
    if (!LIVE) return tasks.set((s) => s.filter((x) => x.id !== t.id)), { ok: true, data: { commandSent: true } };
    return after(await api<{ commandSent: boolean }>(`/api/printers/${t.printerId}/stop`, json("POST", { reason })), "todo");
  },

  async clearBed(t: Task): Promise<Done> {
    if (!LIVE) return tasks.set((s) => s.filter((x) => x.id !== t.id)), ok;
    return after(await api<null>(`/api/printers/${t.printerId}/clear-bed`, json("POST")), "todo");
  },
};

/** multipart POST with the same error handling as api(). */
export function upload<T = null>(url: string, body: FormData): Promise<Res<T>> {
  return api<T>(url, { method: "POST", body });
}

export type { ApiErr };
