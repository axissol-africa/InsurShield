import { Type, Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { REVIEW_ACTIONS, REVIEW_REASONS, REVIEW_STATES } from './domain/review.js';

export class SaveReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(2000) text?: string;
}

export class ReviewResponseDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 2000) text!: string;
}

export class ReviewDecisionDto {
  @IsUUID() revisionId!: string;
  @IsIn(REVIEW_ACTIONS) action!: typeof REVIEW_ACTIONS[number];
  @IsIn(REVIEW_REASONS) reason!: typeof REVIEW_REASONS[number];
}

export class ReviewPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) page?: number;
}

export class ModerationPageDto extends ReviewPageDto {
  @IsOptional() @IsIn(REVIEW_STATES) status?: typeof REVIEW_STATES[number];
}
