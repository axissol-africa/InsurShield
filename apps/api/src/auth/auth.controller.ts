import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AcceptConsentDto } from './dto/accept-consent.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * Sign-in, sign-out and registration are Better Auth routes under `/identity`. What remains here is
 * resolving the caller behind the session, and recording the consent that signing in does not imply.
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
