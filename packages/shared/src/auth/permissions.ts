/*
 * Permission nodes. Code checks nodes, never role names; the four roles are
 * preset bundles of nodes (brief §0.3, §5.4). Editing PRESET_ROLES and
 * restarting the panel is how permissions change in the first phase.
 */

export const PERMISSIONS = [
  "overview:view",
  "printer:camera:snapshot",
  "printer:camera:stream",
  /** See other submitters' names and avatars; without it they show as "选手 A12". */
  "order:submitter-name:view-others",
  "order:submit",
  "order:cancel:own",
  /** 本场可用资源 on the submit page. */
  "resource:view",
  /** 预计等待 in that table (also needs the setting on). */
  "queue:wait:view",
  /** Read any order's detail, answers and file. */
  "order:view:any",
  /** Cancel any unfinished order, printing ones included. */
  "order:cancel:any",
  /** Skip parts of a running print: own orders, or any order. Sends a command to the printer. */
  "order:skip-parts:own",
  "order:skip-parts:any",
  "order:review",
  "order:reorder",
  /** 失败归因: decide why a failed order failed, which spawns the retry. */
  "order:attribute",
  /** 铲件入库 and confirming a bed is clear. */
  "order:store",
  "order:redeem",
  /** Send a queued order to an idle printer: the suggestion or any other it can take (no automatic dispatch). */
  "order:dispatch",
  /** See printer error details and resolve them (continue, ignore…). */
  "printer:operate",
  /** Stop a print; the stopped order fails with the chosen reason. */
  "printer:stop",
  /** Add, edit and remove printers; take them in and out of maintenance. */
  "printer:manage",
  "form:configure",
  /** 系统设置 → 可用资源: hide, sort and annotate rows, stock filaments. */
  "resource:configure",
  "user:manage",
  "daemon:manage",
  "settings:manage",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_IDS = ["user", "staff", "builder", "coreteam"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

const USER: Permission[] = [
  "overview:view",
  "printer:camera:snapshot",
  "printer:camera:stream",
  "order:submitter-name:view-others",
  "order:submit",
  "order:cancel:own",
  "resource:view",
  "queue:wait:view",
  "order:skip-parts:own",
];

const STAFF: Permission[] = [...USER, "order:skip-parts:any", "order:store", "order:redeem", "order:dispatch", "printer:operate", "printer:stop"];

export const PRESET_ROLES: Record<RoleId, { name: string; permissions: readonly Permission[] }> = {
  user: { name: "User", permissions: USER },
  staff: { name: "Staff", permissions: STAFF },
  /* Builder and Coreteam hold the same nodes; kept apart so the audit log tells them apart. */
  builder: { name: "Builder", permissions: PERMISSIONS },
  coreteam: { name: "Coreteam", permissions: PERMISSIONS },
};

export const isPermission = (s: string): s is Permission => (PERMISSIONS as readonly string[]).includes(s);
