import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { OUTCOMES, SEVERITIES, STATUSES, WORKFLOW_TYPES, type WorkflowType } from '../domain/risk-review.js';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class ReferRiskDto {
  @IsIn(WORKFLOW_TYPES) workflowType!: WorkflowType;
  @IsUUID('4') workflowId!: string;
  @IsString() @MaxLength(80) evidenceReference!: string;
  @IsIn(SEVERITIES) severity!: typeof SEVERITIES[number];
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500) nextAction!: string;
}
export class ListRiskQuery {
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsUUID('4') cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class AssignRiskDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @ValidateIf((_dto, value) => value !== null) @IsUUID('4') staffId!: string | null;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500) nextAction!: string;
}
export class ResolveRiskDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsIn(OUTCOMES) outcome!: typeof OUTCOMES[number];
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500) nextAction!: string;
}
