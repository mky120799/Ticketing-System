import type { User } from 'oidc-client-ts';
import { signOut } from './auth';

import { config } from './config';

const baseUrl = config.apiUrl;
export interface TicketReference { referenceType: string; sourceSystem: string; maskedValue: string; classification: string; }
export interface TicketNote { id: string; visibility: string; body: string; authorId: string; createdAt: string; }
export interface TicketCommunication { id: string; channel: string; templateKey: string; recipientMasked: string; status: string; approvalId?: string; createdAt: string; }
export interface TicketRetention { legalHold: boolean; retentionUntil: string | null; updatedAt: string; }
export interface TicketListItem { id: string; category: string; priority: string; status: string; sensitivity: string; queue: string; subject: string; branchCode: string; createdAt: string; }
export interface TicketAttachment { id: string; filename: string; contentType: string; sizeBytes: number; classification: string; uploadStatus: string; malwareStatus: string; uploadedBy: string; createdAt: string; }
export interface RelatedTicket { ticketId: string; relationshipType: string; direction: string; }
export interface StatusHistoryEntry { fromStatus: string | null; toStatus: string; reason: string; changedBy: string; changedAt: string; }
export interface Ticket extends TicketListItem { updatedAt?: string; description: string; assigned_to?: string | null; source_channel?: string; case_kind?: string | null; allowedNextStatuses?: string[]; is_complaint?: boolean; regulatory_profile?: string | null; regulatory_status?: string | null; acknowledge_due_at?: string | null; final_response_due_at?: string | null; vulnerability_flag?: boolean; systemic_issue?: boolean; afca_status?: string; afca_reference?: string | null; communications_blocked?: boolean; idr_outcome?: string | null; root_cause?: string | null; slaStatus?: string | null; firstResponseDueAt?: string | null; resolutionDueAt?: string | null; attachments?: TicketAttachment[]; relatedTickets?: RelatedTicket[]; history?: StatusHistoryEntry[]; references?: TicketReference[]; notes?: TicketNote[]; communications?: TicketCommunication[]; retention?: TicketRetention | null; }
export interface CurrentUser { subject: string; roles: string[]; branch: string; queues: string[]; department: string; legalEntity: string; country: string; }
export interface CommunicationTemplate { templateKey: string; channel: string; active: boolean; requiresApproval: boolean; }

