import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { and, eq, ne } from "drizzle-orm";
import type { Request, Response } from "express";
import { Problem, notFound, validationFailed } from "../common/problem.js";
import { Work } from "../core/uow.js";
import { DaemonsService } from "../daemons/daemons.service.js";
import { DaemonGateway } from "../daemons/gateway.js";
import { SnapshotStore } from "../daemons/snapshot-store.js";
import { DB, type Db } from "../db/db.js";
import { files, orderVersions, printers, printJobs } from "../db/schema.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";

const ENROLL_FIELDS = ["token", "publicKey", "name", "platform", "daemonVersion", "protocolVersion"] as const;

/**
 * What a daemon calls over plain HTTP, next to its control channel: enrolling once, fetching the
 * file of a job it was told to start, and uploading pictures. Everything but enrolling needs the
 * bearer token handed out on the control channel, which is only good while that connection lives.
 */
@Controller("daemon/v1")
export class DaemonController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly daemons: DaemonsService,
    private readonly gateway: DaemonGateway,
    private readonly snapshots: SnapshotStore,
    private readonly work: Work,
  ) {}

  private daemonId(authorization: string | undefined): string {
    const id = authorization?.startsWith("Bearer ") ? this.gateway.daemonForToken(authorization.slice(7)) : undefined;
    if (!id) throw new Problem(401, "unauthenticated", "bearer token missing, wrong, or from a closed connection");
    return id;
  }

  @Post("enroll")
  @HttpCode(200)
  enroll(@Body() b: Record<string, unknown>) {
    const missing = ENROLL_FIELDS.filter((k) => typeof b?.[k] !== "string" || !b[k]);
    if (missing.length) throw validationFailed(missing.map((k) => ({ path: `/${k}`, code: "required" })));
    return this.daemons.enroll(b as Parameters<DaemonsService["enroll"]>[0]);
  }

  /** The file of a job: only for a job that has not ended, on a printer this daemon looks after. Sent as raw bytes; the daemon checks the hash it was given with the start command. */
  @Get("files/:fileId")
  async file(@Headers("authorization") authorization: string | undefined, @Param("fileId") fileId: string, @Query("jobRef") jobRef: string, @Res() res: Response) {
    const daemonId = this.daemonId(authorization);
    const [row] = jobRef
      ? await this.db
          .select({ file: files })
          .from(printJobs)
          .innerJoin(printers, eq(printers.id, printJobs.printerId))
          .innerJoin(orderVersions, eq(orderVersions.id, printJobs.versionId))
          .innerJoin(files, eq(files.id, orderVersions.fileId))
          .where(and(eq(printJobs.id, jobRef), ne(printJobs.phase, "ENDED"), eq(printers.daemonId, daemonId), eq(files.id, fileId)))
          .catch(() => [])
      : [];
    if (!row || row.file.purgedAt) throw notFound("file");
    res.set({ "Content-Type": "application/octet-stream", "Content-Length": String(row.file.sizeBytes), "X-Content-SHA256": row.file.sha256 });
    (await this.storage.get(row.file.objectKey)).pipe(res);
  }

  /** The picture the daemon takes the moment a job ends. Answered with 201 only once it is stored, so the daemon keeps trying until then. */
  @Put("end-photos/:jobRef")
  @HttpCode(201)
  async endPhoto(@Headers("authorization") authorization: string | undefined, @Headers("x-captured-at") capturedAt: string | undefined, @Param("jobRef") jobRef: string, @Req() req: Request) {
    const daemonId = this.daemonId(authorization);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || !body.length) throw validationFailed([{ path: "", code: "required" }]);
    const [job] = await this.db
      .select({ id: printJobs.id, orderId: printJobs.orderId, printerId: printJobs.printerId })
      .from(printJobs)
      .innerJoin(printers, eq(printers.id, printJobs.printerId))
      .where(and(eq(printJobs.id, jobRef), eq(printers.daemonId, daemonId)))
      .catch(() => []);
    if (!job) throw notFound("job");
    const key = `end-photos/${job.id}.jpg`;
    await this.storage.put(key, body, "image/jpeg");
    const at = capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt) : new Date();
    await this.work.run(async (u) => {
      await u.tx.update(printJobs).set({ endPhotoKey: key, endPhotoAt: at }).where(eq(printJobs.id, job.id));
      u.orders.add(job.orderId);
    });
    return {};
  }

  @Put("snapshots/:printerId")
  @HttpCode(204)
  async snapshot(@Headers("authorization") authorization: string | undefined, @Headers("x-captured-at") capturedAt: string | undefined, @Param("printerId") printerId: string, @Req() req: Request) {
    const daemonId = this.daemonId(authorization);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || !body.length) throw validationFailed([{ path: "", code: "required" }]);
    const [p] = await this.db
      .select({ id: printers.id })
      .from(printers)
      .where(and(eq(printers.id, printerId), eq(printers.daemonId, daemonId)))
      .catch(() => []);
    if (!p) throw notFound("printer");
    this.snapshots.put(p.id, body, capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : new Date().toISOString());
  }
}
