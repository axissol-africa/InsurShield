import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Swagger UI at `/docs` and the document at `/docs-json`, outside the API prefix. */
export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('InsurShield API')
    .setDescription(
      'Motor insurance quotes, policies, payments and claims. Amounts are Kwacha with two decimals; ' +
        'errors are { code, message, details }.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'A Keycloak access token' })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
