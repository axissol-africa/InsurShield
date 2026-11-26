import { Module } from '@nestjs/common';
import { CustomerContentController } from './customer-content.controller.js';
import { CustomerContentRepository } from './customer-content.repository.js';
import { CustomerContentService } from './customer-content.service.js';
@Module({ controllers: [CustomerContentController], providers: [CustomerContentRepository, CustomerContentService], exports: [CustomerContentService] })
export class CustomerContentModule {}
