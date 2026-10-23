/**
 * The staff console's API client.
 *
 * Every call goes through `request()`, which:
 *   - sends the user's access token as a Bearer header (never in a URL),
 *   - adds a fresh correlation ID so one click can be traced through API logs, events and the audit trail,
 *   - signs the user out on 401 (the session is gone),
 *   - announces "step-up required" so the shell can ask for a fresh sign-in,
 *   - throws `ApiError` with the HTTP status, so callers can react to 403 / 404 / 409 differently.
 *
 * The functions below are thin and typed; screens never call `fetch` directly.
 */
import type { User } from 'oidc-client-ts';
import { signOut } from './auth';
import { config } from './config';

const baseUrl = config.apiUrl;

// ---------------------------------------------------------------------------
// Types returned by the API
// ---------------------------------------------------------------------------

export interface TicketReference { referenceType: string; sourceSystem: string; maskedValue: string; classification: string; }
/** A reference after a supervisor's audited "reveal" (the only place the full value appears). */
export interface RevealedReference { referenceType: string; sourceSystem: string; opaqueReference: string; classification: string; }
export interface TicketNote { id: string; visibility: 'internal' | 'customer' | string; body: string; authorId: string; createdAt: string; }
export interface TicketCommunication { id: string; channel: string; templateKey: string; recipientMasked: string; status: string; approvalId?: string; createdAt: string; }
export interface TicketRetention { legalHold: boolean; retentionUntil: string | null; updatedAt: string; }
/** The minimal fields every listing returns (search returns only these). */
export interface TicketListItem { id: string; category: string; priority: string; status: string; sensitivity: string; queue: string; subject: string; branchCode: string; createdAt: string; }
export interface TicketAttachment { id: string; filename: string; contentType: string; sizeBytes: number; classification: string; uploadStatus: string; malwareStatus: string; uploadedBy: string; createdAt: string; }
export interface RelatedTicket { ticketId: string; relationshipType: string; direction: string; }
export interface StatusHistoryEntry { fromStatus: string | null; toStatus: string; reason: string; changedBy: string; changedAt: string; }

/**
 * A full ticket. The paged list returns most of these fields; opening a ticket adds the
 * nested collections (notes, attachments, history, ...). Field names mirror the API exactly,
 * which is why some are snake_case (database columns) and some camelCase (computed values).
 */
export interface Ticket extends TicketListItem {
  updatedAt?: string; description: string; created_by?: string; assigned_to?: string | null; source_channel?: string; case_kind?: string | null;
  allowedNextStatuses?: string[];
  // complaints and privacy requests (regulatory clocks)
  is_complaint?: boolean; regulatory_profile?: string | null; regulatory_status?: string | null;
  acknowledge_due_at?: string | null; final_response_due_at?: string | null; vulnerability_flag?: boolean; systemic_issue?: boolean;
  afca_status?: string; afca_reference?: string | null; communications_blocked?: boolean; idr_outcome?: string | null; root_cause?: string | null;
  // service levels
  slaStatus?: string | null; firstResponseDueAt?: string | null; resolutionDueAt?: string | null;
  // nested collections (single-ticket read only)
  attachments?: TicketAttachment[]; relatedTickets?: RelatedTicket[]; history?: StatusHistoryEntry[]; references?: TicketReference[];
  notes?: TicketNote[]; communications?: TicketCommunication[]; retention?: TicketRetention | null;
}
/** Who the API thinks the signed-in person is: roles and organisational scope from the identity provider's token. */
export interface CurrentUser { subject: string; roles: string[]; branch: string; queues: string[]; department: string; legalEntity: string; country: string; displayName?: string; }
export interface CommunicationTemplate { templateKey: string; channel: string; active: boolean; requiresApproval: boolean; }

// ---------------------------------------------------------------------------
// The request helper
// ---------------------------------------------------------------------------

/** An HTTP error from the API. `status` lets callers tell "not allowed" (403) from "changed by someone else" (409). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'ApiError'; }
}

/** Common headers: the token for authorisation and a correlation ID for tracing this one request end to end. */
const authHeaders = (user: User): Record<string, string> => ({ Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID() });

