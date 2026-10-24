import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { Observable, catchError, throwError } from 'rxjs';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.js';

/**
 * Multer stops reading at these limits instead of buffering the whole body:
 * one file of at most `maxBytes`, and the single short `kind` field.
 */
export function uploadOptions(maxBytes: number): MulterModuleOptions {
  return { limits: { fileSize: maxBytes, files: 1, fields: 1, fieldSize: 1024 } };
}

export function fileTooLarge(maxBytes: number): ApiException {
  return new ApiException('FILE_TOO_LARGE', `That file is larger than the ${maxBytes / 1024 / 1024} MB limit.`);
}

/** Answers a file cut off at the size limit as `FILE_TOO_LARGE`; its full size is never known. */
@Injectable()
export class FileTooLargeInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<Env, true>) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof PayloadTooLargeException)) return throwError(() => error);
        return throwError(() => fileTooLarge(this.config.get('MAX_UPLOAD_BYTES', { infer: true })));
      }),
    );
  }
}
