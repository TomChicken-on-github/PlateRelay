import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { type Gcode3mfInfo, Gcode3mfError, parseGcode3mf, type ParsedUpload, type ParseErrorBody } from "@platerelay/shared";

/**
 * Reads plate metadata out of an uploaded .gcode.3mf. Kept on its own so the
 * order module can call it on submit and the result stays authoritative
 * whatever the browser showed.
 */
@Injectable()
export class Gcode3mfService {
  parse(fileName: string, data: Uint8Array): ParsedUpload {
    const info = this.read(fileName, data);
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

  /** Parsed metadata with the preview PNGs as bytes; parse errors become 422/413 {code, message}. */
  read(fileName: string, data: Uint8Array): Gcode3mfInfo {
    try {
      return parseGcode3mf(data, { fileName });
    } catch (e) {
      if (!(e instanceof Gcode3mfError)) throw e;
      const body: ParseErrorBody = { code: e.code, message: e.message };
      throw new HttpException(body, e.code === "too-large" ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }
}
