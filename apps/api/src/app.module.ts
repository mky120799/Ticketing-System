import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { DeniedAuthorizationInterceptor } from './audit/denied-authorization.interceptor.js';
import { HealthController } from './health.controller.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { ConfigurationModule } from './configuration/configuration.module.js';
import { IntegrationModule } from './integrations/integration.module.js';
import { CacheModule } from './cache/cache.module.js';
import { IntakeModule } from './intake/intake.module.js';
import { ComplianceModule } from './compliance/compliance.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { LiveModule } from './live/live.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({ imports: [DatabaseModule, CacheModule, StorageModule, AuditModule, AuthModule, TicketsModule, DashboardModule, OutboxModule, ConfigurationModule, IntegrationModule, LiveModule, WorkflowModule, IntakeModule, ComplianceModule, MetricsModule], controllers: [HealthController], providers: [{ provide: APP_INTERCEPTOR, useClass: DeniedAuthorizationInterceptor }] })
export class AppModule {}
