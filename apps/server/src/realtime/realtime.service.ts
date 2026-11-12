import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type { Response } from "express";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { type Uow, Work } from "../core/uow.js";
import { DB, type Db } from "../db/db.js";
import { daemonCommands, orders, printers } from "../db/schema.js";
import { OrderViews } from "../orders/views.js";
import { PrinterViews } from "../printers/views.js";

interface Client {
  streamId: string;
  ctx: Ctx;
  res: Response;
}

const PRESENCE_MS = 45_000;
const PRINTER_PUSH_MS = 1000;
const KEEPALIVE_MS = 25_000;

/**
 * Pushes changes to browsers over Server-Sent Events. After every committed change the resources
 * it touched are sent again in full, cut to what each listener may see, so the front end only ever
 * replaces what it has. Queue and to-do changes are just a hint to fetch the list again.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly clients = new Map<string, Client>();
  private lastId = 0;
  /** Printers with a push waiting: one printer is pushed at most once a second. */
  private readonly pendingPrinters = new Set<string>();
  private printerTimer: NodeJS.Timeout | null = null;
  private readonly keepalive: NodeJS.Timeout;
  /** Who has a printer's detail page open: printer → stream → when it last said so. Memory only. */
  private readonly presence = new Map<string, Map<string, number>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    work: Work,
    private readonly orderViews: OrderViews,
    private readonly printerViews: PrinterViews,
  ) {
    work.afterCommit((u) => this.changed(u));
    this.keepalive = setInterval(() => {
      for (const c of this.clients.values()) c.res.write(": keepalive\n\n");
      this.expirePresence();
    }, KEEPALIVE_MS);
    this.keepalive.unref();
  }

  onModuleDestroy() {
    clearInterval(this.keepalive);
    if (this.printerTimer) clearTimeout(this.printerTimer);
    for (const c of this.clients.values()) c.res.end();
    this.clients.clear();
  }

  /** Opens a stream. A browser that reconnects is told to fetch everything again: what it missed is not replayed. */
  open(ctx: Ctx, res: Response, lastEventId: string | undefined) {
    const client: Client = { streamId: randomUUID(), ctx, res };
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    this.clients.set(client.streamId, client);
    res.on("close", () => {
      this.clients.delete(client.streamId);
      for (const [printerId, viewers] of this.presence) if (viewers.delete(client.streamId)) void this.pushPresence(printerId);
    });
    this.send(client, "stream.opened", { streamId: client.streamId });
    if (lastEventId !== undefined && lastEventId !== String(this.lastId)) this.send(client, "resync", {});
  }

  /** Ends every stream of a user, so the browser reconnects with the account's new role or finds it disabled. */
  dropUser(userId: string) {
    for (const c of this.clients.values()) if (userIdOf(c.ctx) === userId) c.res.end();
  }

  private send(c: Client, event: string, data: unknown) {
    c.res.write(`id: ${++this.lastId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private async changed(u: Uow) {
    if (!this.clients.size) return;
    for (const id of u.printers) this.pendingPrinters.add(id);
    if (this.pendingPrinters.size && !this.printerTimer) {
      this.printerTimer = setTimeout(() => {
        this.printerTimer = null;
        void this.pushPrinters();
      }, PRINTER_PUSH_MS);
      this.printerTimer.unref();
    }
    if (u.orders.size) {
      const rows = await this.db.select().from(orders).where(inArray(orders.id, [...u.orders]));
      for (const c of [...this.clients.values()]) {
        for (const o of rows) {
          if (o.ownerId !== userIdOf(c.ctx) && !can(c.ctx, "order:view:any")) continue;
          this.send(c, "order.updated", await this.orderViews.detail(c.ctx, o));
        }
      }
    }
    if (u.commands.size) {
      const rows = await this.db.select().from(daemonCommands).where(inArray(daemonCommands.id, [...u.commands]));
      for (const c of this.clients.values()) {
        if (!can(c.ctx, "printer:operate")) continue;
        for (const r of rows) this.send(c, "command.updated", { commandId: r.id, printerId: r.printerId, kind: r.kind, status: r.status, code: (r.result as { code?: string } | null)?.code ?? null });
      }
    }
    for (const c of this.clients.values()) {
      if (u.queue && c.ctx.actor.type === "USER") this.send(c, "queue.changed", {});
      if (u.todo && (can(c.ctx, "order:review") || can(c.ctx, "printer:operate"))) this.send(c, "todo.changed", {});
    }
  }

  private async pushPrinters() {
    const ids = [...this.pendingPrinters];
    this.pendingPrinters.clear();
    const rows = await this.db.select().from(printers).where(inArray(printers.id, ids));
    for (const c of [...this.clients.values()]) {
      for (const p of rows) {
        const operator = can(c.ctx, "printer:operate");
        if (p.disabledAt && !operator) continue;
        if (!operator && !can(c.ctx, "overview:view")) continue;
        this.send(c, "printer.updated", operator ? await this.printerViews.detail(c.ctx, p) : await this.printerViews.card(c.ctx, p));
      }
    }
  }

  /* ───────── who is looking at a printer ───────── */

  async setPresence(ctx: Ctx, printerId: string, streamId: string, present: boolean) {
    const c = this.clients.get(streamId);
    if (!c || userIdOf(c.ctx) !== userIdOf(ctx)) return;
    const viewers = this.presence.get(printerId) ?? new Map<string, number>();
    const had = viewers.has(streamId);
    if (present) viewers.set(streamId, Date.now());
    else viewers.delete(streamId);
    this.presence.set(printerId, viewers);
    if (had !== present) await this.pushPresence(printerId);
  }

  private expirePresence() {
    const cutoff = Date.now() - PRESENCE_MS;
    for (const [printerId, viewers] of this.presence) {
      let changed = false;
      for (const [streamId, at] of viewers) if (at < cutoff) changed = viewers.delete(streamId) || changed;
      if (changed) void this.pushPresence(printerId);
    }
  }

  private async pushPresence(printerId: string) {
    const viewers = [...(this.presence.get(printerId)?.keys() ?? [])].map((id) => this.clients.get(id)).filter((c): c is Client => !!c);
    const data = { printerId, viewers: viewers.map((c) => ({ streamId: c.streamId, id: userIdOf(c.ctx), name: c.ctx.actor.type === "USER" ? c.ctx.actor.displayName : "", avatarUrl: null })) };
    for (const c of viewers) this.send(c, "printer.presence", data);
  }

  /** Tells the people looking at a printer who just pressed what. */
  async commandSent(ctx: Ctx, printerId: string, commandId: string, kind: string) {
    const [p] = await this.db.select({ id: printers.id }).from(printers).where(eq(printers.id, printerId));
    if (!p || ctx.actor.type !== "USER") return;
    const data = { printerId, commandId, kind, actor: { id: ctx.actor.id, name: ctx.actor.displayName, avatarUrl: null }, at: new Date().toISOString() };
    for (const id of this.presence.get(printerId)?.keys() ?? []) {
      const c = this.clients.get(id);
      if (c) this.send(c, "command.sent", data);
    }
  }
}
