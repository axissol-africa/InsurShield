import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';

export type DocumentScope =
  | { kind: 'quotation'; quoteRequestId: string; insurerId: string }
  | { kind: 'certificate'; policyNumber: string }
  | { kind: 'inspection-shot'; quoteRequestId: string; shotKey: string }
  | { kind: 'inspection-photo'; inspectionId: string; slot: string }
  | { kind: 'claim-attachment'; claimNumber: string }
  | { kind: 'insurer-logo'; insurerId: string }
  | { kind: 'ncd-evidence'; applicationNumber: string };

/**
 * Private object storage for every uploaded document.
 *
 * Files are never written to Postgres — the database holds only the metadata and
 * the `storageKey` returned here. Downloads are always short-lived signed URLs,
 * so a bucket object is never publicly readable.
 *
 * Locally this talks to MinIO; in production it talks to S3. Only configuration
 * differs: drop `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`, set `S3_REGION`, and
 * omit the static keys so the SDK picks up the task/instance IAM role.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtl: number;
  private readonly sse?: 'AES256' | 'aws:kms';
  private readonly sseKmsKeyId?: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const accessKeyId = this.config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('S3_SECRET_ACCESS_KEY', { infer: true });

    this.bucket = this.config.get('S3_BUCKET', { infer: true });
    this.signedUrlTtl = this.config.get('S3_SIGNED_URL_TTL_SECONDS', { infer: true });
    this.sse = this.config.get('S3_SSE', { infer: true });
    this.sseKmsKeyId = this.config.get('S3_SSE_KMS_KEY_ID', { infer: true });
    this.client = new S3Client({
      region: this.config.get('S3_REGION', { infer: true }),
      endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      // With no explicit keys the SDK falls back to the ambient IAM role, which
      // is how this should run on AWS.
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Object storage ready (bucket: ${this.bucket})`);
    } catch {
      // Not fatal: the API can still serve requests that do not touch documents.
      this.logger.warn(
        `Bucket "${this.bucket}" is not reachable. Run \`docker compose up -d\` for local development.`,
      );
    }
  }

  /**
   * Deterministic, non-guessable key. The scope prefix keeps the bucket
   * browsable and lets lifecycle rules target document classes.
   */
  buildKey(scope: DocumentScope, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const unique = randomUUID();
    const prefix = {
      quotation: () =>
        `quotations/${(scope as { quoteRequestId: string }).quoteRequestId}/${(scope as { insurerId: string }).insurerId}`,
      certificate: () => `certificates/${(scope as { policyNumber: string }).policyNumber}`,
      'inspection-shot': () =>
        `inspection-shots/${(scope as { quoteRequestId: string }).quoteRequestId}/${(scope as { shotKey: string }).shotKey}`,
      'inspection-photo': () =>
        `inspection-photos/${(scope as { inspectionId: string }).inspectionId}/${(scope as { slot: string }).slot}`,
      'claim-attachment': () => `claims/${(scope as { claimNumber: string }).claimNumber}`,
      'insurer-logo': () => `insurer-logos/${(scope as { insurerId: string }).insurerId}`,
      'ncd-evidence': () => `ncd/${(scope as { applicationNumber: string }).applicationNumber}`,
    }[scope.kind]();

    return `${prefix}/${unique}-${safeName}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Only sent when configured: MinIO answers 501 NotImplemented to the
        // SSE header, while S3 encrypts at the bucket level regardless.
        ServerSideEncryption: this.sse,
        SSEKMSKeyId: this.sse === 'aws:kms' ? this.sseKmsKeyId : undefined,
      }),
    );
  }

  /** A time-limited download link. Never hand out a bucket URL directly. */
  async signedDownloadUrl(key: string, fileName?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: fileName
          ? `attachment; filename="${fileName.replace(/"/g, '')}"`
          : undefined,
      }),
      { expiresIn: this.signedUrlTtl },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
