export type CaseRole = 'branch-agent' | 'call-center-agent' | 'case-agent' | 'supervisor' | 'auditor' | 'administrator' | 'attachment-scanner' | 'integration-reconciler' | 'notification-provider' | 'intake-gateway';

export interface UserContext {
  subject: string;
  roles: CaseRole[];
  branch: string;
  queues: string[];
  department: string;
  legalEntity: string;
  country: string;
  serviceIdentity?: boolean;
  tokenId?: string;
  tokenExpiresAt?: number;
}

declare module 'fastify' { interface FastifyRequest { user?: UserContext; correlationId?: string; } }
