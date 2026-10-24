import { Module } from "@nestjs/common";
import { Gcode3mfController } from "./gcode3mf.controller.js";
import { Gcode3mfService } from "./gcode3mf.service.js";

@Module({
  controllers: [Gcode3mfController],
  providers: [Gcode3mfService],
  exports: [Gcode3mfService],
})
export class Gcode3mfModule {}
