import type { User } from 'oidc-client-ts';
import { signOut } from './auth';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';
export interface TicketReference { referenceType: string; sourceSystem: string; maskedValue: string; classification: string; }
export interface TicketNote { id: string; visibility: string; body: string; authorId: string; createdAt: string; }
export interface TicketCommunication { id: string; channel: string; templateKey: string; recipientMasked: string; status: string; approvalId?: string; createdAt: string; }
export interface TicketRetention { legalHold: boolean; retentionUntil: string | null; updatedAt: string; }
export interface TicketListItem { id: string; category: string; priority: string; status: string; sensitivity: string; queue: string; subject: string; branchCode: string; createdAt: string; }
export interface TicketAttachment { id: string; filename: string; contentType: string; sizeBytes: number; classification: string; uploadStatus: string; malwareStatus: string; uploadedBy: string; createdAt: string; }
export interface RelatedTicket { ticketId: string; relationshipType: string; direction: string; }
export interface StatusHistoryEntry { fromStatus: string | null; toStatus: string; reason: string; changedBy: string; changedAt: string; }
export interface Ticket extends TicketListItem { description: string; assigned_to?: string | null; slaStatus?: string | null; firstResponseDueAt?: string | null; resolutionDueAt?: string | null; attachments?: TicketAttachment[]; relatedTickets?: RelatedTicket[]; history?: StatusHistoryEntry[]; references?: TicketReference[]; notes?: TicketNote[]; communications?: TicketCommunication[]; retention?: TicketRetention | null; }
export interface CurrentUser { subject: string; roles: string[]; branch: string; queues: string[]; department: string; legalEntity: string; country: string; }
export interface CommunicationTemplate { templateKey: string; channel: string; active: boolean; requiresApproval: boolean; }

