import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { UpsertBusinessHoursDto, AfcaDto, ClassifyComplaintDto, CommunicationBlockDto, SubjectAccessDto, UpsertHolidayDto, UpsertRegulatoryProfileDto } from './compliance.dto.js';
import { ComplianceService } from './compliance.service.js';

@Controller()
@UseGuards(AuthGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}
  @Put('tickets/:ticketId/complaint') classify(@Req() r: FastifyRequest, @Param('ticketId', ParseUUIDPipe) id: string, @Body() dto: ClassifyComplaintDto) { return this.compliance.classify(r.user!, id, dto, r.correlationId!); }
  @Post('tickets/:ticketId/afca') afca(@Req() r: FastifyRequest, @Param('ticketId', ParseUUIDPipe) id: string, @Body() dto: AfcaDto) { return this.compliance.afca(r.user!, id, dto, r.correlationId!); }
  @Put('tickets/:ticketId/communication-block') block(@Req() r: FastifyRequest, @Param('ticketId', ParseUUIDPipe) id: string, @Body() dto: CommunicationBlockDto) { return this.compliance.setCommunicationBlock(r.user!, id, dto, r.correlationId!); }
  @Post('privacy/subject-access') @Header('Cache-Control', 'no-store') subjectAccess(@Req() r: FastifyRequest, @Body() dto: SubjectAccessDto) { return this.compliance.subjectAccess(r.user!, dto.reference, r.correlationId!); }
  @Get('reports/complaints') @Header('Cache-Control', 'no-store')
  register(@Req() r: FastifyRequest, @Query('from') from: string, @Query('to') to: string, @Query('format') format = 'json') { return this.compliance.register(r.user!, from, to, format === 'csv' ? 'csv' : 'json', r.correlationId!); }
  @Get('configuration/regulatory-profiles') profiles(@Req() r: FastifyRequest) { return this.compliance.listProfiles(r.user!); }
  @Put('configuration/regulatory-profiles/:profileKey') upsertProfile(@Req() r: FastifyRequest, @Param('profileKey') key: string, @Body() dto: UpsertRegulatoryProfileDto) { return this.compliance.upsertProfile(r.user!, key, dto, r.correlationId!); }
  @Get('configuration/business-hours') businessHours(@Req() r: FastifyRequest) { return this.compliance.getBusinessHours(r.user!); }
  @Put('configuration/business-hours') upsertBusinessHours(@Req() r: FastifyRequest, @Body() dto: UpsertBusinessHoursDto) { return this.compliance.upsertBusinessHours(r.user!, dto, r.correlationId!); }
  @Get('configuration/holidays') holidays(@Req() r: FastifyRequest) { return this.compliance.listHolidays(r.user!); }
  @Put('configuration/holidays/:date') upsertHoliday(@Req() r: FastifyRequest, @Param('date') date: string, @Body() dto: UpsertHolidayDto) { return this.compliance.upsertHoliday(r.user!, date, dto.name, r.correlationId!); }
}
