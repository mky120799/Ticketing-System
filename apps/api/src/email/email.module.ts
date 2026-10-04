import { Module } from '@nestjs/common';
import { IntakeModule } from '../intake/intake.module.js';
import { IntegrationModule } from '../integrations/integration.module.js';
import { CONTACT_RESOLVER, createContactResolver } from './contact-resolver.js';
import { DeliveryWorker } from './delivery.worker.js';
import { InboundEmailWorker } from './inbound.worker.js';

@Module({ imports: [IntakeModule, IntegrationModule], providers: [{ provide: CONTACT_RESOLVER, useFactory: createContactResolver }, DeliveryWorker, InboundEmailWorker], exports: [DeliveryWorker, InboundEmailWorker] })
export class EmailModule {}
