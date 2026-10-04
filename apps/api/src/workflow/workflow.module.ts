import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { RetentionService } from '../retention/retention.service.js';
import { EscalationService } from './escalation.service.js';
import { WorkflowDefinitionController } from './workflow-definition.controller.js';
import { WorkflowDefinitionService } from './workflow-definition.service.js';
import { WorkflowScheduler } from './workflow-scheduler.js';

@Global()
@Module({ imports: [AuthModule, TicketsModule, OperationsModule], controllers: [WorkflowDefinitionController], providers: [RetentionService, EscalationService, WorkflowScheduler, WorkflowDefinitionService], exports: [WorkflowDefinitionService] })
export class WorkflowModule {}
