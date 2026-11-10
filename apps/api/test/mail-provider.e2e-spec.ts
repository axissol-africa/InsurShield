import { ProviderRegistry } from '../src/common/providers/provider-registry.js';
import { MAIL_SENDER, type MailSender } from '../src/mail/mail.port.js';
import { startApp } from './helpers.js';

const HTTP_MAIL = {
  MAIL_SENDER: 'http',
  MAIL_ENDPOINT: 'https://mail.example.invalid/send',
  MAIL_API_KEY: 'not-a-real-key',
  MAIL_FROM: 'no-reply@insurshield.zm',
};

/**
 * The mode the gate reads has to follow the setting that selects the adapter.
 * Asserting it instead is how batch 5 shipped a gate that reported the one
 * provider it could not actually see.
 */
describe('the mail adapter and the provider gate', () => {
  it('registers the log adapter as a stand-in, and refuses production on it', async () => {
    const app = await startApp();
    try {
      const registry = app.app.get(ProviderRegistry);

      expect(registry.list()).toContainEqual({ name: 'email', mode: 'stand-in', setting: 'MAIL_SENDER' });
      expect(() => registry.assertNoStandInsInProduction('production')).toThrow('email (MAIL_SENDER)');
      expect(app.app.get<MailSender>(MAIL_SENDER).name).toBe('log');
    } finally {
      await app.close();
    }
  });

  it('registers the http adapter as live, so configuring one stops blocking the gate', async () => {
    const app = await startApp({ env: HTTP_MAIL });
    try {
      const registry = app.app.get(ProviderRegistry);

      expect(registry.list()).toContainEqual({ name: 'email', mode: 'live', setting: 'MAIL_SENDER' });
      expect(registry.standIns().map((provider) => provider.name)).not.toContain('email');
      expect(app.app.get<MailSender>(MAIL_SENDER).name).toBe('http');
    } finally {
      await app.close();
    }
  });

  it.each(['MAIL_ENDPOINT', 'MAIL_API_KEY', 'MAIL_FROM'] as const)(
    'refuses to start on the http adapter without %s, naming it',
    async (missing) => {
      const incomplete = { ...HTTP_MAIL, [missing]: '' };

      await expect(startApp({ env: incomplete })).rejects.toThrow(missing);
    },
  );
});
