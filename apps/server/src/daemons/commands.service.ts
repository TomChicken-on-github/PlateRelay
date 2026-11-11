import { Injectable } from "@nestjs/common";
import { type Ctx, userIdOf } from "../common/ctx.js";
import { printerUnreachable } from "../common/problem.js";
import type { Uow } from "../core/uow.js";
import { daemonCommands } from "../db/schema.js";
import { DaemonHub } from "./hub.js";

export type CommandRow = typeof daemonCommands.$inferSelect;
type CommandClass = CommandRow["class"];

/* Seconds within which the daemon must begin a command, or it refuses it as expired. */
const TTL: Record<string, number> = {
  "job.start": 60,
  "job.stop": 60,
  "job.skip_parts": 60,
  "error.resolve": 60,
  control: 30,
  refresh: 10,
  "storage.list": 10,
  "camera.open": 30,
  "camera.close": 30,
  "snapshot.mode": 30,
  "snapshot.now": 30,
  "timelapse.collect": 3600,
};

/* "Set it to this value" controls; every other control changes what the print or the machine is doing. */
const SETPOINT_CATEGORIES = new Set(["light", "temperature", "fan", "speed", "tray", "auto_refill"]);
const CONTROL_KINDS = new Set(["job.start", "job.stop", "job.skip_parts", "error.resolve"]);

export function classOf(kind: string, category?: string): CommandClass {
  if (CONTROL_KINDS.has(kind)) return "CONTROL";
  if (kind === "control") return category && SETPOINT_CATEGORIES.has(category) ? "SETPOINT" : "CONTROL";
  return "READ";
}

/**
 * Commands on their way to a daemon. The panel only tracks delivery; whether a command "worked" is
 * told by what the printer reports afterwards. There is no command lock: nothing here refuses a
 * command because an earlier one has no result yet, and nothing is ever sent again automatically
 * (redelivery of the same command id after a reconnect is not sending again).
 */
@Injectable()
export class CommandsService {
  constructor(private readonly hub: DaemonHub) {}

  /** Refuses with printer_unreachable when the daemon is not connected: commands do not wait for it to come back. */
  requireOnline(daemonId: string) {
    if (!this.hub.isOnline(daemonId)) throw printerUnreachable();
  }

  /** Records a command in the caller's transaction; it goes out when that commits. */
  async enqueue(u: Uow, ctx: Ctx, c: { daemonId: string; printerId: string; jobId?: string | null; kind: string; params: Record<string, unknown>; category?: string }): Promise<CommandRow> {
    const [row] = await u.tx
      .insert(daemonCommands)
      .values({
        daemonId: c.daemonId,
        printerId: c.printerId,
        jobId: c.jobId ?? null,
        kind: c.kind,
        class: classOf(c.kind, c.category),
        payload: c.params,
        requestedBy: userIdOf(ctx),
        expiresAt: new Date(Date.now() + (TTL[c.kind] ?? 30) * 1000),
      })
      .returning();
    u.commands.add(row.id);
    return row;
  }
}
