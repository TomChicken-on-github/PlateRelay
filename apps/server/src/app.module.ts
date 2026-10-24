import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./config/config.js";
import { CoreModule } from "./core.module.js";
import type { DbHandle } from "./db/db.js";
import { Gcode3mfModule } from "./gcode3mf/gcode3mf.module.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, db?: DbHandle): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot(config, db), Gcode3mfModule] };
  }
}
