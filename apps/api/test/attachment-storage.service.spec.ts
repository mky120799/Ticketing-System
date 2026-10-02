import { AttachmentStorageService } from '../src/storage/attachment-storage.service.js';

describe('AttachmentStorageService', () => {
  const keys = ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('does not fall back to local disk when object storage is unconfigured', async () => {
    for (const key of keys) delete process.env[key];
    const storage = new AttachmentStorageService();
    await expect(storage.createUploadUrl('tickets/t/attachment', 'application/pdf', 10)).resolves.toBeNull();
    await expect(storage.createDownloadUrl('tickets/t/attachment', 'application/pdf', 'statement.pdf')).resolves.toBeNull();
  });

  it('creates bounded presigned URLs when an S3-compatible provider is configured', async () => {
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://objects.example.test';
    process.env.OBJECT_STORAGE_BUCKET = 'bank-case-private';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'local-access-key';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'local-secret-key';
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';
    process.env.OBJECT_STORAGE_URL_TTL_SECONDS = '120';
    const storage = new AttachmentStorageService();
    const upload = await storage.createUploadUrl('tickets/t/attachment', 'application/pdf', 10);
    const download = await storage.createDownloadUrl('tickets/t/attachment', 'application/pdf', 'statement.pdf');
    expect(upload?.url).toContain('objects.example.test/bank-case-private/tickets/t/attachment');
    expect(download?.url).toContain('objects.example.test/bank-case-private/tickets/t/attachment');
    expect(upload?.expiresInSeconds).toBe(120);
  });
});
