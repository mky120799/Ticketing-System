import type { User } from 'oidc-client-ts';
import { signOut } from './auth';
import { config } from './config';

export interface RequestSummary { id: string; reference: string; subject: string; status: string; createdAt: string; updatedAt: string; isComplaint: boolean; kind?: 'request' | 'complaint' | 'correction'; complaint?: { acknowledged: boolean; finalResponseDueBy: string | null }; }
export interface Update { from: 'you' | 'bank'; title?: string; text: string; at: string; }
export interface PortalAttachment { id: string; filename: string; status: 'being_checked' | 'received' | 'not_accepted'; at: string; }
export interface RequestDetail extends RequestSummary { description: string; updates: Update[]; attachments: PortalAttachment[]; }

export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

async function call<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.access_token}`, ...init?.headers } });
  if (response.status === 401) { void signOut(); throw new Error('Your session has ended. Please sign in again.'); }
  if (!response.ok) { const body: { message?: string | string[] } = await response.json().catch(() => ({})); throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message ?? 'Something went wrong. Please try again.'); }
  return response.json() as Promise<T>;
}
export const listRequests = (user: User) => call<RequestSummary[]>(user, '/portal/requests');
export const getRequest = (user: User, id: string) => call<RequestDetail>(user, `/portal/requests/${id}`);
export const createRequest = (user: User, body: { kind: 'request' | 'complaint' | 'correction'; subject: string; description: string }, key: string) => call<{ id: string; reference: string }>(user, '/portal/requests', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
export const sendMessage = (user: User, id: string, body: string) => call<{ ok: boolean }>(user, `/portal/requests/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });

/** Declare the file, send the bytes straight to secure storage, then confirm with a checksum so the bank can check it arrived intact. */
export async function sendDocument(user: User, id: string, file: File): Promise<void> {
  const intent = await call<{ id: string; uploadUrl: string }>(user, `/portal/requests/${id}/attachments`, { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }) });
  const bytes = await file.arrayBuffer();
  const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: bytes });
  if (!put.ok) throw new Error('The document could not be sent. Please try again.');
  const checksumSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
  await call(user, `/portal/requests/${id}/attachments/${intent.id}/complete`, { method: 'POST', body: JSON.stringify({ checksumSha256, sizeBytes: file.size }) });
}

/** The secure-link page: no sign-in, the link's token is the only credential and is sent in a header, never in a URL. */
export interface LinkStatus { reference: string; expiresAt: string; remaining: number; documents: { id: string; filename: string; status: 'being_checked' | 'received' | 'not_accepted' }[]; }
async function callLink<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Upload-Token': token, ...init?.headers } });
  if (!response.ok) { const body: { message?: string | string[] } = await response.json().catch(() => ({})); throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message ?? 'Something went wrong. Please try again.'); }
  return response.json() as Promise<T>;
}
export const linkStatus = (token: string) => callLink<LinkStatus>(token, '/upload/status');
export async function sendDocumentByLink(token: string, file: File): Promise<void> {
  const intent = await callLink<{ id: string; uploadUrl: string }>(token, '/upload/attachments', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }) });
  const bytes = await file.arrayBuffer();
  const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: bytes });
  if (!put.ok) throw new Error('The document could not be sent. Please try again.');
  const checksumSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
  await callLink(token, `/upload/attachments/${intent.id}/complete`, { method: 'POST', body: JSON.stringify({ checksumSha256, sizeBytes: file.size }) });
}
