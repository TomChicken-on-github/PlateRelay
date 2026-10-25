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
  /** Read any order's detail, answers and file. */
  "order:view:any",
  /** Cancel any unfinished order, printing ones included. */
  "order:cancel:any",
  "order:review",
  "order:reorder",
  /** 失败归因: decide why a failed order failed, which spawns the retry. */
  "order:attribute",
  /** 铲件入库 and confirming a bed is clear. */
  "order:store",
  "order:redeem",
  /** See printer error details and resolve them (continue, ignore…). */
  "printer:operate",
  /** Stop a print; the stopped order fails with the chosen reason. */
  "printer:stop",
  /** Add, edit and remove printers; take them in and out of maintenance. */
  "printer:manage",
  "form:configure",
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
];

const STAFF: Permission[] = [...USER, "order:store", "order:redeem", "printer:operate", "printer:stop"];

export const PRESET_ROLES: Record<RoleId, { name: string; permissions: readonly Permission[] }> = {
  user: { name: "User", permissions: USER },
  staff: { name: "Staff", permissions: STAFF },
  /* Builder and Coreteam hold the same nodes; kept apart so the audit log tells them apart. */
  builder: { name: "Builder", permissions: PERMISSIONS },
  coreteam: { name: "Coreteam", permissions: PERMISSIONS },
};

export const isPermission = (s: string): s is Permission => (PERMISSIONS as readonly string[]).includes(s);
