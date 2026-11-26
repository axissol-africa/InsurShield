import { Module } from '@nestjs/common';
import {
  CustomerClaimsController,
  InsurerClaimsController,
} from './claims.controller.js';
import { ClaimsRepository } from './claims.repository.js';
import { ClaimsService } from './claims.service.js';

@Module({
  controllers: [CustomerClaimsController, InsurerClaimsController],
  providers: [ClaimsRepository, ClaimsService],
})
export class ClaimsModule {}
