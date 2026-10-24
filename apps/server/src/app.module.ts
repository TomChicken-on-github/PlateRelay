import { Module } from "@nestjs/common";
import { Gcode3mfModule } from "./gcode3mf/gcode3mf.module.js";

@Module({ imports: [Gcode3mfModule] })
export class AppModule {}
