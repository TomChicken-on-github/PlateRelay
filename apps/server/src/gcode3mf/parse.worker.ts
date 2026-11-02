import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { Gcode3mfError, parseGcode3mf } from "@platerelay/shared";

/**
 * Runs parseGcode3mf off the panel's main thread (see ParsePool). One job at a time: the pool sends
 * {id, fileName, data} and gets back {id, ok, info, sha256} or {id, ok: false, code, message}. The file
 * hash is taken here too: hashing a 100 MB upload is also too long to do on the main thread.
 */
parentPort!.on("message", (job: { id: number; fileName: string; data: Uint8Array }) => {
  try {
    const info = parseGcode3mf(job.data, { fileName: job.fileName });
    const sha256 = createHash("sha256").update(job.data).digest("hex");
    /* preview PNGs move back without a copy */
    const transfer = new Set<ArrayBuffer>();
    for (const p of info.plates) {
      if (p.thumbnail) transfer.add(p.thumbnail.buffer as ArrayBuffer);
      if (p.partsView) {
        transfer.add(p.partsView.top.buffer as ArrayBuffer);
        transfer.add(p.partsView.pick.buffer as ArrayBuffer);
      }
    }
    parentPort!.postMessage({ id: job.id, ok: true, info, sha256 }, [...transfer]);
  } catch (e) {
    if (e instanceof Gcode3mfError) parentPort!.postMessage({ id: job.id, ok: false, code: e.code, message: e.message });
    else parentPort!.postMessage({ id: job.id, ok: false, code: null, message: e instanceof Error ? e.message : String(e) });
  }
});
