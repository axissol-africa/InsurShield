import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller.js';
import { StaffRepository } from './staff.repository.js';
import { StaffService } from './staff.service.js';

@Module({
  controllers: [StaffController],
  providers: [StaffService, StaffRepository],
})
export class StaffModule {}
