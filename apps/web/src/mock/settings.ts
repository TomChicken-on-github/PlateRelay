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
    ["10-24 12:31", "赵乐", "下线打印机", "X2D-02 · 日常保养"], ["10-24 11:58", "赵乐", "驳回订单", "#1056 · 壁厚过薄"], ["10-24 11:40", "陈一帆", "铲件入库", "#1045 · A-2-3"],
    ["10-24 11:12", "赵乐", "调整排队顺序", "#1052 从第 3 位到第 1 位"], ["10-24 10:55", "Admin", "修改角色", "周浩然 User → Staff"], ["10-24 10:20", "陈一帆", "核销取件", "#1046 · Tom_Chicken"],
  ] as [string, string, string, string][],
});

/* Shown once. Only the last four characters are kept afterwards. */
export const genToken = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return "plr_" + [...a].map((x) => "abcdefghijklmnopqrstuvwxyz234567"[x % 32]).join("");
};
