import { BucketAlreadyOwnedByYou, CreateBucketCommand, DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand as PutCommand, GetObjectCommand, PutObjectCommand, S3Client, type ServerSideEncryption } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface SignedAttachmentUrl { url: string; expiresInSeconds: number; }

/**
 * Provider-neutral S3-compatible seam. No object-storage configuration means
 * the API remains metadata-only; it never falls back to local disk.
 */
@Injectable()
export class AttachmentStorageService implements OnModuleInit {
  private readonly bucket = process.env.OBJECT_STORAGE_BUCKET ?? '';
  private readonly expiresInSeconds = this.boundedTtl(process.env.OBJECT_STORAGE_URL_TTL_SECONDS);
  private readonly client = this.createClient(process.env.OBJECT_STORAGE_ENDPOINT);
  // Presigned URLs are used by browsers, so they must be signed for an address the browser can reach (it may differ from
  // the address this server uses, for example inside Docker or Kubernetes). Defaults to the internal endpoint.
  private readonly signingClient = this.createClient(process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT || process.env.OBJECT_STORAGE_ENDPOINT);

  /** Development convenience (OBJECT_STORAGE_CREATE_BUCKET=true): create the bucket with versioning if it is missing. Production buckets are provisioned by the bank. */
  async onModuleInit(): Promise<void> {
    if (process.env.OBJECT_STORAGE_CREATE_BUCKET !== 'true' || !this.client || !this.bucket) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      await this.client.send(new PutBucketVersioningCommand({ Bucket: this.bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    } catch (error) {
      if (!(error instanceof BucketAlreadyOwnedByYou) && (error as { name?: string }).name !== 'BucketAlreadyOwnedByYou') new Logger(AttachmentStorageService.name).warn(`Could not create bucket: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async createUploadUrl(objectKey: string, contentType: string, sizeBytes: number): Promise<SignedAttachmentUrl | null> {
    if (!this.client || !this.bucket) return null;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
      ServerSideEncryption: this.serverSideEncryption()
    });
    return { url: await getSignedUrl(this.signingClient!, command, { expiresIn: this.expiresInSeconds }), expiresInSeconds: this.expiresInSeconds };
  }

  async createDownloadUrl(objectKey: string, contentType: string, filename: string): Promise<SignedAttachmentUrl | null> {
    if (!this.client || !this.bucket) return null;
    const safeFilename = filename.replace(/[\r\n"\\]/g, '_');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentType: contentType,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`
    });
    return { url: await getSignedUrl(this.signingClient!, command, { expiresIn: this.expiresInSeconds }), expiresInSeconds: this.expiresInSeconds };
  }

  /** Reads an object server-side (used by the malware scanner). */
  async getObjectStream(objectKey: string): Promise<AsyncIterable<Uint8Array> | null> {
    if (!this.client || !this.bucket) return null;
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    return (response.Body as AsyncIterable<Uint8Array> | undefined) ?? null;
  }

  /** Stores a small JSON document (for example an audit anchor). Returns the key, or null when storage is not configured. */
  async putJson(objectKey: string, value: unknown): Promise<string | null> {
    if (!this.client || !this.bucket) return null;
    await this.client.send(new PutCommand({ Bucket: this.bucket, Key: objectKey, Body: JSON.stringify(value), ContentType: 'application/json', ServerSideEncryption: this.serverSideEncryption() }));
    return objectKey;
  }

  /** Stores a text document (for example a scheduled report). Returns the key, or null when storage is not configured. */
  async putText(objectKey: string, text: string, contentType: string): Promise<string | null> {
    if (!this.client || !this.bucket) return null;
    await this.client.send(new PutCommand({ Bucket: this.bucket, Key: objectKey, Body: text, ContentType: contentType, ServerSideEncryption: this.serverSideEncryption() }));
    return objectKey;
  }

  /** Idempotent: deleting a missing object succeeds. No-op when storage is not configured. */
  async deleteObject(objectKey: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  private createClient(endpoint: string | undefined): S3Client | null {
    const region = process.env.OBJECT_STORAGE_REGION ?? 'us-east-1';
    if (!endpoint || !this.bucket) return null;
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    return new S3Client({
      endpoint,
      region,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      // The SDK's default CRC32 checksum would be baked into presigned URLs for an empty body, so a browser upload of real
      // content fails with BadDigest. The uploader's SHA-256 is verified by the scanner instead.
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {})
    });
  }

  private boundedTtl(value: string | undefined): number {
    const parsed = Number(value ?? 300);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 60), 900) : 300;
  }

  /** Only sent when explicitly configured; otherwise rely on the bucket's default encryption (preferred, and portable across S3 implementations). */
  private serverSideEncryption(): ServerSideEncryption | undefined {
    const value = process.env.OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION;
    return value === 'aws:kms' || value === 'aws:kms:dsse' || value === 'AES256' ? value : undefined;
  }
}
