import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { checkUpload, Gcode3mfError, MAX_UPLOAD_BYTES, parseGcode3mf } from "../src/index";

/*
 * Fixtures are the metadata files of two real Bambu Studio 02.08.02.61 exports
 * (project_settings trimmed to the keys we read). The archive around them is
 * rebuilt here with stand-in G-code and PNGs, so the repo carries no models.
 */
const FIX = join(import.meta.dirname, "fixtures");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

function build(fixture: string, plates: number[], extra: Zippable = {}): Uint8Array {
  const files: Zippable = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "3D/3dmodel.model": strToU8("<model/>"),
  };
  for (const f of ["slice_info.config", "model_settings.config", "project_settings.config"]) {
    files[`Metadata/${f}`] = readFileSync(join(FIX, fixture, f));
  }
  for (const n of plates) {
    files[`Metadata/plate_${n}.gcode`] = strToU8("; HEADER_BLOCK_START\n");
    files[`Metadata/plate_${n}.png`] = PNG;
  }
  return zipSync({ ...files, ...extra });
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof Gcode3mfError ? e.code : `unexpected: ${String(e)}`;
  }
  return "no error";
};

describe("parseGcode3mf", () => {
  it("reads a single-plate P2S export", () => {
    const info = parseGcode3mf(build("p2s-single", [1]), { fileName: "铜钱.gcode.3mf" });
    expect(info.slicer).toEqual({ name: "BambuStudio", version: "02.08.02.61" });
    expect(info.printerModel).toBe("Bambu Lab P2S");
    expect(info.bedType).toBe("Textured PEI Plate");
    expect(info.layerHeight).toBe(0.2);
    expect(info.plates).toHaveLength(1);

    const [p] = info.plates;
    expect(p).toMatchObject({ index: 1, printerModelId: "N7", printSeconds: 8250, weightGrams: 29.37, supportUsed: false, outside: false });
    expect(p.nozzles).toEqual([{ extruder: 1, side: null, diameter: 0.4, volumeType: "Standard" }]);
    expect(p.filaments).toEqual([
      { slot: 1, type: "PLA", color: "#FFFFFF", usedGrams: 29.37, usedMeters: 9.69, presetId: "GFA00", extruder: 1, forObject: true, forSupport: false },
    ]);
    expect(p.objects).toHaveLength(20);
    expect(p.gcodePath).toBe("Metadata/plate_1.gcode");
    expect(p.thumbnailPath).toBe("Metadata/plate_1.png");
    expect(p.thumbnail).toEqual(PNG);
  });

  it("splits a two-plate X2D export and maps filaments to left/right nozzles", () => {
    const info = parseGcode3mf(build("x2d-two-plates", [1, 2]));
    expect(info.printerModel).toBe("Bambu Lab X2D");
    expect(info.plates.map((p) => [p.index, p.printerModelId, p.printSeconds, p.weightGrams])).toEqual([
      [1, "N6", 16479, 117.79],
      [2, "N6", 7922, 53.03],
    ]);

    const [p1, p2] = info.plates;
    expect(p1.nozzles.map((n) => [n.extruder, n.side, n.diameter])).toEqual([
      [1, "left", 0.4],
      [2, "right", 0.4],
    ]);
    expect(p1.filaments.map((f) => [f.slot, f.type, f.color, f.usedGrams, f.extruder, f.forObject, f.forSupport])).toEqual([
      [1, "PLA", "#FFFF00", 111.09, 1, true, true],
      [2, "PETG", "#FFFFFF", 6.7, 2, false, true],
    ]);
    expect(p1.supportUsed).toBe(true);

    /* Plate 2 only uses the left nozzle, but the printer still has two. */
    expect(p2.nozzles).toEqual([{ extruder: 1, side: "left", diameter: 0.4, volumeType: "Standard" }]);
    expect(p2.filaments.map((f) => [f.slot, f.type, f.extruder])).toEqual([[1, "PLA", 1]]);
    expect(p2.thumbnailPath).toBe("Metadata/plate_2.png");
  });

  it("skips thumbnails when asked", () => {
    const info = parseGcode3mf(build("x2d-two-plates", [1, 2]), { thumbnails: false });
    expect(info.plates.map((p) => p.thumbnail)).toEqual([null, null]);
    expect(info.plates[0].thumbnailPath).toBe("Metadata/plate_1.png");
  });

  it("ignores a thumbnail that is not a PNG", () => {
    const info = parseGcode3mf(build("p2s-single", [1], { "Metadata/plate_1.png": strToU8("<svg/>") }));
    expect(info.plates[0].thumbnail).toBeNull();
  });

  it("decodes XML entities in names", () => {
    const zip = build("p2s-single", [1], {
      "Metadata/slice_info.config": strToU8(
        readFileSync(join(FIX, "p2s-single", "slice_info.config"), "utf8").replace('name="2.stl"', 'name="A&amp;B &#x94DC;.stl"'),
      ),
    });
    expect(parseGcode3mf(zip).plates[0].objects[1]).toBe("A&B 铜.stl");
  });

  it("rejects wrong extensions and oversized files before unzipping", () => {
    expect(code(() => checkUpload("part.3mf", 10))).toBe("bad-extension");
    expect(code(() => checkUpload("part.gcode", 10))).toBe("bad-extension");
    expect(code(() => checkUpload("PART.GCODE.3MF", 10))).toBe("no error");
    expect(code(() => checkUpload("part.gcode.3mf", MAX_UPLOAD_BYTES))).toBe("no error");
    expect(code(() => checkUpload("part.gcode.3mf", MAX_UPLOAD_BYTES + 1))).toBe("too-large");
    expect(code(() => parseGcode3mf(build("p2s-single", [1]), { fileName: "part.stl" }))).toBe("bad-extension");
  });

  it("rejects data that is not a zip", () => {
    expect(code(() => parseGcode3mf(strToU8("solid cube\nendsolid\n")))).toBe("not-zip");
  });

  it("rejects an unsliced project 3MF", () => {
    const zip = zipSync({ "3D/3dmodel.model": strToU8("<model/>"), "Metadata/model_settings.config": strToU8("<config/>") });
    expect(code(() => parseGcode3mf(zip))).toBe("not-sliced");
  });

  it("rejects a plate whose G-code is missing", () => {
    expect(code(() => parseGcode3mf(build("x2d-two-plates", [1])))).toBe("not-sliced");
  });

  it("rejects a plate without time or weight", () => {
    const zip = build("p2s-single", [1], {
      "Metadata/slice_info.config": strToU8(
        readFileSync(join(FIX, "p2s-single", "slice_info.config"), "utf8").replace('<metadata key="prediction" value="8250"/>', ""),
      ),
    });
    expect(code(() => parseGcode3mf(zip))).toBe("bad-metadata");
  });
});

/* Optional: point PLATERELAY_3MF_SAMPLES at a folder of real exports to smoke-test them. */
const samples = process.env.PLATERELAY_3MF_SAMPLES;
describe.runIf(samples && existsSync(samples))("real samples", () => {
  for (const f of samples ? readdirSync(samples).filter((n) => n.endsWith(".3mf")) : []) {
    it(f, () => {
      const info = parseGcode3mf(readFileSync(join(samples!, f)));
      expect(info.plates.length).toBeGreaterThan(0);
      for (const p of info.plates) expect(p.thumbnail).not.toBeNull();
    });
  }
});
