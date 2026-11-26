import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { SupportRepository } from './support.repository.js';
import { SupportService } from './support.service.js';

@Module({
  controllers: [SupportController],
  providers: [SupportService, SupportRepository],
  exports: [SupportService],
})
export class SupportModule {}
