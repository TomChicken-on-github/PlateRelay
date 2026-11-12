/*
 * Every setting the panel has: type, default and allowed range, grouped by the section of the
 * settings page it appears in. Stored values are checked against this table on save; a key missing
 * from the database reads as its default. Settings never apply to what already happened.
 */

export type ParamDef =
  | { type: "boolean"; default: boolean }
  | { type: "integer"; default: number; min: number; max: number }
  | { type: "number"; default: number; min: number; max: number }
  | { type: "enum"; default: string; values: readonly string[] }
  | { type: "string"; default: string; maxLength: number }
  | { type: "string[]"; default: readonly string[] };

const bool = (d: boolean) => ({ type: "boolean" as const, default: d });
const int = (d: number, min: number, max: number) => ({ type: "integer" as const, default: d, min, max });
const num = (d: number, min: number, max: number) => ({ type: "number" as const, default: d, min, max });
const oneOf = (d: string, ...values: string[]) => ({ type: "enum" as const, default: d, values });
const str = (d: string, maxLength = 200) => ({ type: "string" as const, default: d, maxLength });

export const SETTINGS = {
  general: {
    orgName: str("PlateRelay"),
    timezone: str("Asia/Shanghai"),
    defaultLocale: oneOf("zh-CN", "zh-CN", "en"),
  },
  ui: {
    /** People who are not signed in can see the overview page. */
    overviewPublic: bool(true),
    /** They also see the file name of what a printer is printing. */
    guestFileName: bool(true),
  },
  camera: {
    guestStream: bool(false),
    watchedSnapshotSeconds: int(10, 2, 600),
    viewersPerPrinter: int(20, 1, 200),
    streamingPrinters: int(4, 0, 100),
    /** 0 = no snapshots while nobody is looking. */
    unwatchedSnapshotMinutes: int(5, 0, 60),
    snapshotUploadMbps: num(1, 0.1, 100),
  },
  submit: {
    outOfBounds: oneOf("REJECT", "REJECT", "WARN", "IGNORE"),
    metadataMismatch: oneOf("WARN", "REJECT", "WARN", "IGNORE"),
    showResources: bool(true),
    showWait: bool(true),
    /** Uploaded files that were never submitted are deleted after this long. */
    unsubmittedFileMinutes: int(120, 30, 1440),
    captchaFromNthFile: int(3, 1, 20),
  },
  queue: {
    /** Orders one person may have that are not printed yet; 0 = no limit. */
    maxUnfinishedPerUser: int(0, 0, 100),
    bypassReminderMinutes: int(30, 5, 240),
    applicantPicksBed: bool(false),
  },
  revision: {
    enabled: bool(true),
    maxCount: int(3, 1, 10),
    /** A longer print moves back only when it is longer by more than this. */
    thresholdMinutes: int(15, 0, 240),
    beyondThreshold: oneOf("STEP_BACK", "KEEP", "STEP_BACK"),
    placesPerStep: int(1, 1, 20),
    minutesPerStep: int(15, 1, 240),
    modelSwitchMax: int(1, 0, 3),
    modelSwitchPlace: oneOf("KEEP", "KEEP", "END"),
    modelSwitchExtraPlaces: int(0, 0, 20),
    dualToSingleCounts: bool(false),
  },
  mapping: {
    materialMismatch: oneOf("BLOCK", "BLOCK", "WARN"),
    subTypeMismatch: oneOf("WARN", "BLOCK", "WARN", "IGNORE"),
    /** Colour difference (ΔE2000) up to which two colours count as the same. */
    sameColourDeltaE: num(5, 0, 20),
    similarColourDeltaE: num(15, 0, 60),
    mismatchReasons: { type: "string[]" as const, default: ["该颜色已用完", "相近色可接受", "申请者同意"] },
    /** Grams a tray is reset to when a new spool is noticed. */
    spoolGrams: int(1000, 100, 5000),
    /** Remind to refill when a tray will be below this after the current job; 0 = never. */
    refillBelowGrams: int(100, 0, 1000),
  },
  printing: {
    pausedReminderMinutes: int(15, 1, 240),
    refreshIntervalSeconds: int(10, 5, 300),
    clearBedReminderMinutes: int(10, 1, 240),
    transferTimeoutSeconds: int(180, 30, 1800),
    /** After the start command went out, how long until a job that has not begun preparing shows up as a to-do. */
    startUnconfirmedSeconds: int(60, 15, 600),
  },
  pickup: {
    codeMinutes: int(10, 1, 60),
    unclaimedReminderHours: int(24, 1, 168),
  },
  files: {
    retentionDays: int(30, 1, 365),
    timelapseRetentionDays: int(30, 1, 365),
  },
  accounts: {
    /** Anyone may create an applicant account from the sign-in page. */
    openRegistration: bool(false),
  },
  notifications: {},
  ops: {},
} satisfies Record<string, Record<string, ParamDef>>;

export type Section = keyof typeof SETTINGS;
export const SECTIONS = Object.keys(SETTINGS) as Section[];
export const isSection = (s: string): s is Section => s in SETTINGS;

type ValueOf<D> = D extends { type: "boolean" } ? boolean : D extends { type: "integer" | "number" } ? number : D extends { type: "string[]" } ? string[] : string;
export type SectionValues<S extends Section> = { [K in keyof (typeof SETTINGS)[S]]: ValueOf<(typeof SETTINGS)[S][K]> };

export function defaultsOf<S extends Section>(section: S): SectionValues<S> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(SETTINGS[section] as Record<string, ParamDef>)) out[k] = Array.isArray(d.default) ? [...d.default] : d.default;
  return out as SectionValues<S>;
}

export interface SettingIssue {
  path: string;
  code: string;
  params: Record<string, unknown>;
}

/** Checks values a user wants to save for a section: known keys, right types, inside the range. */
export function checkValues(section: Section, values: Record<string, unknown>): SettingIssue[] {
  const defs = SETTINGS[section] as Record<string, ParamDef>;
  const issues: SettingIssue[] = [];
  for (const [k, v] of Object.entries(values)) {
    const d = defs[k];
    const bad = (code: string, params: Record<string, unknown> = {}) => issues.push({ path: `/values/${k}`, code, params });
    if (!d) bad("unknown_setting");
    else if (d.type === "boolean") typeof v === "boolean" || bad("type", { type: "boolean" });
    else if (d.type === "integer" || d.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v) || (d.type === "integer" && !Number.isInteger(v))) bad("type", { type: d.type });
      else if (v < d.min || v > d.max) bad("range", { min: d.min, max: d.max });
    } else if (d.type === "enum") d.values.includes(v as string) || bad("enum", { values: d.values });
    else if (d.type === "string") (typeof v === "string" && v.length <= d.maxLength) || bad("type", { type: "string", maxLength: d.maxLength });
    else (Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 200) && v.length <= 50) || bad("type", { type: "string[]" });
  }
  if (section === "mapping") {
    const merged = { ...defaultsOf("mapping"), ...values } as SectionValues<"mapping">;
    if (merged.similarColourDeltaE <= merged.sameColourDeltaE) issues.push({ path: "/values/similarColourDeltaE", code: "must_exceed", params: { other: "sameColourDeltaE" } });
  }
  if (section === "files") {
    const merged = { ...defaultsOf("files"), ...values } as SectionValues<"files">;
    if (merged.timelapseRetentionDays > merged.retentionDays) issues.push({ path: "/values/timelapseRetentionDays", code: "must_not_exceed", params: { other: "retentionDays" } });
  }
  return issues;
}
