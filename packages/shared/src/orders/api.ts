import type { ParsedPlate, ParsedUpload } from "../gcode3mf/api.js";
import type { AccessCodeState } from "../printers/access-code.js";
import type { ColourPref, PlateCheck, QueueRules } from "../rules/rules.js";
import type { FailureAttribution, OrderStatus, PrinterState } from "./status.js";

/*
 * JSON shapes of the panel's order, printer and settings endpoints, shared so
 * the web app reads exactly what apps/server sends. Times are ISO strings.
 */

/* ---- stored on rows, also part of the views ---- */

export interface OrderNozzle {
  extruder: number;
  side: "left" | "right" | null;
  diameter: number;
}

export interface OrderFilament {
  slot: number;
  type: string;
  color: string;
  usedGrams: number;
  extruder: number | null;
}

export type FormFieldType = "text" | "textarea" | "single" | "multi" | "number";

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
}

export interface AnswerSnapshot {
  fieldId: string;
  label: string;
  type: FormFieldType;
  value: string | string[] | number | null;
}

export interface ReportedNozzle {
  /** 1-based extruder, same numbering as the slicer. */
  extruder: number;
  diameter: number;
}

export interface ReportedStorage {
  medium: "internal" | "sd" | "usb";
  present: boolean;
  writable: boolean;
  freeBytes?: number;
}

/** A spool the printer reports as loaded (AMS tray or external spool). */
export interface ReportedTray {
  /** e.g. "AMS 1 · 2" or "外挂". */
  slot: string;
  type: string;
  /** #RRGGBB */
  color: string;
  /** Extruders this tray can feed (dual-nozzle printers); empty when any. */
  extruders?: number[];
}

export interface PrinterError {
  errorId: string;
  vendorCode: string;
  module?: string;
  message?: string;
  raisedAt: string;
  /** Standard actions the driver allows for this error (driver draft §6). */
  actions: string[];
}

/* ---- orders ---- */

export interface PersonView {
  id: string | null;
  name: string;
  role: string | null;
}

export interface OrderView {
  id: number;
  status: OrderStatus;
  /** PRINTING but the printer is paused on an error: shown as 等待处理. */
  waitingForHandler: boolean;
  fileName: string;
  sizeBytes: number;
  /** Plates of one upload share this. */
  sourceFileId: string;
  plate: { index: number; count: number; name: string };
  printerModel: string | null;
  printerModelId: string;
  nozzles: OrderNozzle[];
  filaments: OrderFilament[];
  printSeconds: number;
  weightGrams: number;
  thumbUrl: string | null;
  owner: PersonView;
  isMine: boolean;
  submittedAt: string;
  /** 1-based place among queued orders and the estimated print time ahead of it. */
  queue: { position: number; aheadSeconds: number } | null;
  waitReason: string | null;
  printer: { id: string; name: string; state: PrinterState } | null;
  progress: number | null;
  startedAt: string | null;
  printedAt: string | null;
  errorPausedMs: number;
  /** Error details, only for viewers with printer:operate. */
  error: PrinterError | null;
  review: { by: PersonView | null; at: string; reason: string | null } | null;
  cancel: { by: PersonView | null; at: string; reason: string } | null;
  failure: { by: PersonView | null; at: string; reason: string; attribution: FailureAttribution | null; attributedBy: PersonView | null; attributedAt: string | null } | null;
  stored: { by: PersonView | null; at: string; slot: string } | null;
  redeemed: { by: PersonView | null; at: string } | null;
  retryOf: number | null;
  retriedAs: number | null;
  /** 颜色要求 picked on submit. */
  colourPref: ColourPref;
  /** Build plate the submitter picked (only when 自选板 is allowed); null = as sliced. */
  bedType: string | null;
  /** Revisions used and allowed (0 = no limit), model switches likewise; baselineSeconds is what a new version's print time is compared with. */
  revisions: { count: number; max: number; switches: number; maxSwitches: number; baselineSeconds: number };
  /** Owner only: a new file can replace this one now (rules, state and limits allow it). */
  canRevise: boolean;
  /** Owner only: a revision is waiting for re-review and an approved version exists to go back to (撤回修改, free). */
  canWithdraw: boolean;
  /** Owner only: the owner may cancel it now (before printing starts, dispatched-but-preparing included). */
  canCancelOwn: boolean;
  /** A revision waiting for re-review; the order keeps its place in the queue meanwhile (frozen). */
  revision: RevisionInfo | null;
  /** Review pool only: 颜色要求 is 一致 and these colours are not on offer, so a spool has to be fetched. */
  missingColours?: string[];
}

/** What changed in a revision, for the review queue's comparison with the previous version. */
export interface RevisionInfo {
  /** 1-based revision number. */
  n: number;
  kind: "revision" | "model-switch" | "dual-to-single" | "restore";
  at: string;
  /** The version before this one. */
  prev: { fileName: string; printerModel: string | null; printerModelId: string; nozzles: OrderNozzle[]; filaments: OrderFilament[]; printSeconds: number; weightGrams: number };
  /** Print time compared with the baseline the rules use (first or previous version). */
  deltaSeconds: number;
  /** Places it moves back when approved; "tail" = end of the queue. */
  placesBack: number | "tail";
  /** It was dispatched but not started; the print was recalled. */
  recalled: boolean;
}

