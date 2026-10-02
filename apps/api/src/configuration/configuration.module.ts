import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CaseConfigurationService } from './configuration.service.js';
import { RoutingConfigurationService } from './routing.service.js';
import { ConfigurationController } from './configuration.controller.js';

@Module({ imports: [AuthModule], controllers: [ConfigurationController], providers: [CaseConfigurationService, RoutingConfigurationService], exports: [CaseConfigurationService] })
export class ConfigurationModule {}
