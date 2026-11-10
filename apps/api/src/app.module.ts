import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './db/database.module.js';
import { StorageModule } from './storage/storage.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { InsurersModule } from './insurers/insurers.module.js';
import { PiaModule } from './pia/pia.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { InsurerPortalModule } from './insurer-portal/insurer-portal.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { InspectionsModule } from './inspections/inspections.module.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { ApiRateLimitGuard } from './common/rate-limit/api-rate-limit.guard.js';
import { AuditModule } from './common/audit/audit.module.js';
import { ProvidersModule } from './common/providers/providers.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MailModule } from './mail/mail.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ScanningModule } from './scanning/scanning.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    JobsModule,
    // Before any adapter module, so each can register itself as it initialises.
    ProvidersModule,
    StorageModule,
    ScanningModule,
    MailModule,
    NotificationsModule,
    AuthModule,
    DocumentsModule,
    InsurersModule,
    PiaModule,
    InsurerPortalModule,
    AdminModule,
    CustomerModule,
    VehiclesModule,
    PaymentsModule,
    InspectionsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // Every route requires a session unless it opts out with @Public() or @OptionalAuth().
    { provide: APP_GUARD, useClass: AuthGuard },
    // Individual controllers opt in with @ApiRateLimit; keeping this global
    // makes the address policy consistent across every bounded endpoint.
    { provide: APP_GUARD, useClass: ApiRateLimitGuard },
  ],
})
export class AppModule {}
