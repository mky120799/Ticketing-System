import { ForbiddenException } from '@nestjs/common';
import { PolicyService } from '../src/auth/policy.service.js';
import type { UserContext } from '../src/auth/user-context.js';

const ticket = { queue: 'payments', branch_code: 'BLR-01', department: 'operations', legal_entity: 'BANK-IN', country: 'IN', sensitivity: 'standard', created_by: 'other-user', assigned_to: null };
const caseAgent: UserContext = { subject: 'case-1', roles: ['case-agent'], branch: 'BLR-01', queues: ['payments'], department: 'operations', legalEntity: 'BANK-IN', country: 'IN' };

describe('ticket authorization policy', () => {
  const policy = new PolicyService();
  it('denies a case agent access outside their queue', () => {
    expect(() => policy.assertTicketAccess(caseAgent, { ...ticket, queue: 'fraud' }, 'ticket:read')).toThrow(ForbiddenException);
  });
  it('denies restricted tickets to agents without a sensitivity entitlement', () => {
    expect(() => policy.assertTicketAccess(caseAgent, { ...ticket, sensitivity: 'restricted' }, 'ticket:read')).toThrow(ForbiddenException);
  });
  it('lets an auditor read a restricted ticket but never change it', () => {
    const auditor: UserContext = { ...caseAgent, subject: 'auditor-1', roles: ['auditor'] };
    const restricted = { ...ticket, sensitivity: 'restricted' };
    expect(() => policy.assertTicketAccess(auditor, restricted, 'ticket:read')).not.toThrow();
    expect(() => policy.assertTicketAccess(auditor, restricted, 'ticket:update')).toThrow(ForbiddenException);
    expect(() => policy.assertTicketAccess(auditor, { ...restricted, queue: 'fraud' }, 'ticket:read')).toThrow(ForbiddenException);
  });
  it('does not grant business permissions to administrators by default', () => {
    expect(() => policy.assertPermission({ ...caseAgent, roles: ['administrator'] }, 'ticket:read')).toThrow(ForbiddenException);
  });
  it('denies maker-checker self-approval', () => {
    expect(() => policy.assertMakerChecker('same-user', 'same-user')).toThrow(ForbiddenException);
    expect(() => policy.assertMakerChecker('maker', 'checker')).not.toThrow();
  });
});
