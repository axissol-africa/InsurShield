import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from './auth.types.js';

/** The authenticated principal, populated by `AuthGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    (context.switchToHttp().getRequest<Request & { principal?: Principal }>()).principal!,
);
