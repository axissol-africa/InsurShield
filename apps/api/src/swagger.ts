import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getCookies } from 'better-auth/cookies';
import { AUTH } from './auth/auth.constants.js';
import type { Auth } from './auth/auth.instance.js';

/** Swagger UI at `/docs` and the document at `/docs-json`, outside the API prefix. */
export function setupSwagger(app: INestApplication) {
  // Named by the instance's own options, so it carries the `__Secure-` prefix behind https.
  const sessionCookie = getCookies(app.get<Auth>(AUTH).options).sessionToken.name;
  const config = new DocumentBuilder()
    .setTitle('InsurShield API')
    .setDescription(
      'Motor insurance quotes, policies, payments and claims. Amounts are Kwacha with two decimals; ' +
        'errors are { code, message, details }.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      sessionCookie,
      {
        type: 'apiKey',
        in: 'cookie',
        name: sessionCookie,
        description: 'The session cookie set by POST /identity/sign-in/email or /identity/register',
      },
      sessionCookie,
    )
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
