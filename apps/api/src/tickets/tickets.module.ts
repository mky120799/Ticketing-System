import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { AttachmentScanWorker } from './attachment-scan.worker.js';
import { AssignmentService } from './assignment.service.js';
import { ResolutionNoticeService } from './resolution-notice.service.js';
import { UploadLinkService } from './upload-link.service.js';
import { SlaService } from './sla.service.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ConfigurationModule } from '../configuration/configuration.module.js';

@Module({ imports: [AuthModule, OutboxModule, ConfigurationModule], controllers: [TicketsController], providers: [TicketsService, SlaService, AssignmentService, ResolutionNoticeService, UploadLinkService, AttachmentScanWorker], exports: [SlaService, AssignmentService] })
export class TicketsModule {}
