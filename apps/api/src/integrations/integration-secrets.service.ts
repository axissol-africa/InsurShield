import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ApiException } from '../common/errors/api.exception.js';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Holds insurer client secrets only in server memory while an adapter is using
 * them. The database receives a versioned AES-GCM envelope, not plaintext.
 */
@Injectable()
export class IntegrationSecretsService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  configured(): boolean {
    return this.config.get('INTEGRATION_SECRETS_KEY', { infer: true }) !== undefined;
  }

  encrypt(secret: string): string {
    const key = this.key();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, encode(iv), encode(ciphertext), encode(tag)].join('.');
  }

  decrypt(envelope: string): string {
    const key = this.key();
    const [version, ivEncoded, ciphertextEncoded, tagEncoded, extra] = envelope.split('.');
    if (version !== VERSION || !ivEncoded || !ciphertextEncoded || !tagEncoded || extra !== undefined) {
      throw this.invalidEnvelope();
    }
    try {
      const iv = decode(ivEncoded);
      const ciphertext = decode(ciphertextEncoded);
      const tag = decode(tagEncoded);
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) throw this.invalidEnvelope();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw this.invalidEnvelope();
    }
  }

  private key(): Buffer {
    const configured = this.config.get('INTEGRATION_SECRETS_KEY', { infer: true });
    if (!configured) {
      throw new ApiException(
        'INTEGRATION_SECRETS_UNAVAILABLE',
        'Integration credentials cannot be stored until the server encryption key is configured.',
        503,
      );
    }
    const key = Buffer.from(configured, 'base64');
    if (key.length !== 32) throw this.invalidEnvelope();
    return key;
  }

  private invalidEnvelope(): ApiException {
    return new ApiException(
      'INTEGRATION_SECRET_INVALID',
      'The stored integration credential cannot be used. Ask an administrator to replace it.',
      503,
    );
  }
}

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  return Buffer.from(value, 'base64url');
}
