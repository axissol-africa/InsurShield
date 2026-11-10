import { createHash } from 'node:crypto';
import type { MailSender } from '../mail/mail.port.js';

export interface MailLink {
  user: { email: string };
  url: string;
  token: string;
}

const RESET_SUBJECT = 'Reset your InsurShield password';
const VERIFY_SUBJECT = 'Confirm your email address';

/**
 * The two messages Better Auth asks the platform to send.
 *
 * Both go through the mail port, so which adapter carries them is a deployment
 * setting rather than a branch here. The token is not put in the idempotency
 * key directly: a provider that logs or echoes keys would then hold a working
 * reset link, so the key is a hash of it.
 */
export function identityMailer(sender: MailSender) {
  const keyFor = (purpose: string, token: string) =>
    `${purpose}:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;

  return {
    sendResetPassword: async ({ user, url, token }: MailLink) => {
      // Better Auth's own URL bounces through the API; the customer needs the
      // web page, which `auth.instance.ts` has already checked is a trusted
      // origin, with the token attached.
      const redirectTo = new URL(url).searchParams.get('callbackURL');
      if (!redirectTo) return;
      const link = new URL(redirectTo);
      link.searchParams.set('token', token);
      await sender.send({
        to: user.email,
        subject: RESET_SUBJECT,
        body: `Reset your password: ${link.toString()}\n\nIf you did not ask for this, nothing has changed and you can ignore this message.`,
        idempotencyKey: keyFor('reset', token),
      });
    },
    sendVerificationEmail: async ({ user, url, token }: MailLink) => {
      await sender.send({
        to: user.email,
        subject: VERIFY_SUBJECT,
        body: `Confirm your email address: ${url}`,
        idempotencyKey: keyFor('verify', token),
      });
    },
  };
}
