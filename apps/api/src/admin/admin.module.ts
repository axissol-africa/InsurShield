import { Module } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminRepository],
})
export class AdminModule {}
