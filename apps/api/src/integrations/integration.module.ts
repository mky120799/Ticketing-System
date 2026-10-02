import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { IntegrationController } from './integration.controller.js';
import { IntegrationService } from './integration.service.js';

@Module({ imports: [AuthModule, OutboxModule], controllers: [IntegrationController], providers: [IntegrationService] })
export class IntegrationModule {}
