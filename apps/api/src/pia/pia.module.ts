import { Module } from '@nestjs/common';
import { PiaController } from './pia.controller.js';
import { PiaRepository } from './pia.repository.js';
import { PiaService } from './pia.service.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';

@Module({ imports: [ApprovalsModule], controllers: [PiaController], providers: [PiaService, PiaRepository], exports: [PiaService] })
export class PiaModule {}
