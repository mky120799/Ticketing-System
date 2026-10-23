import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { PolicyService } from './policy.service.js';

// The `/me` endpoint (profile.controller.ts) is registered in DirectoryModule, because it records the caller's name.
@Module({ providers: [AuthGuard, PolicyService], exports: [AuthGuard, PolicyService] })
export class AuthModule {}
