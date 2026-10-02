import { Controller, Get, Injectable } from '@nestjs/common';
import { PgService } from './database/pg.service.js';

@Injectable()
@Controller('health')
export class HealthController {
  constructor(private readonly db: PgService) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    await this.db.query('SELECT 1');
    return { status: 'ok', database: 'reachable' };
  }
}
