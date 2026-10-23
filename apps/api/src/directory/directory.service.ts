import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { UserContext } from '../auth/user-context.js';
import { PolicyService } from '../auth/policy.service.js';
import { PgService } from '../database/pg.service.js';

export interface DirectoryPerson { subject: string; displayName: string; username: string | null; roles: string[]; queues: string[] }

/**
 * Staff directory: turns the identity provider's opaque subject IDs into names for display.
 *
 * Tickets and the audit trail store the subject ID (stable, never reused), not a name (names change). This service keeps
 * a small lookup table, refreshed from each person's own token when they open the console. A bank can feed the same
 * table from its HR directory instead. Lookups are limited to the caller's legal entity and country, and return staff
 * names only: no customer data.
 */
@Injectable()
export class DirectoryService {
  private readonly logger = new Logger(DirectoryService.name);
  constructor(private readonly db: PgService, private readonly policy: PolicyService) {}

  /** Records (or refreshes) the signed-in person. Machine identities are skipped: they are shown as "Automatic". */
  async record(user: UserContext): Promise<void> {
    if (user.serviceIdentity) return;
    const displayName = user.displayName || user.username || user.subject;
    try {
      await this.db.query(
        `INSERT INTO staff_directory (subject,display_name,username,email,legal_entity,country,queues,roles,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (subject) DO UPDATE SET display_name=EXCLUDED.display_name, username=EXCLUDED.username, email=EXCLUDED.email,
           legal_entity=EXCLUDED.legal_entity, country=EXCLUDED.country, queues=EXCLUDED.queues, roles=EXCLUDED.roles, last_seen_at=now()`,
        [user.subject, displayName.slice(0, 200), user.username ?? null, user.email ?? null, user.legalEntity, user.country, user.queues, user.roles]
      );
    } catch (error) {
      // Names are a convenience: a directory failure must never stop someone from signing in.
      this.logger.warn(`Staff directory update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Names for the given subject IDs, within the caller's entity and country. Unknown IDs are simply left out. */
  async lookup(user: UserContext, subjects: string[]): Promise<Record<string, string>> {
    this.assertStaff(user);
    const result = await this.db.query<{ subject: string; display_name: string }>(
      'SELECT subject,display_name FROM staff_directory WHERE subject = ANY($1::text[]) AND legal_entity=$2 AND country=$3',
      [subjects, user.legalEntity, user.country]
    );
    return Object.fromEntries(result.rows.map((row) => [row.subject, row.display_name]));
  }

  /**
   * People who could be given work: supervisors pick an assignee, administrators pick queue members. Optionally only
   * those who hold a given queue. Only roles that can work cases are listed.
   */
  async people(user: UserContext, queue?: string): Promise<DirectoryPerson[]> {
    if (!this.policy.has(user, 'ticket:assign') && !this.policy.has(user, 'configuration:write')) throw new ForbiddenException('Permission denied');
    const result = await this.db.query<{ subject: string; display_name: string; username: string | null; roles: string[]; queues: string[] }>(
      `SELECT subject,display_name,username,roles,queues FROM staff_directory
       WHERE legal_entity=$1 AND country=$2 AND roles && ARRAY['case-agent','supervisor']::text[] AND ($3::text IS NULL OR $3 = ANY(queues))
       ORDER BY display_name LIMIT 500`,
      [user.legalEntity, user.country, queue ?? null]
    );
    return result.rows.map((row) => ({ subject: row.subject, displayName: row.display_name, username: row.username, roles: row.roles, queues: row.queues }));
  }

  /** Any staff member (case roles or administrators) may resolve colleagues' names; machine identities may not. */
  private assertStaff(user: UserContext): void {
    if (user.serviceIdentity || (!this.policy.has(user, 'ticket:read') && !this.policy.has(user, 'configuration:write'))) throw new ForbiddenException('Permission denied');
  }
}
