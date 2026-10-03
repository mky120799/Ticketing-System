import { ForbiddenException, Injectable } from '@nestjs/common';
import type { UserContext } from './user-context.js';

export type Permission = 'ticket:create' | 'ticket:read' | 'ticket:update' | 'ticket:assign' | 'ticket:approve' | 'ticket:reveal' | 'ticket:hold' | 'sla:reconcile' | 'attachment:scan' | 'integration:reconcile' | 'communication:deliver' | 'intake:create' | 'audit:read' | 'dashboard:read' | 'configuration:write';
export interface TicketPolicySubject { queue: string; branch_code: string; department: string; legal_entity: string; country: string; sensitivity: string; created_by: string; assigned_to: string | null; }

const PERMISSIONS: Record<string, Permission[]> = {
  'branch-agent': ['ticket:create', 'ticket:read'], 'call-center-agent': ['ticket:create', 'ticket:read'],
  'case-agent': ['ticket:create', 'ticket:read', 'ticket:update'],
  supervisor: ['ticket:create', 'ticket:read', 'ticket:update', 'ticket:assign', 'ticket:approve', 'ticket:reveal', 'ticket:hold', 'sla:reconcile', 'dashboard:read'],
  auditor: ['ticket:read', 'audit:read', 'dashboard:read'], administrator: ['configuration:write', 'sla:reconcile'], 'attachment-scanner': ['attachment:scan'], 'integration-reconciler': ['integration:reconcile'], 'notification-provider': ['communication:deliver'], 'intake-gateway': ['intake:create']
};

@Injectable()
export class PolicyService {
  has(user: UserContext, permission: Permission): boolean { return user.roles.some((role) => PERMISSIONS[role]?.includes(permission)); }
  assertPermission(user: UserContext, permission: Permission): void { if (!this.has(user, permission)) throw new ForbiddenException('Permission denied'); }
  assertMakerChecker(requestedBy: string, approver: string): void { if (requestedBy === approver) throw new ForbiddenException('Maker-checker policy prohibits self-approval'); }
  assertTicketAccess(user: UserContext, ticket: TicketPolicySubject, permission: Permission): void {
    this.assertPermission(user, permission);
    const sameEntity = user.legalEntity === ticket.legal_entity && user.country === ticket.country;
    const queueAllowed = user.queues.includes(ticket.queue);
    const branchAllowed = user.branch === ticket.branch_code;
    const ownsCase = ticket.created_by === user.subject || ticket.assigned_to === user.subject;
    const scopeAllowed = user.roles.includes('auditor') || user.roles.includes('supervisor') ? queueAllowed : queueAllowed && (branchAllowed || ownsCase);
    const sensitivityAllowed = ticket.sensitivity !== 'restricted' || user.roles.includes('supervisor');
    if (!sameEntity || !scopeAllowed || !sensitivityAllowed) throw new ForbiddenException('Ticket access denied by policy');
  }
}
