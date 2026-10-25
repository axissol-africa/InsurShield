import { Module } from '@nestjs/common';
import { PiaController } from './pia.controller.js';
import { PiaRepository } from './pia.repository.js';
import { PiaService } from './pia.service.js';

@Module({ controllers: [PiaController], providers: [PiaService, PiaRepository] })
export class PiaModule {}
