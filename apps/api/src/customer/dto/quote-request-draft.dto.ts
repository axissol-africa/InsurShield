import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const DRAFT_DOCUMENT_KINDS = ['WHITE_BOOK', 'INSPECTION_PHOTO'] as const;

/** A customer-owned upload referenced by an unfinished journey. */
export class QuoteRequestDraftDocumentDto {
  @IsString() @MinLength(1) @MaxLength(80) slot!: string;
  @IsIn(DRAFT_DOCUMENT_KINDS) kind!: (typeof DRAFT_DOCUMENT_KINDS)[number];
  @IsUUID('4') documentId!: string;
}

/** The values needed to resume an unfinished product-selection journey. */
export class CreateQuoteRequestDraftDto {
  /** Shared customer answers only; product-owned questions live in configurableAnswers. */
  @IsObject() commonAnswers!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Choose no more than five insurance products.' })
  @ArrayUnique({ message: 'Choose each insurance product only once.' })
  @IsUUID('4', { each: true, message: 'One selected insurance product is invalid.' })
  selectedProductVersionIds?: string[];

  /** Versioned product questions and declarations, not platform identity fields. */
  @IsOptional() @IsObject() configurableAnswers?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((reference: QuoteRequestDraftDocumentDto) => reference.slot, {
    message: 'Use each document slot only once.',
  })
  @ArrayUnique((reference: QuoteRequestDraftDocumentDto) => reference.documentId, {
    message: 'Attach each document only once.',
  })
  @ValidateNested({ each: true })
  @Type(() => QuoteRequestDraftDocumentDto)
  documentReferences?: QuoteRequestDraftDocumentDto[];
}

/** Patch deliberately distinguishes an omitted value from an empty replacement. */
export class UpdateQuoteRequestDraftDto {
  @IsOptional() @IsObject() commonAnswers?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Choose no more than five insurance products.' })
  @ArrayUnique({ message: 'Choose each insurance product only once.' })
  @IsUUID('4', { each: true, message: 'One selected insurance product is invalid.' })
  selectedProductVersionIds?: string[];

  @IsOptional() @IsObject() configurableAnswers?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((reference: QuoteRequestDraftDocumentDto) => reference.slot, {
    message: 'Use each document slot only once.',
  })
  @ArrayUnique((reference: QuoteRequestDraftDocumentDto) => reference.documentId, {
    message: 'Attach each document only once.',
  })
  @ValidateNested({ each: true })
  @Type(() => QuoteRequestDraftDocumentDto)
  documentReferences?: QuoteRequestDraftDocumentDto[];
}
