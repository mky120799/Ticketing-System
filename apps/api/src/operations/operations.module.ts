import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReportExportService } from './report-export.service.js';
import { OutboxAdminController } from './outbox-admin.controller.js';
import { OutboxAdminService } from './outbox-admin.service.js';

@Module({ imports: [AuthModule], controllers: [OutboxAdminController], providers: [OutboxAdminService, ReportExportService], exports: [ReportExportService] })
export class OperationsModule {}
