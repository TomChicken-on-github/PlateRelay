import { HttpException, HttpStatus, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Gcode3mfError, type ParsedUpload, type ParseErrorBody } from "@platerelay/shared";
import { ParseBusy, type Parsed, ParsePool, ParseTimeout } from "./parse-pool.js";

/**
 * Reads plate metadata out of an uploaded .gcode.3mf. Kept on its own so the
 * order module can call it on submit and the result stays authoritative
 * whatever the browser showed. The parse runs in worker threads (ParsePool).
 */
@Injectable()
export class Gcode3mfService implements OnModuleDestroy {
  private readonly pool = ParsePool.fromEnv();

  async onModuleDestroy() {
    await this.pool.close();
  }

  async parse(fileName: string, data: Uint8Array): Promise<ParsedUpload> {
    const { sha256: _hash, ...info } = await this.read(fileName, data);
    return {
      ...info,
      fileName,
      sizeBytes: data.byteLength,
      plates: info.plates.map(({ thumbnail, partsView: _view, ...p }) => ({
        ...p,
        thumbnailUrl: thumbnail ? `data:image/png;base64,${Buffer.from(thumbnail).toString("base64")}` : null,
      })),
    };
  }

  /** Parsed metadata with the preview PNGs as bytes, and the file's SHA-256; parse errors become 422/413 {code, message}, a full queue 503, a parse too slow 422. */
  async read(fileName: string, data: Uint8Array): Promise<Parsed> {
    try {
      return await this.pool.parse(fileName, data);
    } catch (e) {
      if (e instanceof Gcode3mfError) {
        const body: ParseErrorBody = { code: e.code, message: e.message };
        throw new HttpException(body, e.code === "too-large" ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (e instanceof ParseBusy) throw new HttpException({ code: "parse-busy", message: "正在解析的文件太多，请稍后再试" }, HttpStatus.SERVICE_UNAVAILABLE);
      if (e instanceof ParseTimeout) throw new HttpException({ code: "parse-timeout", message: "文件解析超时，请检查文件是否完整" }, HttpStatus.UNPROCESSABLE_ENTITY);
      throw e;
    }
  }
}
