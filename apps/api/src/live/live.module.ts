import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LiveEventsController } from './live-events.controller.js';
import { LiveEventsService } from './live-events.service.js';

@Global()
@Module({ imports: [AuthModule], controllers: [LiveEventsController], providers: [LiveEventsService], exports: [LiveEventsService] })
export class LiveModule {}
