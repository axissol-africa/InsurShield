import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public, Roles } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

class SetPiaConfigDto {
  /** Regulatory floor: no insurer may quote below this share of vehicle value. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'The PIA rate cannot be negative.' })
  @Max(100, { message: 'The PIA rate cannot exceed 100%.' })
  piaRatePercentage!: number;
}

/**
 * The PIA minimum rate. A single row (`id = "current"`), because it is platform
 * configuration rather than a collection, and the premium engine reads it on
 * every quote.
 */
@Controller('config/pia')
export class PiaController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async get() {
    const config = await this.prisma.piaConfig.findUnique({
      where: { id: 'current' },
      include: { updatedByStaff: { select: { fullName: true } } },
    });

    // Seeded at install; fall back to the regulatory default if it is missing.
    if (!config) return { piaRatePercentage: 4, lastUpdated: null, updatedBy: null };

    return {
      piaRatePercentage: config.piaRatePercentage.toNumber(),
      lastUpdated: config.updatedAt.toISOString(),
      updatedBy: config.updatedByStaff?.fullName ?? null,
    };
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Put()
  async set(@Body() dto: SetPiaConfigDto, @CurrentUser() principal: Principal) {
    const config = await this.prisma.piaConfig.upsert({
      where: { id: 'current' },
      create: {
        id: 'current',
        piaRatePercentage: dto.piaRatePercentage,
        updatedByStaffId: principal.id,
      },
      update: {
        piaRatePercentage: dto.piaRatePercentage,
        updatedByStaffId: principal.id,
      },
      include: { updatedByStaff: { select: { fullName: true } } },
    });

    return {
      piaRatePercentage: config.piaRatePercentage.toNumber(),
      lastUpdated: config.updatedAt.toISOString(),
      updatedBy: config.updatedByStaff?.fullName ?? null,
    };
  }
}
