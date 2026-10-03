import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService } from '../auth/policy.service.js';
import type { CaseRole, UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { TICKET_STATUSES } from '../tickets/ticket.dto.js';

const STAFF_ROLES = ['branch-agent', 'call-center-agent', 'case-agent', 'supervisor', 'auditor', 'administrator'];

export class WorkflowTransitionDto {
  @IsIn(TICKET_STATUSES) from!: string;
  @IsIn(TICKET_STATUSES) to!: string;
  /** If present, only these roles may perform the transition. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(STAFF_ROLES, { each: true }) allowedRoles?: string[];
}

export class UpsertWorkflowDto {
  @IsString() @Length(2, 160) label!: string;
  @IsBoolean() active!: boolean;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => WorkflowTransitionDto) transitions!: WorkflowTransitionDto[];
}

/**
 * Ticket lifecycles as data. Each category points at a workflow; a workflow is a set of legal status transitions,
 * optionally restricted to roles. A bank configures its own flow without a code change; a BPMN engine can sit
 * beside this by consuming the same status events, because status changes still happen only through the API.
 */
@Injectable()
export class WorkflowDefinitionService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  /** Throws unless the category's workflow allows `from` to `to` for a user with these roles. */
  async assertTransition(client: PoolClient, category: string, from: string, to: string, roles: CaseRole[]): Promise<void> {
    const row = (await client.query<{ allowed_roles: string[] | null }>(
      `SELECT wt.allowed_roles FROM workflow_transitions wt JOIN ticket_categories c ON c.workflow_key=wt.workflow_key JOIN workflow_definitions wd ON wd.workflow_key=wt.workflow_key
       WHERE c.category_key=$1 AND wd.active=true AND wt.from_status=$2 AND wt.to_status=$3`, [category, from, to])).rows[0];
    if (!row) throw new ConflictException(`Transition from ${from} to ${to} is not allowed`);
    if (row.allowed_roles && !row.allowed_roles.some((role) => roles.includes(role as CaseRole))) throw new ForbiddenException(`Only ${row.allowed_roles.join(' or ')} can move a ticket from ${from} to ${to}`);
  }

  async nextStatuses(category: string, from: string, roles: CaseRole[]): Promise<string[]> {
    const result = await this.db.query<{ to_status: string; allowed_roles: string[] | null }>(
      `SELECT wt.to_status, wt.allowed_roles FROM workflow_transitions wt JOIN ticket_categories c ON c.workflow_key=wt.workflow_key JOIN workflow_definitions wd ON wd.workflow_key=wt.workflow_key
       WHERE c.category_key=$1 AND wd.active=true AND wt.from_status=$2 ORDER BY wt.to_status`, [category, from]);
    return result.rows.filter((row) => !row.allowed_roles || row.allowed_roles.some((role) => roles.includes(role as CaseRole))).map((row) => row.to_status);
  }

  async list(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const definitions = await this.db.query<{ workflow_key: string; label: string; active: boolean }>('SELECT workflow_key,label,active FROM workflow_definitions ORDER BY workflow_key');
    const transitions = await this.db.query<{ workflow_key: string; from_status: string; to_status: string; allowed_roles: string[] | null }>('SELECT workflow_key,from_status,to_status,allowed_roles FROM workflow_transitions ORDER BY workflow_key,from_status,to_status');
    return definitions.rows.map((d) => ({ workflowKey: d.workflow_key, label: d.label, active: d.active, transitions: transitions.rows.filter((t) => t.workflow_key === d.workflow_key).map((t) => ({ from: t.from_status, to: t.to_status, ...(t.allowed_roles ? { allowedRoles: t.allowed_roles } : {}) })) }));
  }

  /** Full replace of a workflow. Validates it is usable: a ticket can leave `submitted`, and every non-terminal status can still reach `closed` or `cancelled`. */
  async upsert(user: UserContext, workflowKey: string, dto: UpsertWorkflowDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(workflowKey)) throw new ConflictException('Workflow key is invalid');
    this.assertUsable(dto.transitions);
    return this.db.transaction(async (client) => {
      await client.query(`INSERT INTO workflow_definitions (workflow_key,label,active,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workflow_key) DO UPDATE SET label=EXCLUDED.label, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`, [workflowKey, dto.label, dto.active, user.subject]);
      await client.query('DELETE FROM workflow_transitions WHERE workflow_key=$1', [workflowKey]);
      for (const t of dto.transitions) await client.query('INSERT INTO workflow_transitions (workflow_key,from_status,to_status,allowed_roles) VALUES ($1,$2,$3,$4)', [workflowKey, t.from, t.to, t.allowedRoles?.length ? t.allowedRoles : null]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.workflow_updated', targetType: 'workflow', targetId: workflowKey, correlationId, outcome: 'success', metadata: { transitionCount: dto.transitions.length, active: dto.active } });
      await this.outbox.enqueue(client, { eventType: 'configuration.workflow_changed', aggregateType: 'workflow', aggregateId: workflowKey, correlationId, payload: { workflowKey, transitionCount: dto.transitions.length, active: dto.active } });
      return { workflowKey, label: dto.label, active: dto.active, transitions: dto.transitions };
    });
  }

  private assertUsable(transitions: { from: string; to: string }[]): void {
    const edges = new Map<string, Set<string>>();
    for (const t of transitions) { if (t.from === t.to) throw new ConflictException(`A status cannot transition to itself (${t.from})`); (edges.get(t.from) ?? edges.set(t.from, new Set()).get(t.from)!).add(t.to); }
    if (!edges.get('submitted')?.size) throw new ConflictException('A ticket must be able to leave the submitted status');
    // Every status that appears must be able to reach a terminal status, otherwise tickets could get stuck forever.
    const terminal = new Set(['closed', 'cancelled']);
    const reachesTerminal = (start: string): boolean => { const seen = new Set<string>(); const stack = [start]; while (stack.length) { const node = stack.pop()!; if (terminal.has(node)) return true; if (seen.has(node)) continue; seen.add(node); for (const next of edges.get(node) ?? []) stack.push(next); } return false; };
    const statuses = new Set(transitions.flatMap((t) => [t.from, t.to]));
    for (const status of statuses) if (!terminal.has(status) && !reachesTerminal(status)) throw new ConflictException(`Status ${status} cannot reach closed or cancelled`);
    if (!statuses.has('closed') && !statuses.has('cancelled')) throw new ConflictException('A workflow needs a closed or cancelled status');
  }
}
