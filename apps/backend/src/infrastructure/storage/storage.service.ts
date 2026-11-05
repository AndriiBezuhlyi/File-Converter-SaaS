import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import type { InfrastructureDependency } from '../dependency.js';
import type { StoragePort } from './storage.port.js';

@Injectable()
export class StorageService implements InfrastructureDependency, StoragePort {
  readonly client: S3Client;
  constructor(@Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: {
        connectionTimeout: config.INFRA_TIMEOUT_MS,
        requestTimeout: config.INFRA_TIMEOUT_MS,
      },
    });
  }
  createKey(purpose: 'inputs' | 'outputs') {
    return `${purpose}/${randomUUID()}`;
  }
  private validateKey(key: string) {
    if (!/^(inputs|outputs)\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key.');
  }
  async start() {
    await this.check();
  }
  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS),
    });
  }
  async put(key: string, body: Readable | Uint8Array, contentType: string, sizeBytes: number) {
    this.validateKey(key);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
      throw new Error('Invalid storage size.');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: sizeBytes,
        // No ACL, public URL, user-supplied bucket, filename-based key or presigned capability.
      }),
      { abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS) },
    );
  }
  async get(key: string) {
    this.validateKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS) },
    );
    if (!(response.Body instanceof Readable)) throw new Error('Storage object stream unavailable.');
    return {
      body: response.Body,
      sizeBytes: response.ContentLength,
      contentType: response.ContentType,
    };
  }
  async head(key: string) {
    this.validateKey(key);
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS) },
    );
    return { sizeBytes: response.ContentLength, contentType: response.ContentType };
  }
  async remove(key: string) {
    this.validateKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), {
      abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS),
    });
  }
  async list(prefix: 'inputs/' | 'outputs/', cursor?: string) {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: cursor,
        MaxKeys: 100,
      }),
      { abortSignal: AbortSignal.timeout(this.config.INFRA_TIMEOUT_MS) },
    );
    return {
      items: (result.Contents ?? []).flatMap((object) =>
        object.Key && object.LastModified && /^(inputs|outputs)\/[a-f0-9-]{36}$/.test(object.Key)
          ? [{ key: object.Key, modifiedAt: object.LastModified }]
          : [],
      ),
      cursor: result.NextContinuationToken,
    };
  }
  stop() {
    this.client.destroy();
  }
}
