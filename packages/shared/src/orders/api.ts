import type { ParsedPlate, ParsedUpload } from "../gcode3mf/api.js";
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
  plates: (ParsedPlate & { availability: PlateAvailability })[];
  queue: { length: number; aheadSeconds: number };
}

/* ---- printers ---- */

export interface PrinterView {
  id: string;
  name: string;
  serial: string | null;
  ip: string | null;
  daemonId: string | null;
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
  lastSeenAt: string | null;
  job: { orderId: number; fileName: string; plate: { index: number; count: number }; owner: PersonView; status: string } | null;
}

/** GET /api/todo */
export interface TodoView {
  store: { order: OrderView; printer: PrinterView | null; since: string | null }[];
  clear: { printer: PrinterView; order: OrderView | null; since: string }[];
  errors: { printer: PrinterView; order: OrderView | null; since: string }[];
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
}

export interface PanelSettings {
  registration: { enabled: boolean };
  queue: { rule: "fifo" };
}
