import { Module } from '@nestjs/common';
import { PiaController } from './pia.controller.js';

@Module({ controllers: [PiaController] })
export class PiaModule {}
