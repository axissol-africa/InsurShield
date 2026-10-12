import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
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
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { AuthGuard } from './common/auth/auth.guard.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    StorageModule,
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
    // Every route requires a token unless it opts out with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
