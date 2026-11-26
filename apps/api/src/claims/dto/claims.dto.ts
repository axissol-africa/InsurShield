import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CLAIM_ACTIONS, type ClaimAction } from '../domain/lifecycle.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class ClaimRevisionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  expectedRevision!: string;
}

export class ClaimUpdateDto extends ClaimRevisionDto {
  @IsIn(CLAIM_ACTIONS) action!: ClaimAction;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  evidenceRequest?: string;
}

export class ClaimEvidenceDto extends ClaimRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds!: string[];
}
