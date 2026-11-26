import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { TemplateRow } from '../notifications.repository.js';
import { TEMPLATE_POLICIES } from '../domain/template-policy.js';

export class TemplatePageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset = 0;
}
export class CreateTemplateVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  owner!: string;
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  effectiveFrom!: string;
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  expiresAt!: string;
}
export class ReviewTemplateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
export function toTemplate(row: TemplateRow) {
  return {
    id: row.id,
    key: row.key,
    channel: row.channel,
    category: row.category,
    mandatory: row.mandatory,
    version: row.version,
    subject: row.subject,
    body: row.body,
    owner: row.owner,
    audience: 'CUSTOMER',
    reviewStatus: row.reviewStatus,
    effectiveFrom: (row.effectiveFrom ?? row.activeFrom)?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    activeFrom: row.activeFrom?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole,
    approvedBy: row.approvedBy,
    approvedByRole: row.approvedByRole,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    withdrawnBy: row.withdrawnBy,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    allowedPlaceholders:
      TEMPLATE_POLICIES[`${row.key}:${row.channel}`]?.placeholders ?? [],
  };
}
