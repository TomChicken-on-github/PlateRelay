import { unzipSync, type UnzipFileInfo } from "fflate";
import { blocks, metadata, tags } from "./xml.js";

/*
 * Reads the metadata of a Bambu Studio sliced project (.gcode.3mf).
 *
 * Layout confirmed against Bambu Studio 02.08.02.61 exports (P2S single plate,
 * X2D two plates with two nozzles):
 *   Metadata/slice_info.config      one <plate> per sliced plate: printer_model_id,
 *                                   prediction (s), weight (g), <filament>, <nozzle>
 *   Metadata/model_settings.config  one <plate> per plate: gcode_file, thumbnail_file
 *   Metadata/project_settings.config JSON: printer_model, bed type, layer height
 *   Metadata/plate_N.png            plate preview, Metadata/plate_N.gcode the toolpath
 *
 * The upload is untrusted: only the small metadata entries are inflated, each
 * with a size cap, and the G-code itself is never decompressed here.
 */

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;

export type Gcode3mfErrorCode =
  | "bad-extension" // file name does not end in .gcode.3mf
  | "too-large" // over MAX_UPLOAD_BYTES
  | "not-zip" // not a readable zip archive
  | "not-sliced" // a 3MF without sliced plates (a project file, not an export)
  | "bad-metadata"; // slice metadata is missing pieces or malformed

export class Gcode3mfError extends Error {
  constructor(
    readonly code: Gcode3mfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Gcode3mfError";
  }
}

export type NozzleSide = "left" | "right";

export interface NozzleInfo {
  /** 1-based extruder number as Bambu Studio counts them. */
  extruder: number;
  /** Only set on two-nozzle printers (H2D, X2D): extruder 1 is left, 2 is right. */
  side: NozzleSide | null;
  diameter: number;
  /** "Standard" or "High Flow". */
  volumeType: string;
}

export interface FilamentInfo {
  /** 1-based filament slot of the project; matched to an AMS tray when the job is dispatched. */
  slot: number;
  /** e.g. "PLA", "PETG". */
  type: string;
  /** "#RRGGBB" as written by the slicer. */
  color: string;
  usedGrams: number;
  usedMeters: number;
  /** Bambu filament preset id, e.g. "GFA00" for Bambu PLA Basic. */
  presetId: string;
  /** Extruder that prints this filament, or null when the file does not say. */
  extruder: number | null;
  forObject: boolean;
  forSupport: boolean;
}

/** One printable object on a plate, as the printer knows it. */
export interface PlatePart {
  /** identify_id: the id in the G-code object labels, the pick image and the printer's skip command. */
  id: number;
  name: string;
}

export interface PlateInfo {
  /** 1-based plate number in the project; what the printer is told to print. */
  index: number;
  /** Plate name set in the slicer, empty when unnamed. */
  name: string;
  /** Bambu model code, e.g. "N6" (X2D), "N7" (P2S). */
  printerModelId: string;
  printSeconds: number;
  weightGrams: number;
  nozzles: NozzleInfo[];
  filaments: FilamentInfo[];
  objects: string[];
  parts: PlatePart[];
  /** Objects are labelled in the G-code ("label objects" in the slicer), which skipping parts needs. */
  partsLabelled: boolean;
  /**
   * Top view and pick map of the plate (Metadata/top_N.png, pick_N.png), null when absent or when
   * thumbnails were not requested. Each pick map pixel holds a part id as RGB: r + g·256 + b·65536.
   */
  partsView: { top: Uint8Array; pick: Uint8Array } | null;
  supportUsed: boolean;
  /** Slicer flagged an object partly outside the printable area. */
  outside: boolean;
  gcodePath: string;
  thumbnailPath: string | null;
  /** PNG bytes of the plate preview, null when absent or when thumbnails were not requested. */
  thumbnail: Uint8Array | null;
}

export interface Gcode3mfInfo {
  slicer: { name: string; version: string } | null;
  /** e.g. "Bambu Lab X2D"; from the project settings, null when absent. */
  printerModel: string | null;
  /** e.g. "Textured PEI Plate". */
  bedType: string | null;
  layerHeight: number | null;
  plates: PlateInfo[];
}

