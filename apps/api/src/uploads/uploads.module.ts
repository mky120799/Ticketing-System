import { Module } from '@nestjs/common';
import { PortalModule } from '../portal/portal.module.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({ imports: [PortalModule], controllers: [UploadsController], providers: [UploadsService] })
export class UploadsModule {}
