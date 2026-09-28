import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsEnum } from 'class-validator';
import { Body } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';
import { DocumentKind } from '../generated/prisma/enums.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

class UploadDocumentDto {
  @IsEnum(DocumentKind, { message: 'Unknown document kind.' })
  kind!: DocumentKind;
}

/** Maps a document kind onto the storage prefix it belongs under. */
const SCOPE_FOR_KIND = {
  QUOTATION: { kind: 'quotation' as const, quoteRequestId: 'unfiled', insurerId: 'unfiled' },
  CERTIFICATE: { kind: 'certificate' as const, policyNumber: 'unfiled' },
  INSPECTION_PHOTO: { kind: 'inspection-shot' as const, quoteRequestId: 'unfiled', shotKey: 'unfiled' },
  CLAIM_ATTACHMENT: { kind: 'claim-attachment' as const, claimNumber: 'unfiled' },
  INSURER_LOGO: { kind: 'insurer-logo' as const, insurerId: 'unfiled' },
  NCD_EVIDENCE: { kind: 'ncd-evidence' as const, applicationNumber: 'unfiled' },
};

/**
 * Uploads land here first and are referenced by id afterwards, so a quotation
 * or certificate is attached to a record only once its bytes are safely stored.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.documents.upload(file, dto.kind, SCOPE_FOR_KIND[dto.kind], principal);
  }

  /** A fresh signed URL, because the one issued at upload time expires. */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.record(id);
  }
}
