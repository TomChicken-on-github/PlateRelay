import { Controller, Get, Global, HttpStatus, Inject, Module, Query, Res } from "@nestjs/common";
import { join } from "node:path";
import type { Response } from "express";
import { Public } from "../auth/actor.js";
import { ApiError } from "../common/errors.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { LocalDiskStorage } from "./local-disk.storage.js";
import { S3Storage } from "./s3.storage.js";
import { type ObjectStorage, STORAGE } from "./storage.js";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", "3mf": "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" };

/** Serves local-disk objects behind signed links. With the S3 backend, links point at the bucket and this route refuses. */
@Controller("files")
class FilesController {
  constructor(@Inject(STORAGE) private readonly storage: ObjectStorage) {}

  @Public()
  @Get()
  async download(@Query("k") key: string, @Query("e") e: string, @Query("s") sig: string, @Query("n") name: string | undefined, @Res() res: Response) {
    if (!(this.storage instanceof LocalDiskStorage) || typeof key !== "string" || typeof sig !== "string" || !this.storage.verify(key, Number(e), sig, name ?? "")) {
      throw new ApiError(HttpStatus.FORBIDDEN, "bad-signature", "链接无效或已过期");
    }
    let stream;
    try {
      stream = await this.storage.get(key);
    } catch {
      throw new ApiError(HttpStatus.NOT_FOUND, "not-found", "文件不存在");
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
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): ObjectStorage => (c.storage.kind === "s3" ? new S3Storage(c.storage) : new LocalDiskStorage(join(c.dataDir, "storage"), c.secret, "/api/files")),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
