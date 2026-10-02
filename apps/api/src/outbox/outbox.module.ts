import { Global, Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { OUTBOX_PUBLISHER, createOutboxPublisher } from './outbox-publishers.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({ providers: [OutboxService, OutboxDispatcher, { provide: OUTBOX_PUBLISHER, useFactory: createOutboxPublisher }], exports: [OutboxService] })
export class OutboxModule {}
