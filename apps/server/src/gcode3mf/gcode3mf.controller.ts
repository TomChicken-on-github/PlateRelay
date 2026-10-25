import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  HttpCode,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  type ExceptionFilter,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_UPLOAD_BYTES, type ParsedUpload, type ParseErrorBody } from "@platerelay/shared";
import type { Response } from "express";
import { RequirePerm } from "../auth/actor.js";
import { Gcode3mfService } from "./gcode3mf.service.js";

/** Multer stops the upload at the size cap; answer with the parser's error shape. */
@Catch(PayloadTooLargeException)
class TooLargeFilter implements ExceptionFilter {
  catch(_e: PayloadTooLargeException, host: ArgumentsHost) {
    const body: ParseErrorBody = { code: "too-large", message: `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限` };
    host.switchToHttp().getResponse<Response>().status(413).json(body);
  }
}

@Controller("gcode3mf")
@UseFilters(TooLargeFilter)
export class Gcode3mfController {
  constructor(private readonly gcode3mf: Gcode3mfService) {}

  /** Parse without storing anything: the submit page's preview. */
  @Post("parse")
  @RequirePerm("order:submit")
  @HttpCode(200)
  /* defParamCharset: browsers send UTF-8 file names; busboy assumes latin1. */
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, defParamCharset: "utf8" }))
  parse(@UploadedFile() file: Express.Multer.File | undefined): ParsedUpload {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    return this.gcode3mf.parse(file.originalname, file.buffer);
  }
}