export const VERSION_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type VersionState = (typeof VERSION_STATES)[number];

/** One file an order has had (rules doc §3). Every version stays downloadable; an approved one can be restored. */
export interface OrderVersionView {
  /** 1-based; 1 is the submitted file. */
  n: number;
  kind: "submit" | RevisionInfo["kind"];
  /** For kind "restore": the version it copies. */
  restoredFrom: number | null;
  state: VersionState;
  /** The version the order prints now (or is reviewing). */
  current: boolean;
  fileName: string;
  sizeBytes: number;
  plate: { index: number; count: number; name: string };
  printerModel: string | null;
  printerModelId: string;
  nozzles: OrderNozzle[];
  filaments: OrderFilament[];
  printSeconds: number;
  weightGrams: number;
  thumbUrl: string | null;
  at: string;
  /** Reject reason of a rejected revision. */
  reason: string | null;
}

export interface OrderTimelineEntry {
  at: string;
  kind: string;
  from: OrderStatus | null;
  to: OrderStatus | null;
  by: string | null;
  data: Record<string, unknown> | null;
}

export interface OrderDetail extends OrderView {
  /** Request form answers: owner and reviewers only. */
  answers: { label: string; value: string | string[] | number | null }[] | null;
  timeline: OrderTimelineEntry[];
  /** Oldest first: owner, reviewers and people who can see any order. */
  versions: OrderVersionView[] | null;
  /** Signed link to the 入库 photo: owner and people who can see any order. */
  storePhotoUrl?: string | null;
}

export interface OrderList {
  orders: OrderView[];
  counts: Partial<Record<OrderStatus, number>>;
}

/** Can a plate be printed by the fleet as it is now. Submitting is allowed either way; it only decides the hint. */
export type PlateAvailability =
  | { state: "ok" }
  /** No registered printer has this model and these nozzles. */
  | { state: "none"; message: string }
  /** Compatible printers exist but none can take a job right now (offline, maintenance, no storage). */
  | { state: "unavailable"; message: string };

/** POST /api/orders/preview: the parse result plus what the queue looks like for it. */
export interface OrderPreview extends Omit<ParsedUpload, "plates"> {
  /** check: the plate against 本场可用资源; plates with block entries cannot be submitted. */
  plates: (ParsedPlate & { availability: PlateAvailability; check: PlateCheck })[];
  queue: { length: number; aheadSeconds: number };
}

/* ---- printers ---- */

export interface PrinterView {
  id: string;
  name: string;
  serial: string | null;
  ip: string | null;
  daemonId: string | null;
  /** printer:manage only; null when no code is stored. */
  accessCode: AccessCodeState | null;
  model: string | null;
  modelId: string | null;
  nozzles: ReportedNozzle[] | null;
  storage: ReportedStorage[] | null;
  telemetry: Record<string, unknown> | null;
  state: PrinterState;
  stateSince: string;
  /** Details only with printer:operate; everyone else just sees state ERROR_PAUSED (等待处理). */
  error: PrinterError | null;
  maintenanceReason: string | null;
  starred: boolean;
  /** 开放给选手: only open printers take queued orders and count in 本场可用资源. */
  openToContestants: boolean;
  /** Build plate on the printer, reported or set by hand; null when unknown. */
  bedType: string | null;
  trays: ReportedTray[] | null;
  lastSeenAt: string | null;
  job: { orderId: number; fileName: string; plate: { index: number; count: number }; owner: PersonView; status: string } | null;
  /** 建议下一单: the queued order suggested for this idle printer; only with order:dispatch, null otherwise. */
  suggestion: OrderView | null;
}

/** GET /api/todo */
export interface TodoView {
  store: { order: OrderView; printer: PrinterView | null; since: string | null }[];
  clear: { printer: PrinterView; order: OrderView | null; since: string }[];
  errors: { printer: PrinterView; order: OrderView | null; since: string }[];
  /** 确认派单: idle printers with a suggested next order, waiting for Staff to confirm. */
  dispatch: { printer: PrinterView; order: OrderView; since: string }[];
  /** 跳单提醒: queued orders passed over by later ones for longer than the rule allows. */
  skipped: { order: OrderView; since: string }[];
}

/** GET /api/overview: the numbers on top of 概况. */
export interface OverviewStats {
  pendingReview: number;
  queued: number;
  /** Queued orders no available printer can take (等待兼容的打印机 and the like). */
  waitingCompatible: number;
  /** Items on 待办 (same count as GET /api/todo), for the navigation badge without loading the orders. */
  todo: number;
}

/* ---- settings ---- */

export interface FormView {
  version: number;
  fields: FormField[];
}

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  disabled: boolean;
  createdAt: string;
  roleId: string | null;
  roleName: string | null;
}

export interface DaemonView {
  id: string;
  name: string;
  network: string | null;
  enabled: boolean;
  tokenTail: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Id of the public key the daemon reported; null until it has connected. */
  keyId: string | null;
}

export interface PanelSettings {
  registration: { enabled: boolean };
  queue: { rule: "fifo" };
  rules: QueueRules;
}
