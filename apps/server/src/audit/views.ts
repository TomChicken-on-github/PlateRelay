import type { AuditLogView } from "@platerelay/shared";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/db.js";
import { auditLog, daemons, files, orders, orderVersions, printers } from "../db/schema.js";
import { shownVersion } from "../orders/rows.js";
import { loadPeople } from "../orders/views.js";

type AuditRow = typeof auditLog.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string | null): id is string => id !== null && UUID.test(id);

function orderId(id: string | null): number | null {
  if (!id || !/^[0-9]+$/.test(id)) return null;
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function snapshotName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("name" in snapshot)) return null;
  const name = typeof snapshot.name === "string" ? snapshot.name.trim() : "";
  return name && !UUID.test(name) ? name : null;
}

/** Resolve only display fields in batches; audit targets are unconstrained historical text. */
export async function auditViews(db: Db, rows: AuditRow[]): Promise<AuditLogView[]> {
  const targetIds = (type: string) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId).filter(isUuid).map((id) => id.toLowerCase()))];
  const printerIds = targetIds("printer");
  const daemonIds = targetIds("daemon");
  const orderIds = [...new Set(rows.filter((r) => r.targetType === "order").map((r) => orderId(r.targetId))
    // orders.id is PostgreSQL serial (int4), not an arbitrary JavaScript integer.
    .filter((id): id is number => id !== null && id <= 2147483647))];
  const [people, printerRows, daemonRows, orderRows] = await Promise.all([
    loadPeople(db, [...rows.filter((r) => r.actorType === "user").map((r) => r.actorId).filter(isUuid), ...targetIds("user")]),
    printerIds.length ? db.select({ id: printers.id, name: printers.name }).from(printers).where(inArray(printers.id, printerIds)) : [],
    daemonIds.length ? db.select({ id: daemons.id, name: daemons.name }).from(daemons).where(inArray(daemons.id, daemonIds)) : [],
    orderIds.length ? db.select({ id: orders.id, fileName: files.fileName }).from(orders).leftJoin(orderVersions, shownVersion).leftJoin(files, eq(files.id, orderVersions.fileId)).where(inArray(orders.id, orderIds)) : [],
  ]);
  const printerNames = new Map(printerRows.map((r) => [r.id, r.name]));
  const daemonNames = new Map(daemonRows.map((r) => [r.id, r.name]));
  const orderNames = new Map(orderRows.map((r) => [r.id, r.fileName]));
  const target = (row: AuditRow): AuditLogView["target"] => {
    switch (row.targetType) {
      case null: return null;
      case "printer": return { name: printerNames.get(row.targetId?.toLowerCase() ?? "") ?? snapshotName(row.after) ?? snapshotName(row.before) ?? "打印机（名称未记录）" };
      case "daemon": return { name: daemonNames.get(row.targetId?.toLowerCase() ?? "") ?? snapshotName(row.after) ?? snapshotName(row.before) ?? "守护进程（名称未记录）" };
      case "user": return { name: isUuid(row.targetId) ? people.get(row.targetId.toLowerCase())!.name : "账户（名称未记录）" };
      case "order": {
        const id = orderId(row.targetId);
        const fileName = id === null ? null : orderNames.get(id);
        return { name: id === null ? "订单（编号未记录）" : `订单 #${id}${fileName ? ` · ${fileName}` : ""}` };
      }
      case "setting": return { name: row.targetId === "auth.registration" ? "账户注册设置" : row.targetId === "queue.policy" ? "排队策略" : "系统设置" };
      case "form": return { name: "申请表单" };
      default: return { name: "业务记录" };
    }
  };
  const actorNames = { system: "系统", daemon: "守护进程", printer: "打印机" } as const;
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actorType: row.actorType,
    actorId: row.actorId,
    actor: row.actorType === "user" ? people.get(row.actorId) : { id: row.actorId, name: actorNames[row.actorType], role: null },
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    target: target(row),
    before: row.before,
    after: row.after,
    reason: row.reason,
    result: row.result,
    ip: row.ip,
    device: row.device,
  }));
}
