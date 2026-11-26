import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ReviewAppealListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) page?: number;
  @IsOptional() @IsUUID() decisionId?: string;
  @IsOptional() @IsUUID() reviewId?: string;
}

export class CreateReviewAppealDto {
  @IsUUID() decisionId!: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IsOptional() @IsString() @MaxLength(10000) evidence?: string;
}
export class ResolveReviewAppealDto {
  @IsIn(['UPHELD', 'OVERTURNED']) outcome!: 'UPHELD' | 'OVERTURNED';
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class ReviewLegalHoldDto {
  @IsBoolean() held!: boolean;
}
