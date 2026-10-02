import { GetObjectCommand, PutObjectCommand, S3Client, type ServerSideEncryption } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

export interface SignedAttachmentUrl { url: string; expiresInSeconds: number; }

/**
 * Provider-neutral S3-compatible seam. No object-storage configuration means
 * the API remains metadata-only; it never falls back to local disk.
 */
@Injectable()
export class AttachmentStorageService {
  private readonly bucket = process.env.OBJECT_STORAGE_BUCKET ?? '';
  private readonly expiresInSeconds = this.boundedTtl(process.env.OBJECT_STORAGE_URL_TTL_SECONDS);
  private readonly client = this.createClient();

  async createUploadUrl(objectKey: string, contentType: string, sizeBytes: number): Promise<SignedAttachmentUrl | null> {
    if (!this.client || !this.bucket) return null;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
      ServerSideEncryption: this.serverSideEncryption()
    });
    return { url: await getSignedUrl(this.client, command, { expiresIn: this.expiresInSeconds }), expiresInSeconds: this.expiresInSeconds };
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
    return { url: await getSignedUrl(this.client, command, { expiresIn: this.expiresInSeconds }), expiresInSeconds: this.expiresInSeconds };
  }

  private createClient(): S3Client | null {
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
    const region = process.env.OBJECT_STORAGE_REGION ?? 'us-east-1';
    if (!endpoint || !this.bucket) return null;
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    return new S3Client({
      endpoint,
      region,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {})
    });
  }

  private boundedTtl(value: string | undefined): number {
    const parsed = Number(value ?? 300);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 60), 900) : 300;
  }

  private serverSideEncryption(): ServerSideEncryption {
    const value = process.env.OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION;
    return value === 'aws:kms' || value === 'aws:kms:dsse' ? value : 'AES256';
  }
}
