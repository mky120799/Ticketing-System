import { Global, Module } from '@nestjs/common';
import { AttachmentStorageService } from './attachment-storage.service.js';

@Global()
@Module({ providers: [AttachmentStorageService], exports: [AttachmentStorageService] })
export class StorageModule {}
