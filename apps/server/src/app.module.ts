import { join } from "node:path";
import { type DynamicModule, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AdminController } from "./api/admin.controller.js";
import { AuthController } from "./api/auth.controller.js";
import { DaemonController } from "./api/daemon.controller.js";
import { OrdersController } from "./api/orders.controller.js";
import { PrintersController } from "./api/printers.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { AuthService } from "./auth/auth.service.js";
import { IdempotencyInterceptor } from "./common/idempotency.js";
import { ApiGuard } from "./common/op.js";
import { ProblemFilter } from "./common/problem.js";
import { APP_CONFIG, type AppConfig } from "./config/config.js";
import { Work } from "./core/uow.js";
import { CommandsService } from "./daemons/commands.service.js";
import { DaemonsService } from "./daemons/daemons.service.js";
import { DaemonGateway } from "./daemons/gateway.js";
import { DaemonHub } from "./daemons/hub.js";
import { SnapshotStore } from "./daemons/snapshot-store.js";
import { DB, type DbHandle, openDb } from "./db/db.js";
import { FilesService } from "./files/files.service.js";
import { JobEngine } from "./jobs/job-engine.js";
import { OrdersService } from "./orders/orders.service.js";
import { PickupService } from "./orders/pickup.service.js";
import { OrderViews } from "./orders/views.js";
import { OverviewService } from "./overview/overview.service.js";
import { DispatchService } from "./printers/dispatch.service.js";
import { FactsService } from "./printers/facts.service.js";
import { PrintersService } from "./printers/printers.service.js";
import { PrinterViews } from "./printers/views.js";
import { RealtimeService } from "./realtime/realtime.service.js";
import { SettingsService } from "./settings/settings.service.js";
import { StorageModule } from "./storage/storage.module.js";

const DB_HANDLE = Symbol("DB_HANDLE");

/*
 * The embedded development database lives in its own directory per incompatible schema generation,
 * so a database left by an older version of the panel is never opened with the wrong tables.
 */
const EMBEDDED_DB_DIR = "pglite-v2";

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  static forRoot(config: AppConfig, db?: DbHandle): DynamicModule {
    return {
      module: AppModule,
      imports: [StorageModule],
      controllers: [AuthController, OrdersController, PrintersController, AdminController, DaemonController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DB_HANDLE, useFactory: () => db ?? openDb(config.databaseUrl ?? join(config.dataDir, EMBEDDED_DB_DIR)) },
        { provide: DB, inject: [DB_HANDLE], useFactory: (h: DbHandle) => h.db },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: APP_GUARD, useClass: ApiGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        Work,
        AuditService,
        SettingsService,
        AuthService,
        FilesService,
        JobEngine,
        OrderViews,
        OrdersService,
        PickupService,
        PrinterViews,
        PrintersService,
        DispatchService,
        FactsService,
        OverviewService,
        RealtimeService,
        DaemonHub,
        CommandsService,
        DaemonsService,
        DaemonGateway,
        SnapshotStore,
      ],
      exports: [APP_CONFIG, DB],
      global: true,
    };
  }

  async onApplicationShutdown() {
    await this.handle.close();
  }
}