export interface ParseOptions {
  /** Original file name; when given, it must end in .gcode.3mf. */
  fileName?: string;
  /** Read plate preview PNGs (default true). */
  thumbnails?: boolean;
}

/** Cheap checks to run before reading the upload at all. */
export function checkUpload(fileName: string, sizeBytes: number): void {
  if (!/\.gcode\.3mf$/i.test(fileName)) throw new Gcode3mfError("bad-extension", "只接受 .gcode.3mf 文件");
  if (sizeBytes > MAX_UPLOAD_BYTES) throw new Gcode3mfError("too-large", `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限`);
}

const SLICE_INFO = "Metadata/slice_info.config";
const MODEL_SETTINGS = "Metadata/model_settings.config";
const PROJECT_SETTINGS = "Metadata/project_settings.config";

const num = (s: string | undefined): number => {
  const n = Number(s);
  return s !== undefined && s.trim() !== "" && Number.isFinite(n) ? n : NaN;
};
const list = (s: string | undefined): string[] => (s ?? "").split(/[\s,]+/).filter(Boolean);
const finiteOrNull = (n: number) => (Number.isFinite(n) ? n : null);
const bool = (s: string | undefined) => s === "true" || s === "1";

export function parseGcode3mf(data: Uint8Array, opts: ParseOptions = {}): Gcode3mfInfo {
  if (opts.fileName !== undefined) checkUpload(opts.fileName, data.byteLength);
  else if (data.byteLength > MAX_UPLOAD_BYTES) checkUpload(".gcode.3mf", data.byteLength);
  const wantThumbs = opts.thumbnails ?? true;

  const names = new Set<string>();
  const wanted = (f: UnzipFileInfo) => {
    names.add(f.name);
    if (f.name === SLICE_INFO || f.name === MODEL_SETTINGS || f.name === PROJECT_SETTINGS) return f.originalSize <= MAX_CONFIG_BYTES;
    return wantThumbs && /^Metadata\/(plate|top|pick)_\d+\.png$/.test(f.name) && f.originalSize <= MAX_PNG_BYTES;
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: wanted });
  } catch {
    throw new Gcode3mfError("not-zip", "文件不是有效的 3MF（zip）压缩包");
  }

  const text = (name: string): string | null => {
    const f = files[name];
    if (!f) return null;
    if (f.byteLength > MAX_CONFIG_BYTES) throw new Gcode3mfError("bad-metadata", `${name} 过大`);
    return new TextDecoder().decode(f);
  };

  const sliceInfo = text(SLICE_INFO);
  if (sliceInfo === null) {
    throw new Gcode3mfError("not-sliced", names.has(SLICE_INFO) ? "切片信息过大，无法读取" : "这是未切片的 3MF 工程文件，请在 Bambu Studio 切片后导出 .gcode.3mf");
  }

  /* model_settings maps plate index → gcode and thumbnail paths. */
  const paths = new Map<number, { gcode?: string; thumb?: string; name?: string }>();
  for (const b of blocks(text(MODEL_SETTINGS) ?? "", "plate")) {
    const m = metadata(b);
    const i = num(m.plater_id);
    if (Number.isInteger(i)) paths.set(i, { gcode: m.gcode_file, thumb: m.thumbnail_file, name: m.plater_name });
  }

  let project: Record<string, unknown> = {};
  const projectText = text(PROJECT_SETTINGS);
  if (projectText) {
    try {
      const v: unknown = JSON.parse(projectText);
      if (v && typeof v === "object" && !Array.isArray(v)) project = v as Record<string, unknown>;
    } catch {
      /* Optional: only display fields come from here. */
    }
  }
  const str = (k: string) => (typeof project[k] === "string" && project[k] !== "" ? (project[k] as string) : null);

  const header = metadata(blocks(sliceInfo, "header")[0] ?? "", "header_item");
  const version = header["X-BBL-Client-Version"];

  const plates: PlateInfo[] = blocks(sliceInfo, "plate").map((b) => {
    const m = metadata(b);
    const index = num(m.index);
    if (!Number.isInteger(index) || index < 1) throw new Gcode3mfError("bad-metadata", "切片信息里的盘号无效");

    const p = paths.get(index) ?? {};
    const gcodePath = stripSlash(p.gcode) ?? `Metadata/plate_${index}.gcode`;
    if (!names.has(gcodePath)) throw new Gcode3mfError("not-sliced", `第 ${index} 盘没有 G-code，请重新切片后导出`);
    const thumbnailPath = stripSlash(p.thumb) ?? `Metadata/plate_${index}.png`;

    const nozzleTags = tags(b, "nozzle");
    const twoNozzles = nozzleTags.length === 2 || list(m.nozzle_diameters).length === 2;
    const sideOf = (extruder: number): NozzleSide | null => (twoNozzles ? (extruder === 1 ? "left" : extruder === 2 ? "right" : null) : null);

    const nozzles: NozzleInfo[] = nozzleTags.map(({ attrs: a }) => {
      const extruder = num(a.extruder_id);
      return { extruder, side: sideOf(extruder), diameter: num(a.nozzle_diameter), volumeType: a.volume_type ?? "" };
    });
    if (nozzles.length === 0) {
      /* Older exports: fall back to the plate's diameter list. */
      list(m.nozzle_diameters).forEach((d, i) => nozzles.push({ extruder: i + 1, side: sideOf(i + 1), diameter: num(d), volumeType: "" }));
    }

    /* filament_maps: the n-th entry is the extruder (1-based) of filament slot n. */
    const maps = list(m.filament_maps).map(num);
    const filaments: FilamentInfo[] = tags(b, "filament").map(({ attrs: a }) => {
      const slot = num(a.id);
      const group = num(a.group_id);
      const mapped = maps[slot - 1];
      const extruder = Number.isInteger(mapped) ? mapped : Number.isInteger(group) ? group + 1 : nozzles.length === 1 ? nozzles[0].extruder : null;
      return {
        slot,
        type: a.type ?? "",
        color: a.color ?? "",
        usedGrams: num(a.used_g),
        usedMeters: num(a.used_m),
        presetId: a.tray_info_idx ?? "",
        extruder,
        forObject: bool(a.used_for_object),
        forSupport: bool(a.used_for_support),
      };
    });

    const printSeconds = num(m.prediction);
    const weightGrams = num(m.weight);
    if (!m.printer_model_id || !Number.isFinite(printSeconds) || !Number.isFinite(weightGrams)) {
      throw new Gcode3mfError("bad-metadata", `第 ${index} 盘缺少机型、预估时长或耗材重量`);
    }

    const png = wantThumbs ? files[thumbnailPath] : undefined;
    const parts = tags(b, "object")
      .map(({ attrs: a }) => ({ id: num(a.identify_id), name: a.name ?? "" }))
      .filter((o) => Number.isInteger(o.id) && o.id > 0);
    const top = files[`Metadata/top_${index}.png`];
    const pick = files[`Metadata/pick_${index}.png`];
    return {
      index,
      name: p.name ?? "",
      printerModelId: m.printer_model_id,
      printSeconds,
      weightGrams,
      nozzles,
      filaments,
      objects: tags(b, "object").map((o) => o.attrs.name ?? ""),
      parts,
      partsLabelled: bool(m.label_object_enabled),
      partsView: top && pick && isPng(top) && isPng(pick) ? { top, pick } : null,
      supportUsed: bool(m.support_used),
      outside: bool(m.outside),
      gcodePath,
      thumbnailPath: names.has(thumbnailPath) ? thumbnailPath : null,
      thumbnail: png && isPng(png) ? png : null,
    };
  });

  if (plates.length === 0) throw new Gcode3mfError("not-sliced", "文件里没有已切片的盘");
  plates.sort((a, b) => a.index - b.index);

  return {
    slicer: version ? { name: "BambuStudio", version } : null,
    printerModel: str("printer_model"),
    bedType: str("curr_bed_type"),
    layerHeight: finiteOrNull(num(str("layer_height") ?? undefined)),
    plates,
  };
}

const stripSlash = (p: string | undefined) => (p ? p.replace(/^\/+/, "") : undefined);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => b.length > 8 && PNG_MAGIC.every((v, i) => b[i] === v);
