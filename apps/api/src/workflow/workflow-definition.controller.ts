import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { UpsertWorkflowDto, WorkflowDefinitionService } from './workflow-definition.service.js';

@Controller('configuration/workflows')
@UseGuards(AuthGuard)
export class WorkflowDefinitionController {
  constructor(private readonly workflows: WorkflowDefinitionService) {}
  @Get() list(@Req() r: FastifyRequest) { return this.workflows.list(r.user!); }
  @Put(':workflowKey') upsert(@Req() r: FastifyRequest, @Param('workflowKey') key: string, @Body() dto: UpsertWorkflowDto) { return this.workflows.upsert(r.user!, key, dto, r.correlationId!); }
}
