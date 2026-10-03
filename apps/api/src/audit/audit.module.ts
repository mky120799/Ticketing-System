import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AuditIntegrityService } from './audit-integrity.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Global()
@Module({ imports: [AuthModule], controllers: [AuditController], providers: [AuditService, AuditIntegrityService], exports: [AuditService, AuditIntegrityService] })
export class AuditModule {}
