import { createHash, randomUUID } from 'node:crypto';
import type { MailSender } from '../mail/mail.port.js';

export interface MailLink {
  user: { email: string };
  url: string;
  token: string;
}

const RESET_SUBJECT = 'Reset your InsurShield password';
const VERIFY_SUBJECT = 'Confirm your email address';
const STAFF_MFA_SUBJECT = 'Your InsurShield staff sign-in code';

/**
 * The two messages Better Auth asks the platform to send.
 *
 * Both go through the mail port, so which adapter carries them is a deployment
 * setting rather than a branch here. The token is not put in the idempotency
 * key directly: a provider that logs or echoes keys would then hold a working
 * reset link, so the key is a hash of it.
 */
/**
 * Sends the same password-reset message whether the customer initiated it or
 * an authorised administrator did. The caller receives only the provider
 * receipt, never the link or token that was sent.
 */
export async function sendPasswordResetEmail(sender: MailSender, { user, url, token }: MailLink) {
  // Better Auth's own URL bounces through the API; the customer needs the
  // web page, which `auth.instance.ts` has already checked is a trusted
  // origin, with the token attached.
  const redirectTo = new URL(url).searchParams.get('callbackURL');
  if (!redirectTo) throw new Error('A password reset link needs a trusted callback URL.');
  const link = new URL(redirectTo);
  link.searchParams.set('token', token);
  const result = await sender.send({
    to: user.email,
    subject: RESET_SUBJECT,
    body: `Reset your password: ${link.toString()}\n\nIf you did not ask for this, nothing has changed and you can ignore this message.`,
    idempotencyKey: keyFor('reset', token),
  });
  if (result.result === 'failed') throw new Error('The password reset email could not be delivered.');
  return { provider: sender.name, providerReference: result.providerId };
}

function keyFor(purpose: string, token: string) {
  return `${purpose}:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

export function identityMailer(sender: MailSender) {
  return {
    sendStaffMfaCode: async ({ user, otp }: { user: { email: string }; otp: string }) => {
      const result = await sender.send({
        to: user.email,
        subject: STAFF_MFA_SUBJECT,
        body: `Your InsurShield staff sign-in code is: ${otp}\n\nIt expires in 5 minutes. Do not share this code with anyone.`,
        // Neither the code nor a brute-forceable hash of it may reach a mail provider's metadata.
        idempotencyKey: `staff-mfa:${randomUUID()}`,
      });
      if (result.result === 'failed') throw new Error('The staff sign-in code could not be delivered.');
    },
    sendResetPassword: (link: MailLink) => sendPasswordResetEmail(sender, link).then(() => undefined),
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
