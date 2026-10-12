import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AcceptConsentDto } from './dto/accept-consent.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * Sign-in and sign-up are handled by Keycloak through the OIDC Authorization
 * Code flow with PKCE, so this API issues no tokens and never sees a password.
 * What remains is resolving the caller behind a verified token, and recording
 * the consent that authenticating does not itself imply.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() principal: Principal) {
    return this.auth.me(principal);
  }

  @Post('consent')
  @HttpCode(HttpStatus.OK)
  acceptConsent(
    @Body() dto: AcceptConsentDto,
    @CurrentUser() principal: Principal,
    @Req() request: Request,
  ) {
    return this.auth.acceptConsent(principal, dto.noticeVersion, {
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    });
  }
}
