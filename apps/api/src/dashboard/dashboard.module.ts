import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';

@Module({ imports: [AuthModule, OutboxModule, TicketsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
