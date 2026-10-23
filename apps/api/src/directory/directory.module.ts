import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfileController } from '../auth/profile.controller.js';
import { DirectoryController } from './directory.controller.js';
import { DirectoryService } from './directory.service.js';

/** Staff names for display, plus `GET /me` (which keeps the caller's own entry up to date). */
@Module({ imports: [AuthModule], controllers: [ProfileController, DirectoryController], providers: [DirectoryService], exports: [DirectoryService] })
export class DirectoryModule {}
