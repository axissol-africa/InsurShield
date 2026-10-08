import { Module } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { UsersService } from './users.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  controllers: [AdminController],
  providers: [AdminService, UsersService],
})
export class AdminModule {}
