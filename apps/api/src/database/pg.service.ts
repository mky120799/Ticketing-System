import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class PgService implements OnModuleDestroy {
  // A bounded pool that fails fast: without a connection timeout a saturated pool makes requests wait forever, and a statement
  // or idle-in-transaction timeout stops one stuck request from holding the audit lock (and therefore everyone) indefinitely.
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 20),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 60_000),
    idle_in_transaction_session_timeout: Number(process.env.DATABASE_IDLE_IN_TRANSACTION_MS ?? 60_000)
  });
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> { return this.pool.query<T>(text, values); }
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  onModuleDestroy(): Promise<void> { return this.pool.end(); }
}
