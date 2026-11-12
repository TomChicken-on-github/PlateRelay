/*
 * 权限节点和三个登录角色。代码只检查节点，不检查角色名；每个用户只有一个角色，
 * 角色有哪些节点写死在这张表里，不能给某个人单独加权限。访客不是角色，是没登录。
 */

export const PERMISSIONS = [
  "overview:view",
  "printer:camera:snapshot",
  "printer:camera:stream",
  /** 看别人的名字和头像。 */
  "order:submitter-name:view-others",
  /** 看概况页打印机卡片上正在打印的文件名。 */
  "overview:filename:view",
  "order:submit",
  "order:cancel:own",
  "order:skip-parts:own",
  /** 提交页的可用资源。 */
  "resource:view",
  /** 预计等待（还要设置里打开）。 */
  "queue:wait:view",
  /** 看所有订单的详情、文件名、申请者。 */
  "order:view:any",
  "order:skip-parts:any",
  /** 派单、确认映射。 */
  "order:dispatch",
  /** 重打；不重打、请选手重新提交。 */
  "order:reprint",
  /** 撤销"不重打"。 */
  "order:reprint:restore",
  /** 铲件入库、确认清板。 */
  "order:store",
  "order:redeem",
  /** 进打印机详情、看报错和事件日志、处理报错、人工判定、放出异常的打印机。 */
  "printer:operate",
  "printer:stop",
  /** 手动刷新机器状态。 */
  "printer:refresh",
  /** 设备控制。 */
  "printer:control",
  /** 挂上或去掉"维护"。 */
  "printer:maintenance",
  /** 编辑耗材目录、改槽位克数。 */
  "filament:catalog",
  "order:review",
  /** 拖拽调整排队顺序。 */
  "order:reorder",
  "order:cancel:any",
  /** 把长期未取的订单标为已处置。 */
  "order:dispose",
  /** 添加、编辑、停用、删除打印机。 */
  "printer:manage",
  /** 开放给选手开关、映射规则。 */
  "resource:configure",
  "form:configure",
  "user:manage",
  "daemon:manage",
  "settings:manage",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["APPLICANT", "STAFF", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

const APPLICANT: Permission[] = [
  "overview:view",
  "printer:camera:snapshot",
  "printer:camera:stream",
  "order:submitter-name:view-others",
  "overview:filename:view",
  "order:submit",
  "order:cancel:own",
  "order:skip-parts:own",
  "resource:view",
  "queue:wait:view",
];

const STAFF: Permission[] = [
  ...APPLICANT,
  "order:view:any",
  "order:skip-parts:any",
  "order:dispatch",
  "order:reprint",
  "order:store",
  "order:redeem",
  "printer:operate",
  "printer:stop",
  "printer:refresh",
  "printer:control",
  "printer:maintenance",
  "filament:catalog",
];

/** 管理员有现场人员的全部权限，再加审核、排序和所有配置。 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  APPLICANT,
  STAFF,
  ADMIN: PERMISSIONS,
};

/** 没登录的人在"概况页公开"打开时能做的事；实况和文件名另有各自的开关。 */
export const GUEST_PERMISSIONS: readonly Permission[] = ["overview:view", "printer:camera:snapshot", "order:submitter-name:view-others"];

export const isPermission = (s: string): s is Permission => (PERMISSIONS as readonly string[]).includes(s);
export const isRole = (s: string): s is Role => (ROLES as readonly string[]).includes(s);