/** Turns a failed response into an `ApiError`, handling the two responses every screen treats the same way. */
async function failure(response: Response): Promise<ApiError> {
  if (response.status === 401) { void signOut(); return new ApiError('Your session has expired. Sign in again.', 401); }
  const body: { message?: string | string[]; code?: string } = await response.json().catch(() => ({}));
  // The API refuses sensitive actions without a recent sign-in. The session layer listens for this and shows a banner.
  if (body.code === 'step_up_required') window.dispatchEvent(new CustomEvent('step-up-required'));
  const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
  return new ApiError(message ?? 'Request failed', response.status, body.code);
}

async function request<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...authHeaders(user), ...init?.headers } });
  if (!response.ok) throw await failure(response);
  return response.json() as Promise<T>;
}
const post = <T>(user: User, path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>(user, path, { method: 'POST', body: JSON.stringify(body), headers });
const put = (user: User, path: string, body: unknown) => request<unknown>(user, path, { method: 'PUT', body: JSON.stringify(body) });

/** Saves a downloaded blob as a file in the browser. */
function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

/** SHA-256 of the file bytes, sent after an upload so the API can prove the file arrived intact. */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Session and tickets
// ---------------------------------------------------------------------------

export const getCurrentUser = (user: User): Promise<CurrentUser> => request(user, '/me');

// ---------------------------------------------------------------------------
// Staff directory (names for the subject IDs stored on tickets and audit events)
// ---------------------------------------------------------------------------

export interface DirectoryPerson { subject: string; displayName: string; username: string | null; roles: string[]; queues: string[] }
/** Subject ID → display name, for IDs in the caller's entity and country. IDs the directory does not know are left out. */
export const lookupNames = (user: User, subjects: string[]): Promise<Record<string, string>> => post(user, '/directory/lookup', { subjects });
/** People who can be given work (supervisors and administrators only), optionally only those in one queue. */
export const listPeople = (user: User, queue?: string): Promise<DirectoryPerson[]> => request(user, `/directory/people${queue ? `?queue=${encodeURIComponent(queue)}` : ''}`);

/** One page of tickets (newest first). `next` is the cursor for the following page, or null when there are no more. */
export async function listTicketsPage(user: User, cursor?: string): Promise<{ items: Ticket[]; next: string | null }> {
  const response = await fetch(`${baseUrl}/tickets?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: authHeaders(user) });
  if (!response.ok) throw await failure(response);
  // The cursor travels in a response header so the body stays a plain array.
  return { items: (await response.json()) as Ticket[], next: response.headers.get('X-Next-Cursor') };
}
/** Search over safe metadata only (subject, category, status, queue). Results carry the minimal list fields. */
export const searchTickets = (user: User, query: string): Promise<TicketListItem[]> => request(user, `/tickets/search?q=${encodeURIComponent(query)}&limit=50`);
export const getTicket = (user: User, id: string): Promise<Ticket> => request(user, `/tickets/${id}`);
/** The idempotency key makes a double-click or a network retry create one ticket, not two. */
export const createTicket = (user: User, ticket: Record<string, unknown>): Promise<Ticket> => post(user, '/tickets', ticket, { 'Idempotency-Key': crypto.randomUUID() });
/** Edit priority or description. `expectedUpdatedAt` makes the API refuse (409) if someone else changed the ticket first. */
export const updateTicket = (user: User, id: string, changes: { priority?: string; description?: string; expectedUpdatedAt?: string }): Promise<Ticket> => request(user, `/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
/** Supervisor: move the ticket to a queue and optionally a person. Leaving `assigneeId` out puts it back in the queue's pool. */
export const assignTicket = (user: User, id: string, body: { queue: string; assigneeId?: string; expectedUpdatedAt?: string }): Promise<Ticket> => post(user, `/tickets/${id}/assignments`, body);
/** Supervisor, step-up: the full customer references. Always written to the audit trail. */
export const revealReferences = (user: User, id: string): Promise<RevealedReference[]> => post(user, `/tickets/${id}/sensitive-reveals`);
/** Internal notes stay with staff; customer notes are visible in the portal and count as the first response. */
export const addNote = (user: User, id: string, body: string, visibility: 'internal' | 'customer' = 'internal'): Promise<{ id: string }> => post(user, `/tickets/${id}/notes`, { visibility, body });
export const transitionTicket = (user: User, id: string, toStatus: string, reason: string, rootCause?: string, idrOutcome?: string, expectedUpdatedAt?: string): Promise<Ticket> =>
  post(user, `/tickets/${id}/status`, { toStatus, reason, ...(rootCause ? { rootCause } : {}), ...(idrOutcome ? { idrOutcome } : {}), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
export const linkTicket = (user: User, ticketId: string, targetTicketId: string, relationshipType: string): Promise<unknown> => post(user, `/tickets/${ticketId}/relationships`, { targetTicketId, relationshipType });
export const updateRetention = (user: User, ticketId: string, payload: { legalHold: boolean; retentionUntil?: string; holdReason?: string }): Promise<TicketRetention & { ticketId: string }> => put(user, `/tickets/${ticketId}/retention`, payload) as Promise<TicketRetention & { ticketId: string }>;

// ---------------------------------------------------------------------------
// Complaints and compliance controls
// ---------------------------------------------------------------------------

/** Mark (or unmark) a complaint and set its flags. Marking starts the regulatory clock from the time of receipt. */
export const classifyComplaint = (user: User, id: string, body: { isComplaint: boolean; profileKey?: string; vulnerabilityFlag?: boolean; systemicIssue?: boolean; reason: string }) => put(user, `/tickets/${id}/complaint`, body);
/** Supervisor: record a referral to the external dispute scheme (AFCA in Australia). */
export const updateAfca = (user: User, id: string, status: string, reference?: string) => post<unknown>(user, `/tickets/${id}/afca`, { status, ...(reference ? { reference } : {}) });
/** Supervisor: stop (or allow) customer communications, e.g. so a fraud suspect is not tipped off. */
export const setCommunicationBlock = (user: User, id: string, blocked: boolean, reason: string) => put(user, `/tickets/${id}/communication-block`, { blocked, reason });

// ---------------------------------------------------------------------------
// Customer communications and approvals
// ---------------------------------------------------------------------------

export const getCommunicationTemplates = (user: User): Promise<CommunicationTemplate[]> => request(user, '/configuration/communication-templates');
export const createCommunication = (user: User, id: string, payload: { channel: string; templateKey: string; recipientReference: string }): Promise<{ id: string; status: string; approvalId?: string }> => post(user, `/tickets/${id}/communications`, payload);
/** Maker-checker: the API refuses if the person deciding is the person who asked. */
export const decideApproval = (user: User, ticketId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<{ id: string; status: string }> => post(user, `/tickets/${ticketId}/approvals/${approvalId}/decision`, { decision });

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Three-step upload: declare the file (the API returns a short-lived upload URL), send the bytes straight to
 * object storage, then confirm with a checksum. The file stays unavailable until the malware scan marks it clean.
 */
export async function uploadAttachment(user: User, ticketId: string, file: File, classification: 'confidential' | 'restricted'): Promise<{ stored: boolean }> {
  const intent = await post<{ id: string; uploadUrl: string | null; storageConfigured: boolean }>(user, `/tickets/${ticketId}/attachments`, { filename: file.name, contentType: file.type, sizeBytes: file.size, classification });
  if (!intent.storageConfigured || !intent.uploadUrl) return { stored: false };
  const bytes = await file.arrayBuffer();
  const upload = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: bytes });
  if (!upload.ok) throw new Error('Upload to object storage failed');
  await post(user, `/tickets/${ticketId}/attachments/${intent.id}/complete`, { checksumSha256: await sha256Hex(bytes), sizeBytes: file.size });
  return { stored: true };
}
export const getAttachmentDownload = (user: User, ticketId: string, attachmentId: string): Promise<{ downloadUrl: string | null; storageConfigured: boolean }> => request(user, `/tickets/${ticketId}/attachments/${attachmentId}/download`);

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)
// ---------------------------------------------------------------------------

export interface LiveEvent { type: string; ticketId: string; status: string; at: string; }
interface LiveHandlers { onTicket: (event: LiveEvent) => void; onNotification?: () => void; onResync: () => void; onConnection: (connected: boolean) => void; }

/**
 * Subscribes to the server's SSE stream using fetch rather than EventSource so the
 * access token travels in the Authorization header, never in a URL. Reconnects with
 * backoff; every reconnect asks the caller to resync because events may have been missed.
 * Returns an "unsubscribe" function.
 */
export function subscribeToLiveEvents(user: User, handlers: LiveHandlers): () => void {
  const controller = new AbortController();
  let attempt = 0; let connectedBefore = false;
  // An SSE frame looks like "event: ticket\ndata: {...}". Frames are separated by a blank line.
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
      // Exponential backoff: 1s, 2s, 4s ... capped at 30s, so a down server is not hammered.
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt++)));
    }
  };
  void run();
  return () => controller.abort();
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface StaffNotification { id: string; type: string; ticketId: string | null; title: string; createdAt: string; read: boolean; }
export const getNotifications = (user: User): Promise<{ notifications: StaffNotification[]; unread: number }> => request(user, '/notifications');
/** No IDs means "mark everything read". */
export const markNotificationsRead = (user: User, ids?: string[]): Promise<unknown> => post(user, '/notifications/read', ids?.length ? { ids } : {});

