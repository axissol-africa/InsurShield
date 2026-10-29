import type { LoggerService } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { mailRoutesEnabled } from './auth.constants.js';

export interface MailLink {
  user: { email: string };
  url: string;
  token: string;
}

/**
 * The API sends no mail yet, so outside production the links go to the log for a developer to open.
 * The reset link targets the web's reset page, an absolute address on a trusted origin (checked in `auth.instance.ts`).
 */
export function developmentMailer(logger: LoggerService, nodeEnv: Env['NODE_ENV']) {
  const deliver = (kind: string, email: string, link: string) => {
    if (!mailRoutesEnabled(nodeEnv)) return;
    logger.log(`${kind} link for ${email}: ${link}`);
  };
  return {
    sendResetPassword: async ({ user, url, token }: MailLink) => {
      const redirectTo = new URL(url).searchParams.get('callbackURL');
      if (!redirectTo) return;
      const link = new URL(redirectTo);
      link.searchParams.set('token', token);
      deliver('Password reset', user.email, link.toString());
    },
    sendVerificationEmail: async ({ user, url }: MailLink) => {
      deliver('Email verification', user.email, url);
    },
  };
}
