import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { EscalationService } from './escalation.service.js';
import { WorkflowScheduler } from './workflow-scheduler.js';

@Module({ imports: [TicketsModule], providers: [EscalationService, WorkflowScheduler] })
export class WorkflowModule {}
