import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { type NextFunction, raw, type Request, type Response } from "express";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/config.js";

const MAX_DAEMON_UPLOAD = "20mb";

export function configureApp(app: NestExpressApplication) {
  app.disable("x-powered-by");
  /* Every response carries the id its log lines and error document are filed under. */
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  app.use(cookieParser());
  /* Daemons upload pictures as the raw request body. */
  app.use("/daemon/v1", raw({ type: ["image/*", "application/octet-stream"], limit: MAX_DAEMON_UPLOAD }));
  return app;
}

async function bootstrap() {
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  if (process.env.PLATERELAY_TRUST_PROXY) app.set("trust proxy", process.env.PLATERELAY_TRUST_PROXY);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT) || 3000);
}

if (require.main === module) void bootstrap();
