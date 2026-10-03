import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { UpsertCategoryDto, UpsertQueueDto } from './configuration.dto.js';
import { UpsertSlaPolicyDto } from './sla-policy.dto.js';
import { UpsertCommunicationTemplateDto } from './communication-template.dto.js';
import { RoutingConfigurationService } from './routing.service.js';
import { UpsertAssignmentRuleDto, UpsertEscalationRuleDto, UpsertIntakeChannelDto, UpsertQueueMemberDto } from './routing.dto.js';
import { CaseConfigurationService } from './configuration.service.js';

@Controller('configuration')
@UseGuards(AuthGuard)
export class ConfigurationController {
  constructor(private readonly configuration: CaseConfigurationService, private readonly routing: RoutingConfigurationService) {}
  @Get('queues') queues(@Req() request: FastifyRequest) { return this.configuration.queues(request.user!); }
  @Get('categories') categories(@Req() request: FastifyRequest) { return this.configuration.categories(request.user!); }
  @Get('communication-templates') communicationTemplates(@Req() request: FastifyRequest) { return this.configuration.communicationTemplates(request.user!); }
  @Put('queues/:queueKey') upsertQueue(@Req() request: FastifyRequest, @Param('queueKey') queueKey: string, @Body() dto: UpsertQueueDto) { return this.configuration.upsertQueue(request.user!, queueKey, dto, request.correlationId!); }
  @Put('categories/:categoryKey') upsertCategory(@Req() request: FastifyRequest, @Param('categoryKey') categoryKey: string, @Body() dto: UpsertCategoryDto) { return this.configuration.upsertCategory(request.user!, categoryKey, dto, request.correlationId!); }
  @Put('sla/:policyKey/:priority') upsertSlaPolicy(@Req() request: FastifyRequest, @Param('policyKey') policyKey: string, @Param('priority') priority: string, @Body() dto: UpsertSlaPolicyDto) { return this.configuration.upsertSlaPolicy(request.user!, policyKey, priority, dto, request.correlationId!); }
  @Put('communication-templates/:templateKey') upsertCommunicationTemplate(@Req() request: FastifyRequest, @Param('templateKey') templateKey: string, @Body() dto: UpsertCommunicationTemplateDto) { return this.configuration.upsertCommunicationTemplate(request.user!, templateKey, dto, request.correlationId!); }
  @Get('queues/:queueKey/members') members(@Req() request: FastifyRequest, @Param('queueKey') queueKey: string) { return this.routing.listMembers(request.user!, queueKey); }
  @Put('queues/:queueKey/members/:userId') upsertMember(@Req() request: FastifyRequest, @Param('queueKey') queueKey: string, @Param('userId') userId: string, @Body() dto: UpsertQueueMemberDto) { return this.routing.upsertMember(request.user!, queueKey, userId, dto, request.correlationId!); }
  @Get('assignment-rules') assignmentRules(@Req() request: FastifyRequest) { return this.routing.listAssignmentRules(request.user!); }
  @Put('assignment-rules/:ruleKey') upsertAssignmentRule(@Req() request: FastifyRequest, @Param('ruleKey') ruleKey: string, @Body() dto: UpsertAssignmentRuleDto) { return this.routing.upsertAssignmentRule(request.user!, ruleKey, dto, request.correlationId!); }
  @Get('escalation-rules') escalationRules(@Req() request: FastifyRequest) { return this.routing.listEscalationRules(request.user!); }
  @Put('escalation-rules/:ruleKey') upsertEscalationRule(@Req() request: FastifyRequest, @Param('ruleKey') ruleKey: string, @Body() dto: UpsertEscalationRuleDto) { return this.routing.upsertEscalationRule(request.user!, ruleKey, dto, request.correlationId!); }
  @Get('intake-channels') intakeChannels(@Req() request: FastifyRequest) { return this.routing.listIntakeChannels(request.user!); }
  @Put('intake-channels/:channel') upsertIntakeChannel(@Req() request: FastifyRequest, @Param('channel') channel: string, @Body() dto: UpsertIntakeChannelDto) { return this.routing.upsertIntakeChannel(request.user!, channel, dto, request.correlationId!); }
}
