import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { KeycloakVerifier } from '../common/auth/keycloak.verifier.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, KeycloakVerifier],
  exports: [AuthService, KeycloakVerifier],
})
export class AuthModule {}
