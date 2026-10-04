import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { IntakeController } from './intake.controller.js';
import { CustomerReplyService } from './customer-reply.service.js';
import { IntakeService } from './intake.service.js';

@Module({ imports: [AuthModule, TicketsModule], controllers: [IntakeController], providers: [IntakeService, CustomerReplyService], exports: [IntakeService, CustomerReplyService] })
export class IntakeModule {}
