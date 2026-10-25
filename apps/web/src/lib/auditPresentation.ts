import type { AuditLogView } from "@platerelay/shared";

export const AUDIT_ACTIONS: readonly { value: string; label: string }[] = [
  { value: "auth.login", label: "登录账户" },
  { value: "auth.logout", label: "退出登录" },
  { value: "user.create", label: "创建账户" },
  { value: "user.role", label: "修改账户角色" },
  { value: "user.enable", label: "启用账户" },
  { value: "user.disable", label: "停用账户" },
  { value: "order.view", label: "查看订单" },
  { value: "order.preview.view", label: "获取模型预览链接" },
  { value: "order.file.download", label: "下载打印文件" },
  { value: "order.submit", label: "提交订单" },
  { value: "order.approve", label: "通过订单审核" },
  { value: "order.reject", label: "驳回订单" },
  { value: "order.cancel", label: "取消订单" },
  { value: "order.attribute", label: "记录失败归因并创建重打订单" },
  { value: "order.store", label: "铲件入库" },
  { value: "order.redeem", label: "核销取件" },
  { value: "order.dispatch", label: "自动派单" },
  { value: "order.dispatch.failed", label: "派单发送失败并返回队列" },
  { value: "pickup.issue", label: "签发取件码" },
  { value: "queue.reorder", label: "调整排队顺序" },
  { value: "printer.create", label: "添加打印机" },
  { value: "printer.update", label: "修改打印机信息" },
  { value: "printer.delete", label: "删除打印机" },
  { value: "printer.maintenance.on", label: "下线维护" },
  { value: "printer.maintenance.off", label: "结束维护并上线" },
  { value: "printer.star", label: "修改打印机收藏" },
  { value: "printer.error.resolve", label: "处理打印机报错" },
  { value: "printer.stop", label: "停止打印并记录失败" },
  { value: "printer.stop.command", label: "发送停止指令" },
  { value: "printer.clear-bed", label: "确认热床已清理" },
  { value: "printer.started", label: "打印机上报开始打印" },
  { value: "printer.error", label: "打印机上报故障" },
  { value: "printer.resumed", label: "打印机上报恢复打印" },
  { value: "printer.finished", label: "打印机上报打印完成" },
  { value: "printer.prepare-failed", label: "打印准备失败并返回队列" },
  { value: "form.update", label: "修改申请表单" },
  { value: "daemon.create", label: "添加守护进程" },
  { value: "daemon.enable", label: "启用守护进程" },
  { value: "daemon.disable", label: "停用守护进程" },
  { value: "daemon.delete", label: "删除守护进程" },
  { value: "settings.update", label: "修改系统设置" },
  { value: "audit.view", label: "查看操作记录" },
  { value: "修改角色", label: "修改角色（原型设置）" },
  { value: "修改策略", label: "修改策略（原型设置）" },
  { value: "修改通知设置", label: "修改通知（原型设置）" },
  { value: "生成守护进程 token", label: "生成守护进程凭据（原型设置）" },
  { value: "吊销守护进程 token", label: "吊销守护进程凭据（原型设置）" },
];

export const AUDIT_TARGETS: readonly { value: string; label: string }[] = [
  { value: "order", label: "订单" },
  { value: "printer", label: "打印机" },
  { value: "user", label: "账户" },
  { value: "daemon", label: "守护进程" },
  { value: "form", label: "申请表单" },
  { value: "setting", label: "系统设置" },
];

