import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { PolicyService } from './policy.service.js';
import { ProfileController } from './profile.controller.js';

@Module({ providers: [AuthGuard, PolicyService], exports: [AuthGuard, PolicyService], controllers: [ProfileController] })
export class AuthModule {}
