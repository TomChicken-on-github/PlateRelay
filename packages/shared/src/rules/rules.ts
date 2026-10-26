/*
 * Print rules (通用打印规则): every value is a setting with a default, nothing is hard-coded in the
 * queue code. The defaults are the hackathon preset the user decided on 2026-10-25. The server reads
 * them through one policy interface (apps/server/src/rules), so a rule engine can replace it later.
 */

/** What happens to a revised order whose print time grew by more than the threshold (rules doc §3.4). */
export const REVISION_PENALTIES = ["none", "fixed", "per-step", "tail"] as const;
export type RevisionPenalty = (typeof REVISION_PENALTIES)[number];

export interface QueueRules {
  revisions: {
    /** 允许提交后修改. */
    enabled: boolean;
    /** 最多修改次数; 0 means no limit. */
    max: number;
    /** 轻微修改自动审核: same model and materials, time change within the threshold → no re-review. */
    autoApproveMinor: boolean;
    /** Growth up to this many minutes keeps the place (正好等于阈值也不退). */
    thresholdMinutes: number;
    penalty: RevisionPenalty;
    /** "fixed": places back once over the threshold; "per-step": places back per step. */
    places: number;
    /** "per-step": one step per this many minutes over the threshold. */
    stepMinutes: number;
    /** Compare against the first approved version or the previous one (§3.3, not decided; first version suggested). */
    baseline: "original" | "previous";
    /** A dispatched job that has not started: recall the print and freeze the order, or refuse the revision. */
    whenDispatched: "recall" | "refuse";
  };
  modelSwitch: {
    /** 换机型次数上限. */
    max: number;
    /** Where the order goes in the queue for the new model: its original place, or the tail. */
    position: "original" | "tail";
    /** Extra places back on top of the time rule. */
    extraPlaces: number;
    /** A model switch is a revision and counts towards revisions.max. */
    countsAsRevision: boolean;
    /** Dual-nozzle → single-nozzle model counts as a revision. */
    dualToSingleCounts: boolean;
  };
  /** 跳单提醒: a queued order passed over by later ones for this long shows up on 待办. */
  skipReminderMinutes: number;
  /** 是否允许自选板: the submitter picks the build plate on the submit page. */
  allowPlateChoice: boolean;
}

export const DEFAULT_QUEUE_RULES: QueueRules = {
  revisions: {
    enabled: true,
    max: 3,
    autoApproveMinor: false,
    thresholdMinutes: 15,
    penalty: "per-step",
    places: 1,
    stepMinutes: 15,
    baseline: "original",
    whenDispatched: "recall",
  },
  modelSwitch: { max: 1, position: "original", extraPlaces: 0, countsAsRevision: true, dualToSingleCounts: false },
  skipReminderMinutes: 30,
  allowPlateChoice: false,
};

/**
 * Places a revised order moves back for a change of `deltaSeconds` in print time; "tail" puts it at
 * the end of the queue. Shorter or unchanged prints never move.
 */
export function revisionPlacesBack(r: QueueRules["revisions"], deltaSeconds: number): number | "tail" {
  const over = deltaSeconds / 60 - r.thresholdMinutes;
  if (over <= 0) return 0;
  switch (r.penalty) {
    case "none":
      return 0;
    case "fixed":
      return r.places;
    case "per-step":
      return Math.ceil(over / Math.max(1, r.stepMinutes) - 1e-9) * r.places;
    case "tail":
      return "tail";
  }
}

/* ---- 颜色要求 ---- */

export const COLOUR_PREFS = ["exact", "similar", "any"] as const;
export type ColourPref = (typeof COLOUR_PREFS)[number];
export const COLOUR_PREF_LABEL: Record<ColourPref, string> = { exact: "一致", similar: "相近", any: "无所谓" };
export const DEFAULT_COLOUR_PREF: ColourPref = "similar";

/* ---- 热床板 ---- */