async function request<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID(), ...init?.headers } });
  if (response.status === 401) { void signOut(); throw new Error('Your session has expired. Sign in again.'); }
  if (!response.ok) {
    const body: { message?: string; code?: string } = await response.json().catch(() => ({}));
    if (body.code === 'step_up_required') window.dispatchEvent(new CustomEvent('step-up-required'));
    throw new Error(body.message ?? 'Request failed');
  }
  return response.json() as Promise<T>;
}
export const listTickets = (user: User): Promise<Ticket[]> => request(user, '/tickets');
export const searchTickets = (user: User, query: string): Promise<TicketListItem[]> => request(user, `/tickets/search?q=${encodeURIComponent(query)}&limit=50`);
export const getCurrentUser = (user: User): Promise<CurrentUser> => request(user, '/me');
export const getCommunicationTemplates = (user: User): Promise<CommunicationTemplate[]> => request(user, '/configuration/communication-templates');
export const getTicket = (user: User, id: string): Promise<Ticket> => request(user, `/tickets/${id}`);
export const createTicket = (user: User, ticket: Record<string, unknown>): Promise<Ticket> => request(user, '/tickets', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(ticket) });
export const addNote = (user: User, id: string, body: string): Promise<{ id: string }> => request(user, `/tickets/${id}/notes`, { method: 'POST', body: JSON.stringify({ visibility: 'internal', body }) });
export const transitionTicket = (user: User, id: string, toStatus: string, reason: string, rootCause?: string, idrOutcome?: string, expectedUpdatedAt?: string): Promise<Ticket> => request(user, `/tickets/${id}/status`, { method: 'POST', body: JSON.stringify({ toStatus, reason, ...(rootCause ? { rootCause } : {}), ...(idrOutcome ? { idrOutcome } : {}), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }) });
export const createCommunication = (user: User, id: string, payload: { channel: string; templateKey: string; recipientReference: string }): Promise<{ id: string; status: string; approvalId?: string }> => request(user, `/tickets/${id}/communications`, { method: 'POST', body: JSON.stringify(payload) });
export const decideApproval = (user: User, ticketId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<{ id: string; status: string }> => request(user, `/tickets/${ticketId}/approvals/${approvalId}/decision`, { method: 'POST', body: JSON.stringify({ decision }) });
export const updateRetention = (user: User, ticketId: string, payload: { legalHold: boolean; retentionUntil?: string; holdReason?: string }): Promise<TicketRetention & { ticketId: string }> => request(user, `/tickets/${ticketId}/retention`, { method: 'PUT', body: JSON.stringify(payload) });

export interface LiveEvent { type: string; ticketId: string; status: string; at: string; }
interface LiveHandlers { onTicket: (event: LiveEvent) => void; onNotification?: () => void; onResync: () => void; onConnection: (connected: boolean) => void; }

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
    else if (event === 'notification') handlers.onNotification?.();
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

export interface DashboardSummary { asOf: string; totals: { total: number; active: number; resolved: number; closed: number; overdue: number }; queues: { queue: string; total: number; active: number; overdue: number }[]; aging: { bucket: string; count: number }[]; privacyRequests: { open: number; overdue: number }; complaints: { open: number; ackOverdue: number; atRisk: number; finalResponseOverdue: number; vulnerable: number; withExternalDisputeScheme: number }; last30Days: { resolved: number; resolvedOnTimePercent: number | null; firstResponseOnTimePercent: number | null; avgFirstResponseMinutes: number | null; escalations: number; rootCauses: { cause: string; count: number }[]; channels: { channel: string; count: number }[] }; }
export interface AuditEvent { id: string; occurredAt: string; actorId: string; action: string; outcome: string; correlationId: string; metadata: Record<string, unknown>; eventHash: string; previousHash: string | null; }
export interface QueueMember { userId: string; active: boolean; lastAssignedAt: string | null; }
export interface AssignmentRule { ruleKey: string; queue: string; category: string | null; priority: string | null; strategy: string; sortOrder: number; active: boolean; }
export interface IntakeChannel { channel: string; defaultCategory: string; defaultQueue: string; branchCode: string; defaultPriority: string; active: boolean; }
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
export const getIntakeChannels = (user: User): Promise<IntakeChannel[]> => request(user, '/configuration/intake-channels');
export const saveIntakeChannel = (user: User, c: IntakeChannel) => put(user, `/configuration/intake-channels/${c.channel}`, { defaultCategory: c.defaultCategory, defaultQueue: c.defaultQueue, branchCode: c.branchCode, defaultPriority: c.defaultPriority, active: c.active });

export const ROOT_CAUSES = ['process_gap', 'system_error', 'staff_error', 'customer_error', 'third_party', 'fraud_or_scam', 'policy_or_product', 'communication', 'other'] as const;

export interface RegulatoryProfile { profileKey: string; label: string; jurisdiction: string; acknowledgeBusinessDays: number; finalResponseCalendarDays: number; atRiskDays: number; active: boolean; }
export interface Holiday { date: string; name: string; }
export const IDR_OUTCOMES = ['upheld', 'partially_upheld', 'not_upheld', 'withdrawn', 'resolved_by_agreement'] as const;
export const PRIVACY_OUTCOMES = ['corrected', 'corrected_with_statement', 'refused_with_reasons'] as const;
export const classifyComplaint = (user: User, id: string, body: { isComplaint: boolean; profileKey?: string; vulnerabilityFlag?: boolean; systemicIssue?: boolean; reason: string }) => put(user, `/tickets/${id}/complaint`, body);
export const updateAfca = (user: User, id: string, status: string, reference?: string) => request<unknown>(user, `/tickets/${id}/afca`, { method: 'POST', body: JSON.stringify({ status, ...(reference ? { reference } : {}) }) });
export const setCommunicationBlock = (user: User, id: string, blocked: boolean, reason: string) => put(user, `/tickets/${id}/communication-block`, { blocked, reason });
export const getRegulatoryProfiles = (user: User): Promise<RegulatoryProfile[]> => request(user, '/configuration/regulatory-profiles');
export const saveRegulatoryProfile = (user: User, p: RegulatoryProfile) => put(user, `/configuration/regulatory-profiles/${p.profileKey}`, { label: p.label, jurisdiction: p.jurisdiction, acknowledgeBusinessDays: p.acknowledgeBusinessDays, finalResponseCalendarDays: p.finalResponseCalendarDays, atRiskDays: p.atRiskDays, active: p.active });
export const getHolidays = (user: User): Promise<Holiday[]> => request(user, '/configuration/holidays');
export const saveHoliday = (user: User, h: Holiday) => put(user, `/configuration/holidays/${h.date}`, { name: h.name });
/** Downloads the complaints register as CSV (the response is not JSON, so it bypasses request()). */
export async function downloadComplaintsRegister(user: User, from: string, to: string): Promise<void> {
  const response = await fetch(`${baseUrl}/reports/complaints?from=${from}&to=${to}&format=csv`, { headers: { Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID() } });
  if (!response.ok) throw new Error('Unable to export the complaints register');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `complaints-register-${from}-to-${to}.csv`; link.click(); URL.revokeObjectURL(url);
}
export interface WorkflowDefinition { workflowKey: string; label: string; active: boolean; transitions: { from: string; to: string; allowedRoles?: string[] }[]; }
export const getWorkflows = (user: User): Promise<WorkflowDefinition[]> => request(user, '/configuration/workflows');
export const saveWorkflow = (user: User, w: WorkflowDefinition) => put(user, `/configuration/workflows/${w.workflowKey}`, { label: w.label, active: w.active, transitions: w.transitions });

export interface ChainVerification { status: 'valid' | 'invalid'; verifiedThroughSequence: number; eventsChecked: number; legacyEvents: number; failureSequence?: number; failureReason?: string; verifiedAt: string; }
export interface ChainStatus { verification: ChainVerification | null; lastAnchor: { sequence: number; headHash: string; createdAt: string } | null; }
export interface AuditSearchEvent { sequence: number; id: string; occurredAt: string; actorId: string; action: string; targetType: string; targetId: string; outcome: string; metadata: Record<string, unknown>; eventHash: string; }
export const getChainStatus = (user: User): Promise<ChainStatus> => request(user, '/audit/chain-status');
export const verifyChain = (user: User, full: boolean): Promise<ChainVerification> => request(user, `/audit/verify${full ? '?full=true' : ''}`, { method: 'POST' });
export const searchAudit = (user: User, filters: { actor?: string; action?: string; outcome?: string; from?: string; to?: string; before?: number }): Promise<{ events: AuditSearchEvent[]; nextBefore: number | null }> => {
  const params = new URLSearchParams({ limit: '50' }); for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  return request(user, `/audit/events?${params.toString()}`);
};

export interface StaffNotification { id: string; type: string; ticketId: string | null; title: string; createdAt: string; read: boolean; }
export const getNotifications = (user: User): Promise<{ notifications: StaffNotification[]; unread: number }> => request(user, '/notifications');
export const markNotificationsRead = (user: User, ids?: string[]): Promise<unknown> => request(user, '/notifications/read', { method: 'POST', body: JSON.stringify(ids?.length ? { ids } : {}) });

/** One page of tickets (newest first). `next` is the cursor for the following page, or null when there are no more. */
export async function listTicketsPage(user: User, cursor?: string): Promise<{ items: Ticket[]; next: string | null }> {
  const response = await fetch(`${baseUrl}/tickets?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID() } });
  if (response.status === 401) { void signOut(); throw new Error('Your session has expired. Sign in again.'); }
  if (!response.ok) { const body: { message?: string } = await response.json().catch(() => ({})); throw new Error(body.message ?? 'Request failed'); }
  return { items: (await response.json()) as Ticket[], next: response.headers.get('X-Next-Cursor') };
}

export interface Trends { weeks: number; series: { week: string; created: number; resolved: number; complaints: number; escalated: number }[]; byCategory: { key: string; created: number; resolved: number }[]; byBranch: { key: string; created: number; resolved: number }[]; byQueue: { key: string; created: number; resolved: number }[]; }
export const getTrends = (user: User, weeks = 12): Promise<Trends> => request(user, `/dashboard/trends?weeks=${weeks}`);

export interface OutboxEvent { id: string; eventType: string; aggregateType: string; aggregateId: string; attempts: number; lastError: string | null; createdAt: string; }
export const getOutboxSummary = (user: User): Promise<Record<string, number>> => request(user, '/operations/outbox/summary');
export const getDeadLetters = (user: User): Promise<OutboxEvent[]> => request(user, '/operations/outbox/events?status=dead_letter&limit=100');
export const replayDeadLetter = (user: User, id: string): Promise<{ replayed: number }> => request(user, `/operations/outbox/events/${id}/replay`, { method: 'POST', body: JSON.stringify({}) });
export const replayAllDeadLetters = (user: User): Promise<{ replayed: number }> => request(user, '/operations/outbox/replay', { method: 'POST', body: JSON.stringify({}) });

export interface SlaPolicy { policyKey: string; priority: string; firstResponseMinutes: number; resolutionMinutes: number; active: boolean; calendar: 'wall' | 'business'; pauseWhilePendingCustomer: boolean; }
export interface BusinessHours { country: string; timezone: string; startMinute: number; endMinute: number; workingDays: number[]; }
export interface MessageTemplate { templateKey: string; channel: string; active: boolean; requiresApproval: boolean; subjectTemplate: string | null; bodyTemplate: string | null; }
export const getSlaPolicies = (user: User): Promise<SlaPolicy[]> => request(user, '/configuration/sla');
export const saveSlaPolicy = (user: User, p: SlaPolicy) => put(user, `/configuration/sla/${p.policyKey}/${p.priority}`, { firstResponseMinutes: p.firstResponseMinutes, resolutionMinutes: p.resolutionMinutes, active: p.active, calendar: p.calendar, pauseWhilePendingCustomer: p.pauseWhilePendingCustomer });
export const getBusinessHours = (user: User): Promise<BusinessHours | null> => request(user, '/configuration/business-hours');
export const saveBusinessHours = (user: User, h: BusinessHours) => put(user, '/configuration/business-hours', { timezone: h.timezone, startMinute: h.startMinute, endMinute: h.endMinute, workingDays: h.workingDays });
export const getMessageTemplates = (user: User): Promise<MessageTemplate[]> => request(user, '/configuration/communication-templates/all');
export const saveMessageTemplate = (user: User, t: MessageTemplate) => put(user, `/configuration/communication-templates/${t.templateKey}`, { channel: t.channel, active: t.active, requiresApproval: t.requiresApproval, ...(t.subjectTemplate ? { subjectTemplate: t.subjectTemplate } : {}), ...(t.bodyTemplate ? { bodyTemplate: t.bodyTemplate } : {}) });
