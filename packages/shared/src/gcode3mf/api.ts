import type { Gcode3mfErrorCode, Gcode3mfInfo, PlateInfo } from "./parse.js";

/* JSON shapes of the panel's parse endpoint (POST /api/gcode3mf/parse). */

export type ParsedPlate = Omit<PlateInfo, "thumbnail"> & {
  /** Plate preview as a data: URL, null when the file has none. */
  thumbnailUrl: string | null;
};

export type ParsedUpload = Omit<Gcode3mfInfo, "plates"> & {
  fileName: string;
  sizeBytes: number;
  plates: ParsedPlate[];
};

export interface ParseErrorBody {
  code: Gcode3mfErrorCode;
  message: string;
}
