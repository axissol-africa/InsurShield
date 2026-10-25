import { Module } from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import { InsurersController } from './insurers.controller.js';
import { InsurersRepository } from './insurers.repository.js';

@Module({
  controllers: [InsurersController],
  providers: [InsurersService, InsurersRepository],
  exports: [InsurersService],
})
export class InsurersModule {}