async function request<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID(), ...init?.headers } });
  if (response.status === 401) { void signOut(); throw new Error('Your session has expired. Sign in again.'); }
  if (!response.ok) { const body: { message?: string } = await response.json().catch(() => ({})); throw new Error(body.message ?? 'Request failed'); }
  return response.json() as Promise<T>;
}
export const listTickets = (user: User): Promise<Ticket[]> => request(user, '/tickets');
export const searchTickets = (user: User, query: string): Promise<TicketListItem[]> => request(user, `/tickets/search?q=${encodeURIComponent(query)}&limit=50`);
export const getCurrentUser = (user: User): Promise<CurrentUser> => request(user, '/me');
export const getCommunicationTemplates = (user: User): Promise<CommunicationTemplate[]> => request(user, '/configuration/communication-templates');
export const getTicket = (user: User, id: string): Promise<Ticket> => request(user, `/tickets/${id}`);
export const createTicket = (user: User, ticket: Record<string, unknown>): Promise<Ticket> => request(user, '/tickets', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(ticket) });
export const addNote = (user: User, id: string, body: string): Promise<{ id: string }> => request(user, `/tickets/${id}/notes`, { method: 'POST', body: JSON.stringify({ visibility: 'internal', body }) });
export const transitionTicket = (user: User, id: string, toStatus: string, reason: string): Promise<Ticket> => request(user, `/tickets/${id}/status`, { method: 'POST', body: JSON.stringify({ toStatus, reason }) });
export const createCommunication = (user: User, id: string, payload: { channel: string; templateKey: string; recipientReference: string }): Promise<{ id: string; status: string; approvalId?: string }> => request(user, `/tickets/${id}/communications`, { method: 'POST', body: JSON.stringify(payload) });
export const decideApproval = (user: User, ticketId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<{ id: string; status: string }> => request(user, `/tickets/${ticketId}/approvals/${approvalId}/decision`, { method: 'POST', body: JSON.stringify({ decision }) });
export const updateRetention = (user: User, ticketId: string, payload: { legalHold: boolean; retentionUntil?: string; holdReason?: string }): Promise<TicketRetention & { ticketId: string }> => request(user, `/tickets/${ticketId}/retention`, { method: 'PUT', body: JSON.stringify(payload) });

export interface LiveEvent { type: string; ticketId: string; status: string; at: string; }
interface LiveHandlers { onTicket: (event: LiveEvent) => void; onResync: () => void; onConnection: (connected: boolean) => void; }

/**
 * Subscribes to the server's SSE stream using fetch rather than EventSource so the
 * access token travels in the Authorization header, never in a URL. Reconnects with
 * backoff; every reconnect asks the caller to resync because events may have been missed.
 */
export function subscribeToLiveEvents(user: User, handlers: LiveHandlers): () => void {
  const controller = new AbortController();
  let attempt = 0; let connectedBefore = false;
  const dispatch = (frame: string) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (event === 'ticket' && data) handlers.onTicket(JSON.parse(data) as LiveEvent);
    else if (event === 'resync') handlers.onResync();
  };
  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${baseUrl}/events/stream`, { headers: { Authorization: `Bearer ${user.access_token}`, Accept: 'text/event-stream' }, signal: controller.signal });
        if (response.status === 401) { void signOut(); return; }
        if (!response.ok || !response.body) throw new Error('stream unavailable');
        handlers.onConnection(true); attempt = 0;
        if (connectedBefore) handlers.onResync();
        connectedBefore = true;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += value; const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
          frames.forEach(dispatch);
        }
      } catch { if (controller.signal.aborted) return; }
      handlers.onConnection(false);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt++)));
    }
  };
  void run();
  return () => controller.abort();
}

export interface DashboardSummary { asOf: string; totals: { total: number; active: number; resolved: number; closed: number; overdue: number }; queues: { queue: string; total: number; active: number; overdue: number }[]; aging: { bucket: string; count: number }[]; }
export interface AuditEvent { id: string; occurredAt: string; actorId: string; action: string; outcome: string; correlationId: string; metadata: Record<string, unknown>; eventHash: string; previousHash: string | null; }
export interface QueueMember { userId: string; active: boolean; lastAssignedAt: string | null; }
export interface AssignmentRule { ruleKey: string; queue: string; category: string | null; priority: string | null; strategy: string; sortOrder: number; active: boolean; }
export interface EscalationRule { ruleKey: string; queue: string; trigger: string; escalateToQueue: string; raisePriority: boolean; active: boolean; }

const put = (user: User, path: string, body: unknown) => request<unknown>(user, path, { method: 'PUT', body: JSON.stringify(body) });
export const getDashboard = (user: User): Promise<DashboardSummary> => request(user, '/dashboard/summary');
export const getAuditTrail = (user: User, ticketId: string): Promise<{ events: AuditEvent[] }> => request(user, `/audit/tickets/${ticketId}`);
export const exportAuditTrail = (user: User, ticketId: string): Promise<{ events: AuditEvent[]; exportedAt?: string }> => request(user, `/audit/tickets/${ticketId}/export`);
export const linkTicket = (user: User, ticketId: string, targetTicketId: string, relationshipType: string): Promise<unknown> => request(user, `/tickets/${ticketId}/relationships`, { method: 'POST', body: JSON.stringify({ targetTicketId, relationshipType }) });
export const getAttachmentDownload = (user: User, ticketId: string, attachmentId: string): Promise<{ downloadUrl: string | null; storageConfigured: boolean }> => request(user, `/tickets/${ticketId}/attachments/${attachmentId}/download`);
export const getQueues = (user: User): Promise<{ queue: string; department: string }[]> => request(user, '/configuration/queues');
export const getCategories = (user: User): Promise<{ category: string; defaultQueue: string }[]> => request(user, '/configuration/categories');
export const getQueueMembers = (user: User, queue: string): Promise<QueueMember[]> => request(user, `/configuration/queues/${queue}/members`);
export const saveQueueMember = (user: User, queue: string, userId: string, active: boolean) => put(user, `/configuration/queues/${queue}/members/${encodeURIComponent(userId)}`, { active });
export const getAssignmentRules = (user: User): Promise<AssignmentRule[]> => request(user, '/configuration/assignment-rules');
export const saveAssignmentRule = (user: User, rule: AssignmentRule) => put(user, `/configuration/assignment-rules/${rule.ruleKey}`, { queue: rule.queue, ...(rule.category ? { category: rule.category } : {}), ...(rule.priority ? { priority: rule.priority } : {}), strategy: rule.strategy, sortOrder: rule.sortOrder, active: rule.active });
export const getEscalationRules = (user: User): Promise<EscalationRule[]> => request(user, '/configuration/escalation-rules');
export const saveEscalationRule = (user: User, rule: EscalationRule) => put(user, `/configuration/escalation-rules/${rule.ruleKey}`, { queue: rule.queue, trigger: rule.trigger, escalateToQueue: rule.escalateToQueue, raisePriority: rule.raisePriority, active: rule.active });

/** Attachment flow: declare intent, upload bytes straight to object storage, then record checksum and size. */
export async function uploadAttachment(user: User, ticketId: string, file: File, classification: 'confidential' | 'restricted'): Promise<{ stored: boolean }> {
  const intent = await request<{ id: string; uploadUrl: string | null; storageConfigured: boolean }>(user, `/tickets/${ticketId}/attachments`, { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size, classification }) });
  if (!intent.storageConfigured || !intent.uploadUrl) return { stored: false };
  const bytes = await file.arrayBuffer();
  const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: bytes });
  if (!put.ok) throw new Error('Upload to object storage failed');
  const checksumSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
  await request(user, `/tickets/${ticketId}/attachments/${intent.id}/complete`, { method: 'POST', body: JSON.stringify({ checksumSha256, sizeBytes: file.size }) });
  return { stored: true };
}