/** Build plates as Bambu Studio writes them (curr_bed_type). */
export const BED_TYPES = ["Cool Plate", "Supertack Plate", "Engineering Plate", "High Temp Plate", "Textured PEI Plate", "Textured Cool Plate"] as const;
export const BED_TYPE_LABEL: Record<string, string> = {
  "Cool Plate": "低温打印板",
  "Supertack Plate": "低温增强打印板",
  "Engineering Plate": "工程材料板",
  "High Temp Plate": "高温打印板",
  "Textured PEI Plate": "纹理 PEI 板",
  "Textured Cool Plate": "纹理低温打印板",
};

/* ---- 预计等待 ---- */

/** Estimated wait is only ever shown as one of these ranges, never as an exact time (rules doc §4.3). */
export const WAIT_BUCKETS = ["lt30m", "30m-1h", "1h-2h", "2h-4h", "gt4h"] as const;
export type WaitBucket = (typeof WAIT_BUCKETS)[number];
export const WAIT_BUCKET_LABEL: Record<WaitBucket, string> = {
  lt30m: "30 分钟内",
  "30m-1h": "约 0.5–1 小时",
  "1h-2h": "约 1–2 小时",
  "2h-4h": "约 2–4 小时",
  gt4h: "4 小时以上",
};

export function waitBucket(seconds: number): WaitBucket {
  const h = seconds / 3600;
  return h < 0.5 ? "lt30m" : h < 1 ? "30m-1h" : h < 2 ? "1h-2h" : h < 4 ? "2h-4h" : "gt4h";
}

/* ---- 本场可用资源 ---- */

export interface StockFilament {
  id: string;
  /** Material type as the slicer writes it, e.g. "PLA". */
  type: string;
  /** #RRGGBB */
  color: string;
  name: string;
  /** Model ids it can be loaded on. */
  modelIds: string[];
}

export interface ResourceSettings {
  /** 在提交页显示可用资源. Upload checks apply either way. */
  show: boolean;
  /** 显示预计等待时间; the viewer also needs queue:wait:view. */
  showWait: boolean;
  /** 颜色要求「一致」但本场没有该颜色: warn and let it through, or block the plate. */
  colourMissing: "warn" | "block";
  /** 顶部说明. */
  bulletin: string;
  /** Per printer model id: hidden, note, manual wait range, sort order. */
  models: Record<string, { hidden?: boolean; note?: string; wait?: WaitBucket | null; order?: number }>;
  /** Per material type: hidden, note, sort order. */
  materials: Record<string, { hidden?: boolean; note?: string; order?: number }>;
  /** 库存耗材: on hand but not loaded; the plate is printed after a spool change. */
  stock: StockFilament[];
}

export const DEFAULT_RESOURCE_SETTINGS: ResourceSettings = {
  show: true,
  showWait: true,
  colourMissing: "warn",
  bulletin: "",
  models: {},
  materials: {},
  stock: [],
};

/** GET /api/resources: the 本场可用资源 table. Only printers open to submitters count. */
export interface ResourcesView {
  show: boolean;
  bulletin: string;
  colourMissing: ResourceSettings["colourMissing"];
  models: {
    modelId: string;
    model: string;
    count: number;
    idle: number;
    /** Nozzle diameters on offer, e.g. [0.4]. */
    nozzles: number[];
    dual: boolean;
    bedTypes: string[];
    /** null when hidden from this viewer. */
    wait: WaitBucket | null;
    waitManual: boolean;
    note: string;
    hidden: boolean;
  }[];
  materials: {
    type: string;
    colors: { color: string; name: string | null; stock: boolean; modelIds: string[] }[];
    note: string;
    hidden: boolean;
  }[];
}

/** What the server found when checking a plate against the table; blocking issues stop the plate. */
export interface PlateCheck {
  block: string[];
  /** Colours (#RRGGBB) of the plate that no spool on offer has; matters when 颜色要求 is 一致. */
  missingColours: string[];
}