const actionLabels = new Map(AUDIT_ACTIONS.map(({ value, label }) => [value, label]));
const targetLabels = new Map(AUDIT_TARGETS.map(({ value, label }) => [value, label]));
const roles: Record<string, string> = { user: "选手", staff: "现场工作人员", builder: "打印负责人", coreteam: "核心组" };
const actorLabels: Record<string, string> = { user: "账户", system: "系统", daemon: "守护进程", printer: "打印机" };
const resultLabels: Record<string, string> = { ok: "成功", failed: "失败", denied: "权限不足" };
const statusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", REJECTED: "已驳回", QUEUED: "排队中", PRINTING: "打印中",
  PRINTED_AWAITING_STORAGE: "待铲件入库", STORED_READY_PICKUP: "待取件", COMPLETED: "已取件",
  FAILED: "打印失败", CANCELLED: "已取消",
};
const stateLabels: Record<string, string> = {
  OFFLINE: "离线", IDLE: "空闲", PREPARING: "准备中", PRINTING: "打印中", ERROR_PAUSED: "报错待处理",
  CLEARING_REQUIRED: "待清理热床", UNMANAGED_PRINTING: "外部任务打印中", MAINTENANCE: "维护中",
};
const commandLabels: Record<string, string> = {
  STOP: "停止打印", RESUME: "继续打印", RESUME_ACCEPT_DEFECTS: "接受瑕疵并继续",
  RESUME_PROBLEM_SOLVED: "问题已解决，继续打印", RETRY: "重试", CONFIRM_DONE: "确认已处理",
  IGNORE: "忽略报错", ACKNOWLEDGE: "确认报错",
};
const fieldTypes: Record<string, string> = { text: "单行文本", textarea: "多行文本", single: "单选", multi: "多选", number: "数字" };
const reasons: Record<string, string> = {
  "missing-permission": "当前账户没有执行该操作的权限", "not-owner": "只能为自己的订单签发取件码",
  "printer-unreachable": "无法连接打印机的守护进程", "command-failed": "打印机指令调用失败",
  "send-failed": "打印任务发送失败", "pickup-code-invalid": "取件码无效或已失效，请重新出示",
  "pickup-code-expired": "取件码已过期，请重新出示", "pickup-already-redeemed": "这张订单已经核销取件",
  "order-not-ready": "订单尚未入库，暂时不能取件",
};
const settingLabels: Record<string, string> = { "auth.registration": "开放账户注册", "queue.policy": "排队策略" };
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const permission = /\b[a-z][a-z-]*(?::[a-z][a-z-]*)+\b/g;
const routeAction = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i;
const hasChinese = /[\u3400-\u9fff]/;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function knownLabel(labels: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}

function text(value: string): string {
  if (!value.length) return "空";
  if (/^\s*[\[{]/.test(value)) return "系统未提供可读说明";
  return value
    .replace(uuid, "（内部标识已隐藏）")
    .replace(permission, "（权限信息已隐藏）")
    .replace(/auth\.registration/g, "开放账户注册")
    .replace(/queue\.policy/g, "排队策略")
    .replace(/\btoken\b/gi, "凭据");
}

function actionLabel(action: string): string {
  if (routeAction.test(action)) return "访问受限功能";
  return actionLabels.get(action) ?? (hasChinese.test(action) ? text(action) : "其他操作");
}

function orderNumber(value: unknown): string | null {
  const id = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) >= 0 ? `#${id}` : null;
}

export function auditAction(row: AuditLogView): string {
  if (row.action === "printer.star") {
    const starred = record(row.after).starred;
    if (starred === true) return "收藏打印机";
    if (starred === false) return "取消收藏";
  }
  return actionLabel(row.action);
}

export function auditActor(row: AuditLogView): string {
  if (row.actorType === "user") return row.actor?.name || "未知账户";
  if (row.actorType === "system" && row.action.startsWith("order.dispatch")) return "自动调度";
  return knownLabel(actorLabels, row.actorType) ?? "系统";
}

export function auditTarget(row: AuditLogView): string {
  if (row.action === "audit.view") return "审计日志";
  const name = row.target?.name;
  if (name && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)) {
    if (knownLabel(settingLabels, name)) return settingLabels[name];
    if (!(row.targetType === "setting" && (name === row.targetId || /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/i.test(name)))) return name;
  }
  if (row.targetType === "order") return orderNumber(row.targetId) ?? "订单";
  return targetLabels.get(row.targetType ?? "") ?? "相关对象";
}

export function auditRole(role: string | null): string {
  return role ? knownLabel(roles, role.toLowerCase()) ?? text(role) : "未记录";
}

export function auditReason(row: AuditLogView): string | null {
  if (row.reason == null) return null;
  if (/^缺少权限(?:\s|$)/.test(row.reason)) return reasons["missing-permission"];
  if (knownLabel(reasons, row.reason)) return reasons[row.reason];
  // Stable machine codes are not useful explanations; free-form operator notes are.
  if (/^[a-zA-Z][a-zA-Z0-9]*(?:[-_.:][a-zA-Z0-9]+)+$/.test(row.reason) || /^[A-Z][A-Z0-9_]+$/.test(row.reason)) return "系统未提供可读原因";
  if (["printer.prepare-failed", "printer.error.resolve", "printer.stop.command", "order.dispatch.failed"].includes(row.action) && !hasChinese.test(row.reason)) return "系统未提供可读原因";
  return text(row.reason);
}

type Change = { label: string; before: string | null; after: string | null };
type Renderer = (value: unknown) => string | null;
type Field = { key: string; label: string; render: Renderer };

