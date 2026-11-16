import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

@Module({ controllers: [SettingsController], providers: [SettingsRepository, SettingsService], exports: [SettingsService] })
export class SettingsModule {}
