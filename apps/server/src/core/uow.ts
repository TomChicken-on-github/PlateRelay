import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, type Db, type Tx } from "../db/db.js";

/**
 * One unit of work: a database transaction plus a note of what it changed. After the commit the
 * note is handed to whoever needs to react (browsers get pushed the changed resources, daemons
 * get the queued commands). Nothing is announced when the transaction rolls back.
 */
export class Uow {
  readonly orders = new Set<string>();
  readonly printers = new Set<string>();
  /** Daemon commands inserted in this transaction, to send once it commits. */
  readonly commands = new Set<string>();
  /** Daemons whose list of printers changed. */
  readonly assignments = new Set<string>();
  queue = false;
  todo = false;

  constructor(readonly tx: Tx) {}
}

type Listener = (u: Uow) => void | Promise<void>;

@Injectable()
export class Work {
  private readonly log = new Logger("Work");
  private readonly listeners: Listener[] = [];

  constructor(@Inject(DB) private readonly db: Db) {}

  afterCommit(l: Listener) {
    this.listeners.push(l);
  }

  async run<T>(fn: (u: Uow) => Promise<T>): Promise<T> {
    let u!: Uow;
    const out = await this.db.transaction((tx) => fn((u = new Uow(tx as unknown as Tx))));
    for (const l of this.listeners) {
      try {
        await l(u);
      } catch (e) {
        this.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
      }
    }
    return out;
  }
}
