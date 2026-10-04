import { Module } from '@nestjs/common';
import { IntakeModule } from '../intake/intake.module.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalController } from './portal.controller.js';
import { PortalService } from './portal.service.js';

@Module({ imports: [IntakeModule], controllers: [PortalController], providers: [PortalService, PortalAuthGuard] })
export class PortalModule {}
