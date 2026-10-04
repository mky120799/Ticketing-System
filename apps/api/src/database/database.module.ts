import { Global, Module } from '@nestjs/common';
import { DatabaseGuardService } from './database-guard.service.js';
import { PgService } from './pg.service.js';

@Global()
@Module({ providers: [PgService, DatabaseGuardService], exports: [PgService, DatabaseGuardService] })
export class DatabaseModule {}
