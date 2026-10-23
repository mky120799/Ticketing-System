/**
 * What each role may do, from the console's point of view.
 *
 * IMPORTANT: this only decides which buttons and menus to SHOW. The API is the authority and re-checks every
 * request (role, scope, branch, sensitivity: see docs/roles-and-access.md). Hiding a button the user cannot use
 * is about a tidy screen, never about security.
 */

export type Role = 'branch-agent' | 'call-center-agent' | 'case-agent' | 'supervisor' | 'auditor' | 'administrator';

/** Each capability lists the roles that have it. Mirrors the permission matrix in apps/api/src/auth/policy.service.ts. */
const CAPABILITIES = {
  /** Open the case workspace at all (administrators have no case access by design). */
  readCases: ['branch-agent', 'call-center-agent', 'case-agent', 'supervisor', 'auditor'],
  createTicket: ['branch-agent', 'call-center-agent', 'case-agent', 'supervisor'],
  /** Notes, status changes, attachments, links, communications, complaint flags. */
  workTicket: ['case-agent', 'supervisor'],
  /** Assign, approve, reveal references, legal hold, dispute-scheme referral, communication block. */
  supervise: ['supervisor'],
  viewDashboard: ['supervisor', 'auditor'],
  viewAudit: ['auditor'],
  administer: ['administrator']
} satisfies Record<string, Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function hasCapability(roles: readonly string[], capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly string[]).some((role) => roles.includes(role));
}

/** Where to send someone who opens the site root: administrators straight to configuration, everyone else to the queue. */
export const homePath = (roles: readonly string[]): string => (hasCapability(roles, 'readCases') ? '/tickets' : hasCapability(roles, 'administer') ? '/admin' : '/no-access');
