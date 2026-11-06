import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ACTOR_TYPES } from '../../common/domain/enums.js';

/** Entity names are deliberately allowlisted: this is a staff tool, not a database browser. */
const AUDIT_ENTITY_TYPES = [
  'CLAIM',
  'CONSENT',
  'CUSTOMER',
  'DOCUMENT',
  'INSPECTION',
  'INSURER',
  'INSURER_QUOTE',
  'NCD_APPLICATION',
  'PAYMENT',
  'PIA_CONFIG',
  'POLICY',
  'QUOTE_REQUEST',
  'SETTING',
] as const;

export class AuditLogQueryDto {
  @IsOptional() @IsIn(AUDIT_ENTITY_TYPES) entityType?: (typeof AUDIT_ENTITY_TYPES)[number];
  @IsOptional() @IsIn(ACTOR_TYPES) actorType?: (typeof ACTOR_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(120) action?: string;
  @IsOptional() @IsString() @MaxLength(128) entityId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(256) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
