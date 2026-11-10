import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import type { Env } from '../config/env.js';
import { HttpMailSender } from './http.sender.js';
import { LogMailSender } from './log.sender.js';
import { MAIL_SENDER, type MailSender } from './mail.port.js';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailSender =>
        config.get('MAIL_SENDER', { infer: true }) === 'http'
          ? new HttpMailSender({
              // env.ts refuses `http` without these three, so they are present.
              endpoint: config.get('MAIL_ENDPOINT', { infer: true }) as string,
              apiKey: config.get('MAIL_API_KEY', { infer: true }) as string,
              from: config.get('MAIL_FROM', { infer: true }) as string,
              timeoutMs: config.get('MAIL_TIMEOUT_MS', { infer: true }),
            })
          : new LogMailSender(),
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Derived from the setting rather than asserted, as storage does: a
   * deployment that left the log adapter selected is refused in production
   * instead of being attested as able to send.
   */
  onModuleInit(): void {
    this.registry.register({
      name: 'email',
      mode: this.config.get('MAIL_SENDER', { infer: true }) === 'http' ? 'live' : 'stand-in',
      setting: 'MAIL_SENDER',
    });
  }
}
