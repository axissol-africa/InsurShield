import { Module } from '@nestjs/common';
import { PiaController } from './pia.controller.js';
import { PiaRepository } from './pia.repository.js';
import { PiaService } from './pia.service.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({ imports: [ApprovalsModule, SettingsModule], controllers: [PiaController], providers: [PiaService, PiaRepository], exports: [PiaService] })
export class PiaModule {}
