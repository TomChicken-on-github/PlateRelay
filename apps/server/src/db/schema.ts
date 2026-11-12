import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../common/uuid.js";

/*
 * Conventions: every primary key is a UUIDv7 generated in the app (sorts by creation time); every
 * time is timestamptz in UTC and ends in _at; durations are whole seconds (_seconds) or
 * milliseconds (_ms); file contents live in object storage and only the key is stored (_key).
 * Rows that other rows point at are disabled or revoked, never soft-deleted.
 */

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const now = (name: string) => at(name).notNull().defaultNow();

export const role = pgEnum("role", ["APPLICANT", "STAFF", "ADMIN"]);
export const orderStatus = pgEnum("order_status", ["PENDING_REVIEW", "REJECTED", "QUEUED", "DISPATCHED", "PRINTING", "FAILED", "PRINTED", "READY", "COMPLETED", "CANCELLED", "DISPOSED"]);
export const printerState = pgEnum("printer_state", ["AVAILABLE", "WORKING", "ATTENTION", "CLEARING_REQUIRED"]);
export const attentionReason = pgEnum("attention_reason", ["OFFLINE", "ERROR", "MAINTENANCE", "JUDGE", "SEND_FAILED", "DAEMON_UPGRADE"]);
export const pauseReason = pgEnum("pause_reason", ["USER", "ERROR", "RUNOUT"]);
export const printerEventKind = pgEnum("printer_event_kind", ["PAUSED", "RESUMED", "ERROR", "HMS", "CONNECTION_DOWN", "CONNECTION_UP", "REFILL"]);
export const versionKind = pgEnum("version_kind", ["SUBMIT", "REPLACE", "REVISION", "RESTORE"]);
export const versionState = pgEnum("version_state", ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "REPLACED"]);
export const colourPref = pgEnum("colour_pref", ["EXACT", "SIMILAR", "ANY"]);
export const processNode = pgEnum("process_node", ["SUBMIT", "REVIEW", "QUEUE", "PRINT", "STORE", "PICKUP"]);
export const jobPhase = pgEnum("job_phase", ["TRANSFERRING", "PREPARING", "PRINTING", "PAUSED", "ENDED"]);
export const jobOutcome = pgEnum("job_outcome", ["SEND_FAILED", "START_FAILED", "STOPPED_BEFORE_START", "FAILED", "FINISHED"]);
export const commandStatus = pgEnum("command_status", ["QUEUED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "FAILED", "DONE"]);
export const commandClass = pgEnum("command_class", ["CONTROL", "SETPOINT", "READ"]);
export const actorType = pgEnum("actor_type", ["USER", "SYSTEM", "DAEMON", "PRINTER"]);

/* ───────── accounts ───────── */

export const users = pgTable(
  "users",
  {
    id: id(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Empty for accounts that only sign in through an external provider. */
    passwordHash: text("password_hash"),
    role: role("role").notNull().default("APPLICANT"),
    avatarKey: text("avatar_key"),
    locale: text("locale").notNull().default("zh-CN"),
    /** Disabling ends every session of the user. */
    disabledAt: at("disabled_at"),
    version: integer("version").notNull().default(1),
    createdAt: now("created_at"),
  },
  (t) => [uniqueIndex("users_username_lower").on(sql`lower(${t.username})`)],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie value; the raw token is never stored. */
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: now("created_at"),
  expiresAt: at("expires_at").notNull(),
  lastSeenAt: now("last_seen_at"),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

/* ───────── daemons and printers ───────── */

export const daemons = pgTable("daemons", {
  id: id(),
  name: text("name").notNull(),
  /** RSA public key, SPKI DER as base64. The private key never leaves the daemon's machine. */
  publicKey: text("public_key").notNull(),
  /** SHA-256 of the SPKI DER, lowercase hex. Shown on both sides so an admin can compare them. */
  keyFingerprint: text("key_fingerprint").notNull().unique(),
  protocolVersion: text("protocol_version").notNull(),
  daemonVersion: text("daemon_version").notNull(),
  platform: text("platform").notNull(),
  lastSeenAt: at("last_seen_at"),
  /** A revoked daemon is refused; its printers become unreachable. */
  revokedAt: at("revoked_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now("created_at"),
  version: integer("version").notNull().default(1),
});

export const daemonEnrollments = pgTable("daemon_enrollments", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  /** 15 minutes after it was issued. */
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at"),
  daemonId: uuid("daemon_id").references(() => daemons.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now("created_at"),
});

/** Ids of daemon messages already handled, so a message resent after a reconnect is acknowledged without being applied twice. */
export const daemonInbox = pgTable("daemon_inbox", {
  messageId: text("message_id").primaryKey(),
  daemonId: uuid("daemon_id").notNull(),
  receivedAt: now("received_at"),
});

export const printers = pgTable(
  "printers",
  {
    id: id(),
    brand: text("brand").notNull(),
    serial: text("serial").notNull(),
    name: text("name").notNull().unique(),
    /** The one daemon that talks to this printer. */
    daemonId: uuid("daemon_id")
      .notNull()
      .references(() => daemons.id),
    host: text("host").notNull(),
    /** Reported by the printer, never typed in. */
    modelId: text("model_id"),
    modelName: text("model_name"),
    capabilities: jsonb("capabilities").notNull().default({}),
    openToApplicants: boolean("open_to_applicants").notNull().default(false),
    /**
     * One of four states. ATTENTION exactly when the printer has a row in printer_reasons. WORKING
     * and CLEARING_REQUIRED on account of a print job are written only by the job engine.
     */
    state: printerState("state").notNull().default("ATTENTION"),
    stateSince: now("state_since"),
    /** The current system job; while CLEARING_REQUIRED, the one that just ended. */
    currentJobId: uuid("current_job_id"),
    /** The printer reports running something that is not the current system job. */
    externalRunning: boolean("external_running").notNull().default(false),
    /** Bed plate reported by the printer; null when it cannot tell. */
    bedType: text("bed_type"),
    /** Access code encrypted in the browser with the daemon's public key; the panel cannot read it. */
    accessCodeCipher: text("access_code_cipher"),
    accessCodeKeyFingerprint: text("access_code_key_fingerprint"),
    accessCodeSetAt: at("access_code_set_at"),
    starred: boolean("starred").notNull().default(false),
    /** Disabled printers are hidden from the overview and from dispatch; their records stay. */
    disabledAt: at("disabled_at"),
    /** Covers the configuration columns only; state changes use row locks and the expected state. */
    version: integer("version").notNull().default(1),
    createdAt: now("created_at"),
  },
  (t) => [unique("printers_brand_serial").on(t.brand, t.serial)],
);

/** Why a printer needs attention. One row per reason; several can hold at once. */
export const printerReasons = pgTable(
  "printer_reasons",
  {
    id: id(),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    reason: attentionReason("reason").notNull(),
    since: now("since"),
    /** Set for reasons raised by a print job; they go away when that job ends. */
    jobId: uuid("job_id"),
    note: text("note"),
    data: jsonb("data").notNull().default({}),
    by: uuid("by").references(() => users.id),
  },
  (t) => [uniqueIndex("printer_reasons_one_each").on(t.printerId, t.reason, sql`coalesce(${t.jobId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);

/** Append-only log of what a printer reported: pauses, errors, lost and regained contact. */
export const printerEvents = pgTable(
  "printer_events",
  {
    id: id(),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    kind: printerEventKind("kind").notNull(),
    at: now("at"),
    data: jsonb("data").notNull().default({}),
  },
  (t) => [index("printer_events_by_printer").on(t.printerId, t.id)],
);

/** The latest full status report of a printer. Overwritten each time, no history. */
export const printerLive = pgTable("printer_live", {
  printerId: uuid("printer_id")
    .primaryKey()
    .references(() => printers.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  bootId: text("boot_id").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  /** Reports older than this (same daemon start) are replays of what a reconciliation already covered. */
  reconciledSeq: bigint("reconciled_seq", { mode: "number" }),
  /** Highest run counter seen; handed back to a daemon that lost its local state. */
  runSeq: bigint("run_seq", { mode: "number" }).notNull().default(0),
  reportedAt: now("reported_at"),
});

/** Grams left in each tray, counted by the panel: reset on a spool change, reduced when a job ends. */
export const trayGrams = pgTable(
  "tray_grams",
  {
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    /** AMS number; -1 for the external spool. */
    unit: integer("unit").notNull(),
    slot: integer("slot").notNull(),
    grams: integer("grams").notNull(),
    /** True after a spool change reset the count to the default, until someone confirms it. */
    unconfirmed: boolean("unconfirmed").notNull().default(true),
    /** What was in the tray last time, to notice a spool change. */
    loadedTag: jsonb("loaded_tag").notNull().default({}),
    updatedAt: now("updated_at"),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.printerId, t.unit, t.slot] })],
);

export const printerErrors = pgTable(
  "printer_errors",
  {
    id: id(),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    /** Id the adapter gave this occurrence. */
    errorId: text("error_id").notNull(),
    channel: text("channel").notNull(),
    vendorCode: text("vendor_code").notNull(),
    severity: text("severity").notNull(),
    module: text("module"),
    message: text("message"),
    helpUrl: text("help_url"),
    blocksJob: boolean("blocks_job").notNull().default(false),
    actions: jsonb("actions").notNull().default([]),
    raisedAt: at("raised_at").notNull(),
    clearedAt: at("cleared_at"),
    clearedBy: text("cleared_by"),
    resolvedAction: text("resolved_action"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    commandId: uuid("command_id"),
  },
  (t) => [unique("printer_errors_one").on(t.printerId, t.errorId)],
);

/* ───────── files and orders ───────── */

export const files = pgTable(
  "files",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadedAt: now("uploaded_at"),
    /** Null until an order uses it; files never submitted are deleted after a while. */
    submittedAt: at("submitted_at"),
    purgedAt: at("purged_at"),
  },
  (t) => [index("files_by_uploader").on(t.uploadedBy, t.sha256)],
);

export const fileChecks = pgTable("file_checks", {
  fileId: uuid("file_id")
    .primaryKey()
    .references(() => files.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("QUEUED"),
  parserVersion: text("parser_version").notNull().default("1"),
  /** Per plate: number, name, model, nozzles, filaments, time, weight, parts, preview keys. */
  plates: jsonb("plates").notNull().default([]),
  findings: jsonb("findings").notNull().default([]),
  verdict: text("verdict"),
  limits: jsonb("limits").notNull().default({}),
  finishedAt: at("finished_at"),
});

export const formVersions = pgTable("form_versions", {
  id: id(),
  fields: jsonb("fields").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now("created_at"),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    /** The number people see (#1234). Never reused. */
    number: bigserial("number", { mode: "number" }).notNull().unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /** Stored, not derived. DISPATCHED, PRINTING, FAILED and PRINTED are written only by the job engine. */
    status: orderStatus("status").notNull().default("PENDING_REVIEW"),
    /** Place in the queue. Given at the first approval and kept afterwards, so a reprint or a stop before start returns to the same place. */
    sortKey: bigint("sort_key", { mode: "bigint" }),
    /** The version that will be printed. */
    activeVersionId: uuid("active_version_id").notNull(),
    /** A revision waiting for review, only while PENDING_REVIEW with a sort key (frozen in place). */
    pendingVersionId: uuid("pending_version_id"),
    colourPref: colourPref("colour_pref").notNull().default("SIMILAR"),
    /** Plate the applicant chose; null = as sliced. */
    bedType: text("bed_type"),
    formVersionId: uuid("form_version_id").references(() => formVersions.id),
    answers: jsonb("answers").notNull().default([]),
    revisionCount: integer("revision_count").notNull().default(0),
    modelSwitchCount: integer("model_switch_count").notNull().default(0),
    /** The printer the order is on, from dispatch until it is stored. */
    printerId: uuid("printer_id").references(() => printers.id),
    currentJobId: uuid("current_job_id"),
    /** When a later order was first dispatched ahead of this one. Cleared on dispatch. */
    bypassedSince: at("bypassed_since"),
    storageSlot: text("storage_slot"),
    storePhotoKey: text("store_photo_key"),
    submittedAt: now("submitted_at"),
    /** When the order reached a final status or failed; file retention counts from here. Cleared by a reprint. */
    closedAt: at("closed_at"),
    archivedAt: at("archived_at"),
    reprintDeclinedAt: at("reprint_declined_at"),
    reprintDeclinedBy: uuid("reprint_declined_by").references(() => users.id),
    reprintDeclinedReason: text("reprint_declined_reason"),
    reprintDeclinedReasonVisible: boolean("reprint_declined_reason_visible").notNull().default(true),
    /** Computed when the order closes, with the retention setting of that moment. */
    filesExpireAt: at("files_expire_at"),
  },
  (t) => [index("orders_queue").on(t.status, t.sortKey), index("orders_by_owner").on(t.ownerId, t.id)],
);

export const orderVersions = pgTable(
  "order_versions",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    kind: versionKind("kind").notNull(),
    restoredFromId: uuid("restored_from_id"),
    state: versionState("state").notNull().default("PENDING"),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    plateIndex: integer("plate_index").notNull(),
    plateCount: integer("plate_count").notNull(),
    plateName: text("plate_name").notNull().default(""),
    modelId: text("model_id").notNull(),
    modelName: text("model_name"),
    nozzles: jsonb("nozzles").notNull(),
    filaments: jsonb("filaments").notNull(),
    printSeconds: integer("print_seconds").notNull(),
    weightGrams: integer("weight_grams").notNull(),
    /** Bed plate named in the slice. */
    slicedBedType: text("sliced_bed_type"),
    thumbnailKey: text("thumbnail_key"),
    parts: jsonb("parts").notNull().default([]),
    partsTopKey: text("parts_top_key"),
    partsPickKey: text("parts_pick_key"),
    /** Print-time difference to the last approved version and the places to move back, worked out when the version was uploaded. -1 = end of the queue. */
    deltaSeconds: integer("delta_seconds"),
    placesBack: integer("places_back"),
    /** Counts towards the revision limit. */
    counted: boolean("counted").notNull().default(false),
    modelSwitch: boolean("model_switch").notNull().default(false),
    createdAt: now("created_at"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: at("decided_at"),
    reason: text("reason"),
  },
  (t) => [unique("order_versions_n").on(t.orderId, t.n), unique("order_versions_owner").on(t.id, t.orderId)],
);

/**
 * One attempt to print one version on one printer. Dispatching creates it; a reprint or a new
 * dispatch after a stop makes a new row and the old one stays. What the printer reports lands on
 * the current job first; the job's change then moves the order and the printer in the same transaction.
 */
export const printJobs = pgTable(
  "print_jobs",
  {
    /** Also the job reference sent to the daemon. */
    id: id(),
    /** Nth print of this order, from 1. */
    attempt: integer("attempt").notNull(),
    phase: jobPhase("phase").notNull().default("TRANSFERRING"),
    phaseSince: now("phase_since"),
    /** PREPARING or PRINTING, only while PAUSED: where a resume goes back to. */
    pausedFrom: jobPhase("paused_from"),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => orderVersions.id),
    printerId: uuid("printer_id")
      .notNull()
      .references(() => printers.id),
    dispatchedBy: uuid("dispatched_by").references(() => users.id),
    dispatchedAt: now("dispatched_at"),
    /** Whether this was the order the system suggested for the printer. */
    suggested: boolean("suggested").notNull().default(false),
    bypassedOrderIds: uuid("bypassed_order_ids").array().notNull().default([]),
    bedType: text("bed_type"),
    mapping: jsonb("mapping").notNull(),
    mappingSettingsVersion: integer("mapping_settings_version").notNull().default(0),
    safetyLimits: jsonb("safety_limits").notNull().default({}),
    startCommandId: uuid("start_command_id"),
    /** When the printer itself first reported preparing this job. Only used to tell whether the start command arrived. */
    preparedAt: at("prepared_at"),
    startedAt: at("started_at"),
    endedAt: at("ended_at"),
    outcome: jobOutcome("outcome"),
    pauseReason: pauseReason("pause_reason"),
    pausedMs: bigint("paused_ms", { mode: "number" }).notNull().default(0),
    /** As the printer reports them. */
    skippedParts: integer("skipped_parts").array().notNull().default([]),
    /** Last progress the printer reported, 0–100. */
    lastPercent: integer("last_percent"),
    endPhotoKey: text("end_photo_key"),
    endPhotoAt: at("end_photo_at"),
    failReason: text("fail_reason"),
  },
  (t) => [
    index("print_jobs_by_printer").on(t.printerId, t.dispatchedAt, t.id),
    index("print_jobs_by_order").on(t.orderId, t.attempt),
    /* A printer runs at most one system job at a time, and an order is on at most one printer. */
    uniqueIndex("print_jobs_one_per_printer").on(t.printerId).where(sql`${t.phase} <> 'ENDED'`),
    uniqueIndex("print_jobs_one_per_order").on(t.orderId).where(sql`${t.phase} <> 'ENDED'`),
  ],
);

/** Commands for a daemon. This table is also the panel's outbox: what is not answered yet is sent again after a reconnect. */
export const daemonCommands = pgTable(
  "daemon_commands",
  {
    id: id(),
    daemonId: uuid("daemon_id")
      .notNull()
      .references(() => daemons.id),
    printerId: uuid("printer_id").references(() => printers.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    kind: text("kind").notNull(),
    class: commandClass("class").notNull(),
    /** Never holds credentials. */
    payload: jsonb("payload").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    createdAt: now("created_at"),
    /** The daemon must begin before this, or it refuses. */
    expiresAt: at("expires_at").notNull(),
    /** How far delivery got. ACCEPTED only means the printer took the command; what happened is told by the printer's own reports. */
    status: commandStatus("status").notNull().default("QUEUED"),
    result: jsonb("result"),
    finishedAt: at("finished_at"),
  },
  (t) => [index("daemon_commands_outbox").on(t.daemonId, t.status), index("daemon_commands_by_job").on(t.jobId)],
);

export const pickupCodes = pgTable(
  "pickup_codes",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    issuedAt: now("issued_at"),
    expiresAt: at("expires_at").notNull(),
    revokedAt: at("revoked_at"),
    redeemedAt: at("redeemed_at"),
    redeemedBy: uuid("redeemed_by").references(() => users.id),
  },
  (t) => [index("pickup_codes_by_order").on(t.orderId)],
);

/** The order timeline. Append-only (a trigger refuses UPDATE and DELETE). */
export const orderRecords = pgTable(
  "order_records",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    at: now("at"),
    node: processNode("node").notNull(),
    /** Dotted record type such as order.approved; each has a text in the UI. */
    kind: text("kind").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status"),
    versionN: integer("version_n"),
    jobId: uuid("job_id"),
    note: text("note"),
    /** Whether the applicant sees the note. */
    noteVisible: boolean("note_visible").notNull().default(false),
    data: jsonb("data").notNull().default({}),
  },
  (t) => [index("order_records_by_order").on(t.orderId, t.id)],
);

/* ───────── settings, audit, idempotency ───────── */

export const settings = pgTable("settings", {
  section: text("section").primaryKey(),
  values: jsonb("values").notNull().default({}),
  version: integer("version").notNull().default(0),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: at("updated_at"),
});

/** Append-only and kept forever (a trigger refuses UPDATE and DELETE). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: now("at"),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    result: text("result").notNull().default("OK"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("audit_log_by_target").on(t.targetType, t.targetId)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    principal: text("principal").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    /** Null while the first request is still being handled. */
    statusCode: integer("status_code"),
    response: jsonb("response"),
    createdAt: now("created_at"),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.principal, t.method, t.route, t.key] })],
);
