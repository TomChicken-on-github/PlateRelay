import { Module, type Provider } from "@nestjs/common";
import { DaemonsService } from "./daemons/daemons.service.js";
import { FormsService } from "./forms/forms.service.js";
import { Gcode3mfModule } from "./gcode3mf/gcode3mf.module.js";
import { OrdersController } from "./orders/orders.controller.js";
import { OrdersService } from "./orders/orders.service.js";
import { PickupService } from "./orders/pickup.service.js";
import { NoDaemonCommands, PRINTER_COMMANDS } from "./printers/commands.js";
import { PrintersController } from "./printers/printers.controller.js";
import { PrintersService } from "./printers/printers.service.js";
import { SchedulerService } from "./printers/scheduler.service.js";
import { AdminController } from "./settings/admin.controller.js";
import { UsersService } from "./users/users.service.js";

const services: Provider[] = [FormsService, OrdersService, PickupService, PrintersService, SchedulerService, UsersService, DaemonsService];

/** The business side: orders, printers, settings. */
@Module({
  imports: [Gcode3mfModule],
  controllers: [OrdersController, PrintersController, AdminController],
  providers: [...services, { provide: PRINTER_COMMANDS, useClass: NoDaemonCommands }],
  exports: [...services, PRINTER_COMMANDS],
})
export class PanelModule {}
