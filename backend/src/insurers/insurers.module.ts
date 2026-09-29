import { Module } from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import { InsurersController } from './insurers.controller.js';

@Module({
  controllers: [InsurersController],
  providers: [InsurersService],
  exports: [InsurersService],
})
export class InsurersModule {}
