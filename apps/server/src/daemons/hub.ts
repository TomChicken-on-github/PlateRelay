import { Injectable } from "@nestjs/common";

export interface DaemonLink {
  daemonId: string;
  sessionId: string;
  /** Sends one protocol message; false when the socket is no longer open. */
  send(type: string, body: unknown, id?: string): boolean;
  close(code: number, reason: string): void;
}

/** Which daemons are connected right now. Being online is never stored: it is whether a link is in this map. */
@Injectable()
export class DaemonHub {
  private readonly links = new Map<string, DaemonLink>();

  isOnline(daemonId: string): boolean {
    return this.links.has(daemonId);
  }

  get(daemonId: string): DaemonLink | undefined {
    return this.links.get(daemonId);
  }

  /** Registers a link; an older link of the same daemon is returned so the caller can close it (the newer connection wins). */
  attach(link: DaemonLink): DaemonLink | undefined {
    const old = this.links.get(link.daemonId);
    this.links.set(link.daemonId, link);
    return old;
  }

  /** Removes the link if it is still the daemon's current one. */
  detach(link: DaemonLink): boolean {
    if (this.links.get(link.daemonId) !== link) return false;
    this.links.delete(link.daemonId);
    return true;
  }

  all(): DaemonLink[] {
    return [...this.links.values()];
  }
}
