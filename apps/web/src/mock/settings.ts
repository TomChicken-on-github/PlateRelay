import type { AuditLogView } from "@platerelay/shared";
import { createStore } from "../lib/store";

export const ROLES = ["User", "Staff", "Builder", "Coreteam"] as const;
export const FIELD_TYPES = ["单行文本", "多行文本", "单选", "多选"];

export type FormField = { id: number; name: string; type: string; req: boolean };
export type Daemon = { id: number; name: string; net: string; seen: string; on: boolean; tail: string };

export const settings = createStore({
  fields: [
    { id: 1, name: "打印用途", type: "多行文本", req: true },
    { id: 2, name: "所属队伍", type: "单选", req: true },
    { id: 3, name: "备注", type: "单行文本", req: false },
  ] as FormField[],
  users: [
    { n: "Tom_Chicken", role: "Builder" }, { n: "赵乐", role: "Builder" }, { n: "陈一帆", role: "Staff" },
    { n: "林小满", role: "User" }, { n: "周浩然", role: "User" }, { n: "王雨桐", role: "User" }, { n: "Admin", role: "Coreteam" },
  ] as { n: string; role: string }[],
  daemons: [
    { id: 1, name: "场馆 A 区边缘节点", net: "192.168.0.0/24", seen: "刚刚", on: true, tail: "9f3a" },
    { id: 2, name: "场馆 B 区边缘节点", net: "192.168.1.0/24", seen: "2 分钟前", on: true, tail: "71c2" },
    { id: 3, name: "测试机房", net: "10.0.5.0/24", seen: "3 天前", on: false, tail: "b04e" },
  ] as Daemon[],
  policy: { size: "200", rule: "FIFO（先到先得）" },
  notify: { mail: true, fs: true, fsMode: "直接调用飞书机器人", hook: "https://open.feishu.cn/open-apis/bot/v2/hook/••••••••" },
  /* audit entries never carry a token, access code or other secret */
  audit: [
    { id: 6, at: "2026-10-24T04:31:00.000Z", actorId: "00000000-0000-4000-8000-000000000002", actor: { id: "00000000-0000-4000-8000-000000000002", name: "赵乐", role: "Builder" }, action: "printer.maintenance.on", targetType: "printer", targetId: null, target: { name: "X2D-02" }, after: { description: "日常保养" } },
    { id: 5, at: "2026-10-24T03:58:00.000Z", actorId: "00000000-0000-4000-8000-000000000002", actor: { id: "00000000-0000-4000-8000-000000000002", name: "赵乐", role: "Builder" }, action: "order.reject", targetType: "order", targetId: "1056", target: { name: "订单 #1056" }, after: { description: "壁厚过薄" } },
    { id: 4, at: "2026-10-24T03:40:00.000Z", actorId: "00000000-0000-4000-8000-000000000003", actor: { id: "00000000-0000-4000-8000-000000000003", name: "陈一帆", role: "Staff" }, action: "order.store", targetType: "order", targetId: "1045", target: { name: "订单 #1045" }, after: { slot: "A-2-3" } },
    { id: 3, at: "2026-10-24T03:12:00.000Z", actorId: "00000000-0000-4000-8000-000000000002", actor: { id: "00000000-0000-4000-8000-000000000002", name: "赵乐", role: "Builder" }, action: "queue.reorder", targetType: "order", targetId: "1052", target: { name: "订单 #1052" }, before: { position: 3 }, after: { position: 1 } },
    { id: 2, at: "2026-10-24T02:55:00.000Z", actorId: "00000000-0000-4000-8000-000000000004", actor: { id: "00000000-0000-4000-8000-000000000004", name: "Admin", role: "Coreteam" }, action: "user.role", targetType: "user", targetId: null, target: { name: "周浩然" }, before: { role: "user" }, after: { role: "staff" } },
    { id: 1, at: "2026-10-24T02:20:00.000Z", actorId: "00000000-0000-4000-8000-000000000003", actor: { id: "00000000-0000-4000-8000-000000000003", name: "陈一帆", role: "Staff" }, action: "order.redeem", targetType: "order", targetId: "1046", target: { name: "订单 #1046" }, after: { description: "Tom_Chicken 已取件" } },
  ].map((row): AuditLogView => ({ ...row, actorType: "user", before: row.before ?? null, reason: null, result: "ok", ip: null, device: null })),
});

/* Shown once. Only the last four characters are kept afterwards. */
export const genToken = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return "plr_" + [...a].map((x) => "abcdefghijklmnopqrstuvwxyz234567"[x % 32]).join("");
};
