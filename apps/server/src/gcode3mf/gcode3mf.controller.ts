import {
  ArgumentsHost,
  BadRequestException,
  type CanActivate,
  Catch,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ExceptionFilter,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_UPLOAD_BYTES, type ParsedUpload, type ParseErrorBody } from "@platerelay/shared";
import type { Response } from "express";
import { type AuthedRequest, Public } from "../auth/actor.js";
import { ApiError } from "../common/errors.js";
import { Gcode3mfService } from "./gcode3mf.service.js";

/** Multer stops the upload at the size cap; answer with the parser's error shape. */
@Catch(PayloadTooLargeException)
class TooLargeFilter implements ExceptionFilter {
  catch(_e: PayloadTooLargeException, host: ArgumentsHost) {
    const body: ParseErrorBody = { code: "too-large", message: `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限` };
    host.switchToHttp().getResponse<Response>().status(413).json(body);
  }
}

/**
 * Who may parse: signed in with order:submit, like POST /orders/preview. The upload is buffered in memory
 * (up to MAX_UPLOAD_BYTES), so an open endpoint lets anyone exhaust the panel's memory.
 * PLATERELAY_PUBLIC_PARSE=1 opens it again for prototype builds of the web app that run without sign-in.
 * Runs after the global guard (which resolves the session) and before the upload is read.
 */
@Injectable()
class ParseAccess implements CanActivate {
  canActivate(ec: ExecutionContext): boolean {
    if (process.env.PLATERELAY_PUBLIC_PARSE === "1") return true;
    const actor = ec.switchToHttp().getRequest<AuthedRequest>().actor;
    if (!actor) throw new ApiError(HttpStatus.UNAUTHORIZED, "unauthenticated", "请先登录");
    if (!actor.permissions.has("order:submit")) throw new ApiError(HttpStatus.FORBIDDEN, "forbidden", "没有权限执行这个操作");
    return true;
  }
}

@Controller("gcode3mf")
@UseFilters(TooLargeFilter)
export class Gcode3mfController {
  constructor(private readonly gcode3mf: Gcode3mfService) {}

  /** Parse without storing anything: the submit page's preview. */
  @Post("parse")
  @Public()
  @UseGuards(ParseAccess)
  @HttpCode(200)
  /* defParamCharset: browsers send UTF-8 file names; busboy assumes latin1. */
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, defParamCharset: "utf8" }))
  parse(@UploadedFile() file: Express.Multer.File | undefined): ParsedUpload {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    return this.gcode3mf.parse(file.originalname, file.buffer);
  }
}
