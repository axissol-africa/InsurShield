import { Injectable } from '@nestjs/common';
import { createHash, createHmac, createPublicKey, createVerify } from 'node:crypto';
import { canonicalJson } from '../common/json/canonical-json.js';
import { ApiException } from '../common/errors/api.exception.js';

const CALLBACK_MAX_AGE_MS = 5 * 60_000;

export interface SignedCallback {
  timestamp: string | undefined;
  signature: string | undefined;
  body: Record<string, unknown>;
}

/** Sign and verify one documented, canonical payload format. */
@Injectable()
export class CallbackSignatureService {
  signOutbound(secret: string, timestamp: string, body: Record<string, unknown>): string {
    return createHmac('sha256', secret).update(message(timestamp, body)).digest('base64url');
  }

  verifyInbound(publicSigningKey: string, callback: SignedCallback, now = new Date()): void {
    const timestamp = callback.timestamp?.trim();
    const signature = callback.signature?.trim();
    if (!timestamp || !signature || !/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
      throw invalidSignature();
    }
    const sentAt = Number(timestamp) * 1_000;
    if (!Number.isSafeInteger(sentAt) || Math.abs(now.getTime() - sentAt) > CALLBACK_MAX_AGE_MS) {
      throw new ApiException('STALE_CALLBACK', 'This integration callback has expired.', 401);
    }
    try {
      const verifier = createVerify('sha256');
      verifier.update(message(timestamp, callback.body));
      verifier.end();
      if (!verifier.verify(createPublicKey(publicSigningKey), Buffer.from(signature, 'base64url'))) throw invalidSignature();
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw invalidSignature();
    }
  }

  hash(body: Record<string, unknown>): string {
    return createHash('sha256').update(canonicalJson(body)).digest('hex');
  }

}

function message(timestamp: string, body: Record<string, unknown>): string {
  return `${timestamp}.${canonicalJson(body)}`;
}

function invalidSignature(): ApiException {
  return new ApiException('INVALID_CALLBACK_SIGNATURE', 'This integration callback could not be verified.', 401);
}
