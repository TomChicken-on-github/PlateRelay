import { Injectable } from "@nestjs/common";

export interface JobCommand {
  orderId: number;
  plateIndex: number;
  /** Storage key of the .gcode.3mf. */
  fileKey: string;
  sha256: string;
}

/**
 * What Staff add when confirming a dispatch, on top of the order's own file. Empty for now: the
 * filament mapping dialog (which slot feeds which filament, not built yet) will put its result here.
 */
export type DispatchJobOptions = Record<never, never>;

/**
 * What the panel asks a printer to do, through its daemon. The daemon link
 * (WebSocket, brief §5.6) implements this in a later change; until then no
 * printer is reachable and nothing is ever sent to a real printer.
 */
export interface PrinterCommands {
  /** True when the printer's daemon is connected and can take commands now. */
  reachable(printerId: string): boolean;
  startJob(printerId: string, job: JobCommand): Promise<void>;
  /** A standard error action (driver draft §6), e.g. RESUME or STOP. */
  resolveError(printerId: string, action: string, errorId: string | null): Promise<void>;
  stop(printerId: string): Promise<void>;
  /** Takes back a dispatched job that has not started printing; the printer stays clean and free. */
  recall(printerId: string, orderId: number): Promise<void>;
  /** 跳过零件: part ids of the running job (Bambu skip_objects obj_list). */
  skipParts(printerId: string, partIds: number[]): Promise<void>;
}

export const PRINTER_COMMANDS = Symbol("PRINTER_COMMANDS");

export class PrinterUnreachable extends Error {
  constructor(printerId: string) {
    super(`printer ${printerId} is not reachable`);
  }
}

@Injectable()
export class NoDaemonCommands implements PrinterCommands {
  reachable() {
    return false;
  }
  async startJob(printerId: string): Promise<void> {
    throw new PrinterUnreachable(printerId);
  }
  async resolveError(printerId: string): Promise<void> {
    throw new PrinterUnreachable(printerId);
  }
  async stop(printerId: string): Promise<void> {
    throw new PrinterUnreachable(printerId);
  }
  async recall(printerId: string): Promise<void> {
    throw new PrinterUnreachable(printerId);
  }
  async skipParts(printerId: string): Promise<void> {
    throw new PrinterUnreachable(printerId);
  }
}
