import type { SectionValues } from "../settings/definitions.js";

/*
 * Matching the filaments of a sliced plate to the trays of a printer. Done only at dispatch, on
 * what the printer reports at that moment. The system proposes, a person confirms and may change
 * it; whatever they pick is checked again with the same rules.
 */

export interface SliceFilament {
  slot: number;
  extruder: number | null;
  material: string;
  subType: string | null;
  colour: string;
  usedGrams: number;
}

export interface NozzleSpec {
  extruder: number;
  diameterMm: number;
  flow?: string | null;
}

export interface TrayState {
  unit: number;
  slot: number;
  material: string | null;
  subType: string | null;
  colour: string | null;
  /** Extruders this tray can feed; empty when the printer does not say. */
  extruders: number[];
  /** Grams left by the panel's own count. */
  remainingGrams: number;
}

export type CheckRule = "REACH" | "EMPTY" | "NOZZLE" | "DUPLICATE" | "MATERIAL" | "SUB_TYPE" | "COLOUR" | "REMAINING";
export type CheckResult = "OK" | "WARN" | "BLOCK";
export interface Check {
  rule: CheckRule;
  result: CheckResult;
  deltaE?: number | null;
}

export interface MappingContext {
  filaments: SliceFilament[];
  sliceNozzles: NozzleSpec[];
  printerNozzles: NozzleSpec[];
  trays: TrayState[];
  colourPref: "EXACT" | "SIMILAR" | "ANY";
  rules: SectionValues<"mapping">;
}

export interface Choice {
  sliceSlot: number;
  tray: { unit: number; slot: number };
}

const sameTray = (a: { unit: number; slot: number }, b: { unit: number; slot: number }) => a.unit === b.unit && a.slot === b.slot;
const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * Checks one filament against one tray. Physical limits (out of reach, empty tray, wrong nozzle,
 * one tray for two filaments) always block. Material, sub-type and colour differences block or
 * warn as configured; a warning can be dispatched once the dispatcher picks a reason. Running low
 * only warns.
 */
export function checkEntry(c: MappingContext, filament: SliceFilament, tray: TrayState | undefined, all: Choice[]): Check[] {
  if (!tray) return [{ rule: "EMPTY", result: "BLOCK" }];
  const checks: Check[] = [];
  const add = (rule: CheckRule, result: CheckResult, deltaE?: number) => checks.push({ rule, result, ...(deltaE === undefined ? {} : { deltaE }) });

  add("REACH", filament.extruder !== null && tray.extruders.length > 0 && !tray.extruders.includes(filament.extruder) ? "BLOCK" : "OK");
  add("EMPTY", tray.material ? "OK" : "BLOCK");
  const want = c.sliceNozzles.find((n) => n.extruder === (filament.extruder ?? 1));
  const have = c.printerNozzles.find((n) => n.extruder === (filament.extruder ?? 1));
  add("NOZZLE", want && have && Math.abs(want.diameterMm - have.diameterMm) > 1e-6 ? "BLOCK" : "OK");
  add("DUPLICATE", all.filter((x) => sameTray(x.tray, tray)).length > 1 ? "BLOCK" : "OK");
  if (!tray.material) return checks;

  add("MATERIAL", norm(tray.material) === norm(filament.material) ? "OK" : c.rules.materialMismatch === "BLOCK" ? "BLOCK" : "WARN");
  const subTypeDiffers = !!filament.subType && !!tray.subType && norm(filament.subType) !== norm(tray.subType);
  add("SUB_TYPE", !subTypeDiffers || c.rules.subTypeMismatch === "IGNORE" ? "OK" : c.rules.subTypeMismatch === "BLOCK" ? "BLOCK" : "WARN");
  const dE = tray.colour ? Math.round(deltaE2000(filament.colour, tray.colour) * 10) / 10 : undefined;
  const limit = c.colourPref === "EXACT" ? c.rules.sameColourDeltaE : c.colourPref === "SIMILAR" ? c.rules.similarColourDeltaE : Infinity;
  add("COLOUR", dE === undefined || dE <= limit ? "OK" : "WARN", dE);
  add("REMAINING", tray.remainingGrams < filament.usedGrams ? "WARN" : "OK");
  return checks;
}

export function checkMapping(c: MappingContext, choices: Choice[]): { entry: Choice; checks: Check[] }[] {
  return choices.map((entry) => {
    const filament = c.filaments.find((f) => f.slot === entry.sliceSlot);
    const tray = c.trays.find((t) => sameTray(t, entry.tray));
    return { entry, checks: filament ? checkEntry(c, filament, tray, choices) : [{ rule: "EMPTY" as const, result: "BLOCK" as const }] };
  });
}

/**
 * The mapping the system suggests. For each filament, in slot order: among trays not taken yet
 * and not blocked, prefer no warnings, then the closest colour, then the same sub-type, then the
 * lowest tray. The same input always gives the same result. A filament with no possible tray is
 * left out and reported.
 */
export function proposeMapping(c: MappingContext): { choices: Choice[]; unmatched: number[] } {
  const choices: Choice[] = [];
  const unmatched: number[] = [];
  for (const f of [...c.filaments].sort((a, b) => a.slot - b.slot)) {
    const candidates = c.trays
      .filter((t) => !choices.some((x) => sameTray(x.tray, t)))
      .map((t) => {
        const checks = checkEntry(c, f, t, []);
        return {
          tray: t,
          blocked: checks.some((k) => k.result === "BLOCK"),
          warnings: checks.filter((k) => k.result === "WARN").length,
          deltaE: checks.find((k) => k.rule === "COLOUR")?.deltaE ?? 0,
          sameSubType: norm(t.subType) === norm(f.subType) ? 0 : 1,
        };
      })
      .filter((x) => !x.blocked)
      .sort((a, b) => a.warnings - b.warnings || a.deltaE - b.deltaE || a.sameSubType - b.sameSubType || a.tray.unit - b.tray.unit || a.tray.slot - b.tray.slot);
    if (candidates.length) choices.push({ sliceSlot: f.slot, tray: { unit: candidates[0].tray.unit, slot: candidates[0].tray.slot } });
    else unmatched.push(f.slot);
  }
  return { choices, unmatched };
}

/* ───────── colour difference ───────── */

function lab(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 difference between two #RRGGBB colours: about 1 is barely visible, above 15 clearly another colour. */
export function deltaE2000(hexA: string, hexB: string): number {
  if (!/^#?[0-9a-f]{6}/i.test(hexA) || !/^#?[0-9a-f]{6}/i.test(hexB)) return 0;
  const [L1, a1, b1] = lab(hexA);
  const [L2, a2, b2] = lab(hexB);
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1 = Math.hypot(a1p, b1);
  const c2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = c2 - c1;
  let dh = h2 - h1;
  if (c1 * c2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const lBar = (L1 + L2) / 2;
  const cBarP = (c1 + c2) / 2;
  let hBar = h1 + h2;
  if (c1 * c2 !== 0) hBar = Math.abs(h1 - h2) <= 180 ? hBar / 2 : hBar < 360 ? (hBar + 360) / 2 : (hBar - 360) / 2;
  const t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad) + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.2 * Math.cos((4 * hBar - 63) * rad);
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
}
