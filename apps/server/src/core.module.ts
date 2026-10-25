import { join } from "node:path";
import { type DynamicModule, Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditService } from "./audit/audit.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { RbacService } from "./auth/rbac.service.js";
import { ErrorFilter } from "./common/errors.js";
import { APP_CONFIG, type AppConfig } from "./config/config.js";
import { DB, type DbHandle, openDb } from "./db/db.js";
import { SettingsService } from "./settings/settings.service.js";
import { StorageModule } from "./storage/storage.module.js";

const DB_HANDLE = Symbol("DB_HANDLE");

/** Config, database, auth, audit and storage: what every feature module needs. */
@Global()
@Module({})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown() {
    await this.handle.close();
  }

  /** `db` lets tests hand in an already opened database. */
  static forRoot(config: AppConfig, db?: DbHandle): DynamicModule {
    return {
      module: CoreModule,
      imports: [StorageModule],
      controllers: [AuthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DB_HANDLE, useFactory: () => db ?? openDb(config.databaseUrl ?? join(config.dataDir, "pglite")) },
        { provide: DB, inject: [DB_HANDLE], useFactory: (h: DbHandle) => h.db },
        AuditService,
        RbacService,
        AuthService,
        SettingsService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
      exports: [APP_CONFIG, DB, AuditService, RbacService, AuthService, SettingsService],
    };
  }
}