function scalar(value: unknown): string | null {
  if (value == null) return "未记录";
  if (typeof value === "string") return text(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function enumValue(labels: Record<string, string>, fallback: string): Renderer {
  return (value) => value == null ? "未记录" : value === "" ? "空" : typeof value === "string" ? knownLabel(labels, value) ?? fallback : null;
}

function booleanValue(yes: string, no: string): Renderer {
  return (value) => value == null ? "未记录" : value === "" ? "空" : value === true ? yes : value === false ? no : null;
}

function numeric(unit: string, prefix = ""): Renderer {
  return (value) => value == null ? "未记录" : value === "" ? "空" : typeof value === "number" && Number.isFinite(value) ? `${prefix}${value}${unit}` : null;
}

const date: Renderer = (value) => {
  if (value == null) return "未记录";
  if (value === "") return "空";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "未记录" : timestamp.toLocaleString("zh-CN", { hour12: false });
};
const order: Renderer = (value) => value == null ? "未记录" : value === "" ? "空" : orderNumber(value);
const role: Renderer = (value) => value == null ? "未记录" : value === "" ? "空" : typeof value === "string" ? auditRole(value) : null;
const status: Field = { key: "status", label: "订单状态", render: enumValue(statusLabels, "未识别的订单状态") };
const state: Field = { key: "state", label: "打印机状态", render: enumValue(stateLabels, "未识别的打印机状态") };
const orderId: Field = { key: "orderId", label: "关联订单", render: order };
const roleField: Field = { key: "role", label: "账户角色", render: role };
const printerDetails: Field[] = [
  { key: "name", label: "打印机名称", render: scalar },
  { key: "ip", label: "网络地址", render: scalar },
  { key: "serial", label: "设备序列号", render: scalar },
];
const command: Field = { key: "command", label: "设备指令", render: enumValue(commandLabels, "其他设备指令") };
const errorAction: Field = { key: "action", label: "报错处理方式", render: enumValue(commandLabels, "其他处理方式") };

// Only fields emitted by these business operations are eligible for presentation.
const actionFields: Record<string, readonly Field[]> = {
  "user.create": [roleField], "user.role": [roleField],
  "user.enable": [{ key: "disabled", label: "账户状态", render: booleanValue("已停用", "已启用") }],
  "user.disable": [{ key: "disabled", label: "账户状态", render: booleanValue("已停用", "已启用") }],
  "order.submit": [{ key: "plate", label: "打印板", render: numeric(" 盘", "第 ") }],
  "order.approve": [status], "order.reject": [status], "order.cancel": [status],
  "order.attribute": [
    { key: "attribution", label: "失败归因", render: enumValue({ machine: "设备原因", model: "模型或切片原因" }, "未识别的归因") },
    { key: "retry", label: "重打订单", render: order },
  ],
  "order.store": [status, { key: "slot", label: "存放格位", render: scalar }],
  "order.redeem": [status], "order.dispatch.failed": [status],
  "pickup.issue": [{ key: "expiresAt", label: "取件码有效期至", render: date }],
  "queue.reorder": [{ key: "position", label: "队列位置", render: numeric(" 位", "第 ") }],
  "printer.create": printerDetails, "printer.update": printerDetails, "printer.delete": printerDetails,
  "printer.maintenance.on": [state], "printer.maintenance.off": [state],
  "printer.star": [{ key: "starred", label: "收藏状态", render: booleanValue("已收藏", "未收藏") }],
  "printer.error.resolve": [errorAction], "printer.stop.command": [command],
  "printer.stop": [orderId, status, errorAction], "printer.clear-bed": [orderId],
  "printer.started": [state, orderId], "printer.finished": [state, orderId],
  "printer.error": [orderId], "printer.prepare-failed": [orderId],
  "printer.resumed": [{ key: "pausedMs", label: "报错暂停时长", render: (value) => value == null ? "未记录" : value === "" ? "空" : typeof value === "number" && Number.isFinite(value) ? `${value / 1000} 秒` : null }],
  "daemon.create": [{ key: "name", label: "守护进程名称", render: scalar }, { key: "network", label: "所在网络", render: scalar }],
  "daemon.delete": [{ key: "name", label: "守护进程名称", render: scalar }],
  "daemon.enable": [{ key: "enabled", label: "守护进程状态", render: booleanValue("已启用", "已停用") }],
  "daemon.disable": [{ key: "enabled", label: "守护进程状态", render: booleanValue("已启用", "已停用") }],
};

function changesFor(before: unknown, after: unknown, fields: readonly Field[]): Change[] {
  const old = record(before);
  const next = record(after);
  const changes: Change[] = [];
  for (const field of fields) {
    const hasBefore = Object.hasOwn(old, field.key);
    const hasAfter = Object.hasOwn(next, field.key);
    if (!hasBefore && !hasAfter) continue;
    const a = hasBefore ? field.render(old[field.key]) : null;
    const b = hasAfter ? field.render(next[field.key]) : null;
    if (a !== b) changes.push({ label: field.label, before: a, after: b });
  }
  return changes;
}

function formField(value: unknown): string | null {
  const field = record(value);
  if (typeof field.label !== "string" || typeof field.type !== "string" || typeof field.required !== "boolean") return null;
  const parts = [`名称：${text(field.label)}`, `类型：${knownLabel(fieldTypes, field.type) ?? "其他字段类型"}`, field.required ? "必填" : "选填"];
  if (Array.isArray(field.options)) {
    const options = field.options.filter((option): option is string => typeof option === "string").map(text);
    parts.push(`选项：${options.length ? options.join("、") : "空"}`);
  }
  return parts.join("；");
}

function formChanges(before: unknown, after: unknown): Change[] {
  const old: unknown[] = Array.isArray(before) ? before : [];
  const next: unknown[] = Array.isArray(after) ? after : [];
  if (!old.length && !next.length) {
    const a = before == null ? "未记录" : Array.isArray(before) ? "空" : null;
    const b = after == null ? "未记录" : Array.isArray(after) ? "空" : null;
    return a !== b ? [{ label: "表单内容", before: a, after: b }] : [];
  }
  const changes: Change[] = [];
  for (let index = 0; index < Math.max(old.length, next.length); index++) {
    const a = index < old.length ? formField(old[index]) : null;
    const b = index < next.length ? formField(next[index]) : null;
    if (a !== b) changes.push({ label: `表单第 ${index + 1} 项`, before: a, after: b });
  }
  return changes;
}

const auditFilters: readonly Field[] = [
  { key: "actorName", label: "操作人姓名筛选", render: scalar },
  { key: "actorNameFiltered", label: "操作人姓名筛选", render: booleanValue("已按姓名筛选", "未按姓名筛选") },
  { key: "actorId", label: "操作账户筛选", render: (value) => typeof value === "string" && value ? "已指定账户" : value === "" ? "空" : value == null ? "未记录" : null },
  { key: "actorType", label: "操作来源筛选", render: enumValue(actorLabels, "其他来源") },
  { key: "action", label: "操作类型筛选", render: (value) => value == null ? "未记录" : typeof value === "string" ? actionLabel(value) : null },
  { key: "result", label: "操作结果筛选", render: enumValue(resultLabels, "其他结果") },
  { key: "targetType", label: "对象类型筛选", render: (value) => value == null ? "未记录" : typeof value === "string" ? targetLabels.get(value) ?? "其他对象" : null },
  { key: "from", label: "起始时间", render: date }, { key: "to", label: "结束时间", render: date },
  { key: "limit", label: "每页记录数", render: numeric(" 条") },
  { key: "beforeId", label: "翻页方式", render: (value) => typeof value === "number" ? "查看更早的记录" : null },
];

export function auditChanges(row: AuditLogView): Change[] {
  if (row.action === "form.update") return formChanges(row.before, row.after);
  if (row.action === "settings.update") {
    const fields: Field[] = row.targetId === "auth.registration"
      ? [{ key: "enabled", label: "开放账户注册", render: booleanValue("已开放", "已关闭") }]
      : row.targetId === "queue.policy"
        ? [{ key: "rule", label: "排队规则", render: enumValue({ fifo: "先到先得" }, "其他排队规则") }]
        : [];
    return changesFor(row.before, row.after, fields);
  }
  if (row.action === "audit.view") {
    const fields = [...auditFilters];
    const old = record(row.before);
    const next = record(row.after);
    if (old.targetType === "order" || next.targetType === "order") fields.push({ key: "targetId", label: "订单编号筛选", render: order });
    else fields.push({ key: "targetId", label: "操作对象筛选", render: (value) => typeof value === "string" && value ? "已指定对象" : value === "" ? "空" : value == null ? "未记录" : null });
    return changesFor(row.before, row.after, fields);
  }
  const fields = Object.hasOwn(actionFields, row.action) ? actionFields[row.action] : [];
  // Prototype audit descriptions are authored as human text, not arbitrary payloads.
  if (actionLabels.has(row.action)) {
    return changesFor(row.before, row.after, [...fields, {
      key: "description", label: "操作说明",
      render: (value) => value == null ? "未记录" : typeof value === "string"
        ? text(value).replace(/\b(?:User|Staff|Builder|Coreteam)\b/gi, (role) => roles[role.toLowerCase()])
        : null,
    }]);
  }
  return [];
}

export function auditNote(row: AuditLogView): string | null {
  if (row.action === "order.preview.view") return "已签发模型预览链接，不代表浏览器已读取图片。";
  if (row.action === "printer.stop.command") {
    if (row.result === "ok") return "停止指令调用已返回，不代表打印机已执行。";
    if (row.result === "failed") return "未能发送停止指令，业务处理结果保持不变。";
  }
  if (row.action === "order.dispatch") return "已完成本地派单，设备是否开打以状态上报为准。";
  return null;
}