// ---------------------------------------------------------------------------
// Dashboard and reports (aggregates only, never ticket content)
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  asOf: string;
  totals: { total: number; active: number; resolved: number; closed: number; overdue: number };
  queues: { queue: string; total: number; active: number; overdue: number }[];
  aging: { bucket: string; count: number }[];
  privacyRequests: { open: number; overdue: number };
  complaints: { open: number; ackOverdue: number; atRisk: number; finalResponseOverdue: number; vulnerable: number; withExternalDisputeScheme: number };
  last30Days: { resolved: number; resolvedOnTimePercent: number | null; firstResponseOnTimePercent: number | null; avgFirstResponseMinutes: number | null; escalations: number; rootCauses: { cause: string; count: number }[]; channels: { channel: string; count: number }[] };
}
export interface Trends { weeks: number; series: { week: string; created: number; resolved: number; complaints: number; escalated: number }[]; byCategory: { key: string; created: number; resolved: number }[]; byBranch: { key: string; created: number; resolved: number }[]; byQueue: { key: string; created: number; resolved: number }[]; }
export const getDashboard = (user: User): Promise<DashboardSummary> => request(user, '/dashboard/summary');
export const getTrends = (user: User, weeks = 12): Promise<Trends> => request(user, `/dashboard/trends?weeks=${weeks}`);
/** Downloads the complaints register as CSV (the response is not JSON, so it bypasses request()). Needs step-up. */
export async function downloadComplaintsRegister(user: User, from: string, to: string): Promise<void> {
  const response = await fetch(`${baseUrl}/reports/complaints?from=${from}&to=${to}&format=csv`, { headers: authHeaders(user) });
  if (!response.ok) throw await failure(response);
  saveFile(await response.blob(), `complaints-register-${from}-to-${to}.csv`);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent { id: string; occurredAt: string; actorId: string; action: string; outcome: string; correlationId: string; metadata: Record<string, unknown>; eventHash: string; previousHash: string | null; }
export interface ChainVerification { status: 'valid' | 'invalid'; verifiedThroughSequence: number; eventsChecked: number; legacyEvents: number; failureSequence?: number; failureReason?: string; verifiedAt: string; }
export interface ChainStatus { verification: ChainVerification | null; lastAnchor: { sequence: number; headHash: string; createdAt: string } | null; }
export interface AuditSearchEvent { sequence: number; id: string; occurredAt: string; actorId: string; action: string; targetType: string; targetId: string; outcome: string; metadata: Record<string, unknown>; eventHash: string; }
export interface AuditFilters { actor?: string; action?: string; outcome?: string; from?: string; to?: string; before?: number }

export const getAuditTrail = (user: User, ticketId: string): Promise<{ events: AuditEvent[] }> => request(user, `/audit/tickets/${ticketId}`);
/** Exports one ticket's audit trail as a JSON file (the export itself is audited). */
export async function exportAuditTrail(user: User, ticketId: string): Promise<void> {
  const report = await request<{ events: AuditEvent[]; exportedAt?: string }>(user, `/audit/tickets/${ticketId}/export`);
  saveFile(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `audit-${ticketId}.json`);
}
export const getChainStatus = (user: User): Promise<ChainStatus> => request(user, '/audit/chain-status');
/** Incremental checks events since the last clean run; full re-checks the whole hash chain. */
export const verifyChain = (user: User, full: boolean): Promise<ChainVerification> => request(user, `/audit/verify${full ? '?full=true' : ''}`, { method: 'POST' });
export const searchAudit = (user: User, filters: AuditFilters): Promise<{ events: AuditSearchEvent[]; nextBefore: number | null }> => {
  const params = new URLSearchParams({ limit: '50' });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  return request(user, `/audit/events?${params.toString()}`);
};

// ---------------------------------------------------------------------------
// Configuration (administrators; some lists are readable by all staff in scope)
// ---------------------------------------------------------------------------

export interface QueueMember { userId: string; active: boolean; lastAssignedAt: string | null; }
export interface AssignmentRule { ruleKey: string; queue: string; category: string | null; priority: string | null; strategy: string; sortOrder: number; active: boolean; }
export interface IntakeChannel { channel: string; defaultCategory: string; defaultQueue: string; branchCode: string; defaultPriority: string; active: boolean; }
export interface EscalationRule { ruleKey: string; queue: string; trigger: string; escalateToQueue: string; raisePriority: boolean; active: boolean; }
export interface RegulatoryProfile { profileKey: string; label: string; jurisdiction: string; acknowledgeBusinessDays: number; finalResponseCalendarDays: number; atRiskDays: number; active: boolean; }
export interface Holiday { date: string; name: string; }
export interface WorkflowDefinition { workflowKey: string; label: string; active: boolean; transitions: { from: string; to: string; allowedRoles?: string[] }[]; }
export interface SlaPolicy { policyKey: string; priority: string; firstResponseMinutes: number; resolutionMinutes: number; active: boolean; calendar: 'wall' | 'business'; pauseWhilePendingCustomer: boolean; }
export interface BusinessHours { country: string; timezone: string; startMinute: number; endMinute: number; workingDays: number[]; }
export interface MessageTemplate { templateKey: string; channel: string; active: boolean; requiresApproval: boolean; subjectTemplate: string | null; bodyTemplate: string | null; }

/** Queues and categories in the caller's scope. Readable by every staff member (used to fill pickers). */
export const getQueues = (user: User): Promise<{ queue: string; department: string }[]> => request(user, '/configuration/queues');
export const getCategories = (user: User): Promise<{ category: string; defaultQueue: string }[]> => request(user, '/configuration/categories');

export const getQueueMembers = (user: User, queue: string): Promise<QueueMember[]> => request(user, `/configuration/queues/${queue}/members`);
export const saveQueueMember = (user: User, queue: string, userId: string, active: boolean) => put(user, `/configuration/queues/${queue}/members/${encodeURIComponent(userId)}`, { active });
export const getAssignmentRules = (user: User): Promise<AssignmentRule[]> => request(user, '/configuration/assignment-rules');
export const saveAssignmentRule = (user: User, rule: AssignmentRule) => put(user, `/configuration/assignment-rules/${rule.ruleKey}`, { queue: rule.queue, ...(rule.category ? { category: rule.category } : {}), ...(rule.priority ? { priority: rule.priority } : {}), strategy: rule.strategy, sortOrder: rule.sortOrder, active: rule.active });
export const getEscalationRules = (user: User): Promise<EscalationRule[]> => request(user, '/configuration/escalation-rules');
export const saveEscalationRule = (user: User, rule: EscalationRule) => put(user, `/configuration/escalation-rules/${rule.ruleKey}`, { queue: rule.queue, trigger: rule.trigger, escalateToQueue: rule.escalateToQueue, raisePriority: rule.raisePriority, active: rule.active });
export const getIntakeChannels = (user: User): Promise<IntakeChannel[]> => request(user, '/configuration/intake-channels');
export const saveIntakeChannel = (user: User, c: IntakeChannel) => put(user, `/configuration/intake-channels/${c.channel}`, { defaultCategory: c.defaultCategory, defaultQueue: c.defaultQueue, branchCode: c.branchCode, defaultPriority: c.defaultPriority, active: c.active });
export const getRegulatoryProfiles = (user: User): Promise<RegulatoryProfile[]> => request(user, '/configuration/regulatory-profiles');
export const saveRegulatoryProfile = (user: User, p: RegulatoryProfile) => put(user, `/configuration/regulatory-profiles/${p.profileKey}`, { label: p.label, jurisdiction: p.jurisdiction, acknowledgeBusinessDays: p.acknowledgeBusinessDays, finalResponseCalendarDays: p.finalResponseCalendarDays, atRiskDays: p.atRiskDays, active: p.active });
export const getHolidays = (user: User): Promise<Holiday[]> => request(user, '/configuration/holidays');
export const saveHoliday = (user: User, h: Holiday) => put(user, `/configuration/holidays/${h.date}`, { name: h.name });
export const getWorkflows = (user: User): Promise<WorkflowDefinition[]> => request(user, '/configuration/workflows');
export const saveWorkflow = (user: User, w: WorkflowDefinition) => put(user, `/configuration/workflows/${w.workflowKey}`, { label: w.label, active: w.active, transitions: w.transitions });
export const getSlaPolicies = (user: User): Promise<SlaPolicy[]> => request(user, '/configuration/sla');
export const saveSlaPolicy = (user: User, p: SlaPolicy) => put(user, `/configuration/sla/${p.policyKey}/${p.priority}`, { firstResponseMinutes: p.firstResponseMinutes, resolutionMinutes: p.resolutionMinutes, active: p.active, calendar: p.calendar, pauseWhilePendingCustomer: p.pauseWhilePendingCustomer });
export const getBusinessHours = (user: User): Promise<BusinessHours | null> => request(user, '/configuration/business-hours');
export const saveBusinessHours = (user: User, h: BusinessHours) => put(user, '/configuration/business-hours', { timezone: h.timezone, startMinute: h.startMinute, endMinute: h.endMinute, workingDays: h.workingDays });
export const getMessageTemplates = (user: User): Promise<MessageTemplate[]> => request(user, '/configuration/communication-templates/all');
export const saveMessageTemplate = (user: User, t: MessageTemplate) => put(user, `/configuration/communication-templates/${t.templateKey}`, { channel: t.channel, active: t.active, requiresApproval: t.requiresApproval, ...(t.subjectTemplate ? { subjectTemplate: t.subjectTemplate } : {}), ...(t.bodyTemplate ? { bodyTemplate: t.bodyTemplate } : {}) });

// ---------------------------------------------------------------------------
// Operations: the outbox (reliable delivery of integration events)
// ---------------------------------------------------------------------------

export interface OutboxEvent { id: string; eventType: string; aggregateType: string; aggregateId: string; attempts: number; lastError: string | null; createdAt: string; }
export const getOutboxSummary = (user: User): Promise<Record<string, number>> => request(user, '/operations/outbox/summary');
export const getDeadLetters = (user: User): Promise<OutboxEvent[]> => request(user, '/operations/outbox/events?status=dead_letter&limit=100');
export const replayDeadLetter = (user: User, id: string): Promise<{ replayed: number }> => post(user, `/operations/outbox/events/${id}/replay`);
export const replayAllDeadLetters = (user: User): Promise<{ replayed: number }> => post(user, '/operations/outbox/replay');

// ---------------------------------------------------------------------------
// Fixed value lists the API validates against
// ---------------------------------------------------------------------------

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const SENSITIVITIES = ['standard', 'confidential', 'restricted'] as const;
export const REFERENCE_TYPES = ['customer', 'account', 'card', 'loan', 'transaction'] as const;
export const ROOT_CAUSES = ['process_gap', 'system_error', 'staff_error', 'customer_error', 'third_party', 'fraud_or_scam', 'policy_or_product', 'communication', 'other'] as const;
/** Outcome of the internal dispute resolution (IDR) process, required to resolve a complaint. */
export const IDR_OUTCOMES = ['upheld', 'partially_upheld', 'not_upheld', 'withdrawn', 'resolved_by_agreement'] as const;
/** Outcome required to resolve a privacy correction request. */
export const PRIVACY_OUTCOMES = ['corrected', 'corrected_with_statement', 'refused_with_reasons'] as const;
