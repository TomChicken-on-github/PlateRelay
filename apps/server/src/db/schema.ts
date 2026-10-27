import {
  type AnswerSnapshot,
  COLOUR_PREFS,
  FAILURE_ATTRIBUTIONS,
  type FormField,
  type FormFieldType,
  ORDER_STATUSES,
  type OrderFilament,
  type OrderNozzle,
  PRINTER_STATES,
  type PrinterError,
  type ReportedNozzle,
  type ReportedStorage,
  type ReportedTray,
  type OrderVersionView,
  type RevisionInfo,
  VERSION_STATES,
} from "@platerelay/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../common/uuid.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const orderStatus = pgEnum("order_status", ORDER_STATUSES);
export const printerState = pgEnum("printer_state", PRINTER_STATES);
export const failureAttribution = pgEnum("failure_attribution", FAILURE_ATTRIBUTIONS);
export const actorType = pgEnum("actor_type", ["user", "system", "daemon", "printer"]);
export const auditResult = pgEnum("audit_result", ["ok", "failed", "denied"]);
export const colourPref = pgEnum("colour_pref", COLOUR_PREFS);
export const versionState = pgEnum("version_state", VERSION_STATES);

/* JSON column shapes live in @platerelay/shared because the API sends them as they are. */
export type { AnswerSnapshot, FormField, FormFieldType, OrderFilament, OrderNozzle, PrinterError, ReportedNozzle, ReportedStorage, ReportedTray, RevisionInfo };

/* ---- accounts ---- */

/** Preset roles; permissions are synced from PRESET_ROLES on start. */
export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  builtin: boolean("builtin").notNull().default(true),
  permissions: text("permissions").array().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    /** null for accounts that only sign in through an external provider. */
    passwordHash: text("password_hash"),
    /** Object key in storage, under avatars/. */
    avatarKey: text("avatar_key"),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_username_lower").on(sql`lower(${t.username})`)],
);

/** One role per scope. Only "global" is used in the first phase (brief §5.4). */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("global"),
    roleId: text("role_id").notNull().references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope] })],
);

/** External logins (OIDC), keyed by issuer + subject, never by e-mail (brief §5.6). */
export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("external_identities_iss_sub").on(t.issuer, t.subject)],
);

/** Browser sessions. Only the SHA-256 of the cookie value is stored. */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

/** Daemon connection tokens. Shown once; only the hash and the last four characters are kept. */
export const daemons = pgTable("daemons", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  name: text("name").notNull(),
  network: text("network"),
  tokenHash: text("token_hash").notNull().unique(),
  tokenTail: text("token_tail").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  lastSeenAt: ts("last_seen_at"),
  /**
   * The daemon's RSA public key (SPKI DER, base64) that browsers encrypt printer access codes with.
   * The daemon makes the key pair and reports the public half; a new key makes stored codes unreadable.
   */
  publicKey: text("public_key"),
  keyId: text("key_id"),
  keySetAt: ts("key_set_at"),
});

/* ---- printers ---- */

export const printers = pgTable("printers", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  name: text("name").notNull().unique(),
  serial: text("serial").notNull().unique(),
  ip: text("ip").notNull(),
  daemonId: uuid("daemon_id").references(() => daemons.id, { onDelete: "set null" }),
  /* Reported by the printer through the daemon, never typed in. */
  model: text("model"),
  modelId: text("model_id"),
  nozzles: jsonb("nozzles").$type<ReportedNozzle[]>(),
  storage: jsonb("storage").$type<ReportedStorage[]>(),
  /** Loaded spools, reported like the nozzles; feeds 本场可用资源. */
  trays: jsonb("trays").$type<ReportedTray[]>(),
  /** Build plate on the printer, reported or set by hand. */
  bedType: text("bed_type"),
  /** 开放给选手. New printers start closed; only open ones take queued orders (rules doc §1.5). */
  openToContestants: boolean("open_to_contestants").notNull().default(false),
  /** Latest telemetry snapshot (temperatures, AMS, progress). Not audited. */
  telemetry: jsonb("telemetry").$type<Record<string, unknown>>(),
  state: printerState("state").notNull().default("OFFLINE"),
  stateSince: ts("state_since").notNull().defaultNow(),
  error: jsonb("error").$type<PrinterError>(),
  maintenanceReason: text("maintenance_reason"),
  currentOrderId: integer("current_order_id"),
  starred: boolean("starred").notNull().default(false),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
  /**
   * Access code encrypted in the browser with the daemon's public key (RSA-OAEP, base64). The panel
   * cannot read it and never sends it back to a browser; only the daemon holding the key can.
   */
  accessCodeCipher: text("access_code_cipher"),
  accessCodeKeyId: text("access_code_key_id"),
  accessCodeSetAt: ts("access_code_set_at"),
  accessCodeDeliveredAt: ts("access_code_delivered_at"),
});

/* ---- request form ---- */

