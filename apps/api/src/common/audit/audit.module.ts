import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/** One writer shared by each module that changes operational data. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
