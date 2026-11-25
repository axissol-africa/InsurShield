import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '../../common/domain/enums.js';
import type { NotificationRow } from '../notifications.repository.js';

export const MAX_PAGE = 50;

export class NotificationQueryDto {
  /** Creation time of the last row already seen; the page continues from there. */
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  limit?: number;
}

export class PreferenceDto {
  @IsIn(NOTIFICATION_CATEGORIES)
  category!: NotificationCategory;

  @IsIn(NOTIFICATION_CHANNELS)
  channel!: NotificationChannel;

  @IsBoolean()
  enabled!: boolean;
}

/**
 * What the reader can do about a notice, where it is more than opening the
 * record it is about. A renewal reminder is about a policy, but the useful
 * step is renewing it.
 */
const ACTIONS: Readonly<Record<string, 'RENEW'>> = {
  'policy.renewal_due': 'RENEW',
  'policy.lapsed': 'RENEW',
};

/**
 * Mapped field by field, never spread. The row carries the template key and
 * version, which are the platform's business rather than the reader's.
 */
export function toNotification(row: NotificationRow) {
  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    category: row.category,
    entityType: row.entityType,
    entityId: row.entityId,
    action: ACTIONS[row.templateKey] ?? null,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