/** Every edit makes a new version; orders keep the version they were submitted with. */
export const formVersions = pgTable("form_versions", {
  id: serial("id").primaryKey(),
  fields: jsonb("fields").$type<FormField[]>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

/* ---- orders ---- */

/** Hands out FIFO keys on approval. */
export const orderQueueSeq = pgSequence("order_queue_seq");

export const files = pgTable("files", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  sha256: text("sha256").notNull(),
  key: text("key").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

/** One order per plate (brief §5.3); plates of one upload share file_id and nothing else. */
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    status: orderStatus("status").notNull(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    fileId: uuid("file_id").notNull().references(() => files.id),
    plateIndex: integer("plate_index").notNull(),
    plateCount: integer("plate_count").notNull(),
    plateName: text("plate_name").notNull().default(""),
    printerModel: text("printer_model"),
    printerModelId: text("printer_model_id").notNull(),
    nozzles: jsonb("nozzles").$type<OrderNozzle[]>().notNull(),
    filaments: jsonb("filaments").$type<OrderFilament[]>().notNull(),
    printSeconds: integer("print_seconds").notNull(),
    weightGrams: real("weight_grams").notNull(),
    thumbnailKey: text("thumbnail_key"),
    formVersionId: integer("form_version_id").notNull().references(() => formVersions.id),
    answers: jsonb("answers").$type<AnswerSnapshot[]>().notNull(),
    /** FIFO key, set on approval. Kept after the order leaves the queue so a machine-fault retry can reuse it. */
    queueSeq: bigint("queue_seq", { mode: "number" }),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    rejectReason: text("reject_reason"),
    printerId: uuid("printer_id").references(() => printers.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    printedAt: ts("printed_at"),
    /** Time spent in ERROR_PAUSED, counted into the order's actual duration. */
    errorPausedMs: bigint("error_paused_ms", { mode: "number" }).notNull().default(0),
    storedBy: uuid("stored_by").references(() => users.id),
    storedAt: ts("stored_at"),
    storageSlot: text("storage_slot"),
    storePhotoKey: text("store_photo_key"),
    redeemedBy: uuid("redeemed_by").references(() => users.id),
    redeemedAt: ts("redeemed_at"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    failedBy: uuid("failed_by").references(() => users.id),
    failedAt: ts("failed_at"),
    failureReason: text("failure_reason"),
    attribution: failureAttribution("attribution"),
    attributedBy: uuid("attributed_by").references(() => users.id),
    attributedAt: ts("attributed_at"),
    retryOf: integer("retry_of"),
    colourPref: colourPref("colour_pref").notNull().default("similar"),
    /** Plate the submitter picked when 自选板 is allowed; null prints on the plate the file was sliced for. */
    bedType: text("bed_type"),
    /** Print time of the first version, the baseline for revision penalties. */
    originalPrintSeconds: integer("original_print_seconds"),
    revisionCount: integer("revision_count").notNull().default(0),
    modelSwitchCount: integer("model_switch_count").notNull().default(0),
    /** Revision waiting for re-review (frozen in its place), cleared on approval. */
    revision: jsonb("revision").$type<RevisionInfo>(),
    /** First time a later order was dispatched while this one stayed queued; cleared on dispatch. */
    skippedSince: ts("skipped_since"),
  },
  (t) => [
    index("orders_status_queue").on(t.status, t.queueSeq, t.id),
    index("orders_owner").on(t.ownerId, t.submittedAt),
    uniqueIndex("orders_retry_of").on(t.retryOf),
  ],
);

/**
 * Every file an order has had (rules doc §3). The order row holds the version it prints; these keep
 * the others downloadable and restorable, and are what a withdrawn or rejected revision falls back to.
 */
export const orderVersions = pgTable(
  "order_versions",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull().references(() => orders.id),
    /** 1-based; 1 is the submitted file. */
    n: integer("n").notNull(),
    kind: text("kind").$type<OrderVersionView["kind"]>().notNull(),
    restoredFrom: integer("restored_from"),
    state: versionState("state").notNull(),
    fileId: uuid("file_id").notNull().references(() => files.id),
    plateIndex: integer("plate_index").notNull(),
    plateCount: integer("plate_count").notNull(),
    plateName: text("plate_name").notNull().default(""),
    printerModel: text("printer_model"),
    printerModelId: text("printer_model_id").notNull(),
    nozzles: jsonb("nozzles").$type<OrderNozzle[]>().notNull(),
    filaments: jsonb("filaments").$type<OrderFilament[]>().notNull(),
    printSeconds: integer("print_seconds").notNull(),
    weightGrams: real("weight_grams").notNull(),
    thumbnailKey: text("thumbnail_key"),
    /** Counted towards revisions.max / modelSwitch.max; given back when it is withdrawn. */
    counted: boolean("counted").notNull().default(false),
    switched: boolean("switched").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("order_versions_n").on(t.orderId, t.n)],
);

/** Pickup codes: issued on demand, valid 10 minutes, a new one revokes the previous one. */
export const pickupCodes = pgTable(
  "pickup_codes",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    /** Normalized, without the PR1 prefix or dashes. */
    code: text("code").notNull(),
    orderId: integer("order_id").notNull().references(() => orders.id),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    redeemedAt: ts("redeemed_at"),
  },
  (t) => [uniqueIndex("pickup_codes_code").on(t.code), index("pickup_codes_order").on(t.orderId)],
);

/** The order's own timeline, shown on order detail. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: integer("order_id").notNull().references(() => orders.id),
    at: ts("at").notNull().defaultNow(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    kind: text("kind").notNull(),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status"),
    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (t) => [index("order_events_order").on(t.orderId, t.at)],
);

/** Append-only; a trigger in the migrations rejects UPDATE and DELETE. Never holds secrets. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    result: auditResult("result").notNull().default("ok"),
    ip: text("ip"),
    device: text("device"),
  },
  (t) => [index("audit_at").on(t.at), index("audit_target").on(t.targetType, t.targetId), index("audit_actor").on(t.actorId)],
);

/** Panel settings that are not their own table (queue policy, registration…). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
