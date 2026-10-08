import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AcceptConsentDto } from './dto/accept-consent.dto.js';
import { ChangePasswordDto, LoginDto, RegisterDto, StaffLoginDto } from './dto/credentials.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * Accounts live in this service. Passwords are stored as scrypt hashes and a
 * successful sign-in returns a short-lived access token the client sends back
 * as a bearer token.
 *
 * PARKED: one-time codes (`/auth/otp`) and self-service password reset both
 * need an email or SMS provider. Until one is wired up, a customer who is
 * locked out is helped by support.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.identifier, dto.password);
  }

  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  staffLogin(@Body() dto: StaffLoginDto) {
    return this.auth.staffLogin(dto.email, dto.password);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() principal: Principal) {
    return this.auth.changePassword(principal, dto.currentPassword, dto.newPassword);
  }

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
