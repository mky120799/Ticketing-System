import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PolicyService } from '../auth/policy.service.js';
import { LiveEventsService, type LiveFrame } from './live-events.service.js';

const HEARTBEAT_MS = 25_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

@Controller('events')
@UseGuards(AuthGuard)
export class LiveEventsController {
  constructor(private readonly live: LiveEventsService, private readonly policy: PolicyService) {}

  /** Server-Sent Events stream of minimized ticket-change notifications visible to the caller. */
  @Get('stream')
  stream(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    const user = request.user!;
    this.policy.assertPermission(user, 'ticket:read');
    let sequence = 0;
    const raw = reply.raw;
    const write = (frame: LiveFrame) => { raw.write(`id: ${++sequence}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`); };
    const unsubscribe = this.live.subscribe(user, write); // throws 429 before the response is taken over
    // Fastify's CORS headers live on the reply object; copy them since we bypass its send path.
    reply.hijack();
    raw.writeHead(200, { ...(reply.getHeaders() as OutgoingHttpHeaders), 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    raw.write('retry: 5000\n\n: connected\n\n');

    const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    // A stream must not outlive the access token that authorized it.
    const msUntilExpiry = user.tokenExpiresAt ? Math.max(0, user.tokenExpiresAt * 1000 - Date.now()) : MAX_TIMER_MS;
    const expiry = setTimeout(() => { raw.write('event: expired\ndata: {}\n\n'); raw.end(); }, Math.min(msUntilExpiry, MAX_TIMER_MS));
    raw.on('close', () => { clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); });
  }
}
