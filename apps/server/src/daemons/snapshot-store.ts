import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface Shot {
  data: Buffer;
  capturedAt: string;
  etag: string;
}

/** The newest camera still of each printer. Kept in memory only and replaced by the next one; never written to disk. */
@Injectable()
export class SnapshotStore {
  private readonly shots = new Map<string, Shot>();

  put(printerId: string, data: Buffer, capturedAt: string) {
    this.shots.set(printerId, { data, capturedAt, etag: `"${createHash("sha256").update(data).digest("base64url").slice(0, 22)}"` });
  }

  get(printerId: string): Shot | undefined {
    return this.shots.get(printerId);
  }
}
