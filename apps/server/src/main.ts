import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/config.js";

export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.disable("x-powered-by");
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(loadConfig()));
  if (process.env.PLATERELAY_TRUST_PROXY) app.set("trust proxy", process.env.PLATERELAY_TRUST_PROXY);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT) || 3000);
}

if (require.main === module) void bootstrap();
