import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ParsedUpload } from "@platerelay/shared";
import { strToU8, zipSync } from "fflate";
import request from "supertest";
import { Gcode3mfModule } from "../src/gcode3mf/gcode3mf.module.js";

/* Same fixtures as the shared parser tests: real slicer metadata, stand-in G-code and PNG. */
const FIX = join(__dirname, "../../../../packages/shared/test/fixtures/x2d-two-plates");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

function x2dTwoPlates(): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const f of ["slice_info.config", "model_settings.config", "project_settings.config"]) files[`Metadata/${f}`] = readFileSync(join(FIX, f));
  for (const n of [1, 2]) {
    files[`Metadata/plate_${n}.gcode`] = strToU8("G28\n");
    files[`Metadata/plate_${n}.png`] = PNG;
  }
  return Buffer.from(zipSync(files));
}

describe("POST /api/gcode3mf/parse", () => {
  let app: INestApplication;

  before(async () => {
    const mod = await Test.createTestingModule({ imports: [Gcode3mfModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });
  after(() => app.close());

  it("returns one entry per plate with a PNG data URL", async () => {
    const res = await request(app.getHttpServer()).post("/api/gcode3mf/parse").attach("file", x2dTwoPlates(), "猫耳外壳.gcode.3mf").expect(200);
    const body = res.body as ParsedUpload;
    assert.equal(body.fileName, "猫耳外壳.gcode.3mf");
    assert.equal(body.printerModel, "Bambu Lab X2D");
    assert.deepEqual(
      body.plates.map((p) => [p.index, p.printerModelId, p.printSeconds, p.weightGrams]),
      [
        [1, "N6", 16479, 117.79],
        [2, "N6", 7922, 53.03],
      ],
    );
    assert.equal(body.plates[0].thumbnailUrl, `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    assert.equal("thumbnail" in body.plates[0], false);
  });

  it("rejects a file that is not .gcode.3mf with 422", async () => {
    const res = await request(app.getHttpServer()).post("/api/gcode3mf/parse").attach("file", x2dTwoPlates(), "part.3mf").expect(422);
    assert.equal(res.body.code, "bad-extension");
  });

  it("rejects a broken archive with 422", async () => {
    const res = await request(app.getHttpServer()).post("/api/gcode3mf/parse").attach("file", Buffer.from("not a zip"), "part.gcode.3mf").expect(422);
    assert.equal(res.body.code, "not-zip");
  });

  it("asks for the file field", async () => {
    await request(app.getHttpServer()).post("/api/gcode3mf/parse").field("x", "1").expect(400);
  });
});
