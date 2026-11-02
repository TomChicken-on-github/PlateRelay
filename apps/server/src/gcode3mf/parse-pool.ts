import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { type Gcode3mfInfo, Gcode3mfError, type Gcode3mfErrorCode } from "@platerelay/shared";

export interface ParsePoolOptions {
  /** Parses running at once. */
  workers: number;
  /** Parses waiting for a worker; one more is refused with ParseBusy. */
  maxQueue: number;
  /** A parse running longer than this is killed and its worker replaced. */
  timeoutMs: number;
  /** V8 heap cap of each worker, in MB. */
  heapMb: number;
}

/** Every worker is busy and the queue is full. */
export class ParseBusy extends Error {
  constructor() {
    super("parse queue is full");
  }
}

/** The parse took longer than timeoutMs and was killed. */
export class ParseTimeout extends Error {
  constructor(ms: number) {
    super(`parse took longer than ${ms} ms`);
  }
}

/** The parse result plus the hex SHA-256 of the whole file. */
export type Parsed = Gcode3mfInfo & { sha256: string };

type Job = { id: number; fileName: string; data: Uint8Array; ok: (i: Parsed) => void; fail: (e: Error) => void };
type Slot = { worker: Worker; job: Job | null; timer: NodeJS.Timeout | null };
type Reply = { id: number; ok: true; info: Gcode3mfInfo; sha256: string } | { id: number; ok: false; code: Gcode3mfErrorCode | null; message: string };

const WORKER = join(__dirname, "parse.worker.js");

/**
 * Uploaded .gcode.3mf files are parsed in worker threads, never on the main thread: the parse is CPU
 * work on untrusted input, and on the main thread one hostile or merely large file stalls every request.
 * Bounded on every side: a fixed number of workers, a short queue (more is refused at once), a time limit
 * per parse (the worker is terminated and replaced) and a heap cap per worker. Workers start on first use.
 */
export class ParsePool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private seq = 0;
  private closed = false;

  constructor(private readonly opts: ParsePoolOptions) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ParsePool {
    const n = (k: string, d: number) => (Number.isInteger(Number(env[k])) && Number(env[k]) > 0 ? Number(env[k]) : d);
    return new ParsePool({
      workers: n("PLATERELAY_PARSE_WORKERS", Math.max(1, Math.min(4, availableParallelism() - 1))),
      maxQueue: n("PLATERELAY_PARSE_QUEUE", 16),
      timeoutMs: n("PLATERELAY_PARSE_TIMEOUT_MS", 15_000),
      heapMb: 256,
    });
  }

  /**
   * Parses a copy of `data` (the caller keeps its buffer, e.g. to store the file afterwards).
   * Rejects with Gcode3mfError for a bad file, ParseBusy, ParseTimeout, or an Error when a worker failed.
   */
  parse(fileName: string, data: Uint8Array): Promise<Parsed> {
    if (this.closed) return Promise.reject(new Error("parse pool is closed"));
    if (this.queue.length >= this.opts.maxQueue && !this.idleSlot()) return Promise.reject(new ParseBusy());
    return new Promise((ok, fail) => {
      this.queue.push({ id: ++this.seq, fileName, data, ok, fail });
      this.pump();
    });
  }

  async close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.fail(new Error("parse pool is closed"));
    await Promise.all(this.slots.splice(0).map((s) => this.stop(s, new Error("parse pool is closed"))));
  }

  private idleSlot(): Slot | undefined {
    return this.slots.find((s) => !s.job) ?? (this.slots.length < this.opts.workers ? this.spawn() : undefined);
  }

  private spawn(): Slot {
    const worker = new Worker(WORKER, { resourceLimits: { maxOldGenerationSizeMb: this.opts.heapMb } });
    worker.unref();
    const slot: Slot = { worker, job: null, timer: null };
    worker.on("message", (r: Reply) => {
      const job = slot.job;
      if (!job || r.id !== job.id) return;
      this.finish(slot);
      if (r.ok) job.ok({ ...r.info, sha256: r.sha256 });
      else job.fail(r.code ? new Gcode3mfError(r.code, r.message) : new Error(`parse worker: ${r.message}`));
      this.pump();
    });
    /* a crash (out of memory, a bug): fail the job it had and replace the worker */
    const lost = (why: Error) => {
      const job = slot.job;
      this.finish(slot);
      this.drop(slot);
      job?.fail(why);
      this.pump();
    };
    worker.on("error", lost);
    worker.on("exit", (code) => lost(new Error(`parse worker exited with code ${code}`)));
    this.slots.push(slot);
    return slot;
  }

  private pump() {
    while (this.queue.length) {
      const slot = this.idleSlot();
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.finish(slot);
        this.drop(slot);
        void slot.worker.terminate();
        job.fail(new ParseTimeout(this.opts.timeoutMs));
        this.pump();
      }, this.opts.timeoutMs);
      /* the worker gets its own copy, moved over without a second copy */
      const copy = new Uint8Array(job.data);
      slot.worker.ref();
      slot.worker.postMessage({ id: job.id, fileName: job.fileName, data: copy }, [copy.buffer]);
    }
  }

  private finish(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job = null;
    slot.worker.unref();
  }

  private drop(slot: Slot) {
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    slot.worker.removeAllListeners("exit");
    slot.worker.removeAllListeners("error");
    slot.worker.removeAllListeners("message");
    /* an 'error' with no listener would throw on the main thread */
    slot.worker.on("error", () => undefined);
  }

  private async stop(slot: Slot, why: Error) {
    const job = slot.job;
    this.finish(slot);
    this.drop(slot);
    job?.fail(why);
    await slot.worker.terminate();
  }
}
