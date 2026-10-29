import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.module.js';
import { AUTH, AUTH_SETTINGS } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { authSettings, createAuth, type AuthSettings } from './auth.instance.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    {
      provide: AUTH_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => authSettings(config),
    },
    {
      provide: AUTH,
      inject: [DATABASE, AUTH_SETTINGS],
      useFactory: (db: Database, settings: AuthSettings) => createAuth(db, settings),
    },
  ],
  exports: [AuthService, AUTH, AUTH_SETTINGS],
})
export class AuthModule {}
