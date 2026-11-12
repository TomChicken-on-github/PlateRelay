import { Controller, Get, Global, Inject, Module, Query, Res } from "@nestjs/common";
import { join } from "node:path";
import type { Response } from "express";
import { Problem, notFound } from "../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { LocalDiskStorage } from "./local-disk.storage.js";
import { S3Storage } from "./s3.storage.js";
import { type ObjectStorage, STORAGE } from "./storage.js";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", "3mf": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" };

/** Serves local-disk objects behind signed links. With the S3 backend, links point at the bucket and this route refuses. */
@Controller("api/v1/blobs")
class BlobsController {
  constructor(@Inject(STORAGE) private readonly storage: ObjectStorage) {}

  @Get()
  async download(@Query("k") key: string, @Query("e") e: string, @Query("s") sig: string, @Query("n") name: string | undefined, @Res() res: Response) {
    if (!(this.storage instanceof LocalDiskStorage) || typeof key !== "string" || typeof sig !== "string" || !this.storage.verify(key, Number(e), sig, name ?? "")) {
      throw new Problem(403, "forbidden", "the link is wrong or has expired");
    }
    let stream;
    try {
      stream = await this.storage.get(key);
    } catch {
      throw notFound("file");
    }
    res.setHeader("Content-Type", TYPES[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (name) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    stream.pipe(res);
  }
}

@Global()
@Module({
  controllers: [BlobsController],
  providers: [
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): ObjectStorage => (c.storage.kind === "s3" ? new S3Storage(c.storage) : new LocalDiskStorage(join(c.dataDir, "storage"), c.secret, "/api/v1/blobs")),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
