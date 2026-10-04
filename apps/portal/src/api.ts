import type { User } from 'oidc-client-ts';
import { signOut } from './auth';
import { config } from './config';

export interface RequestSummary { id: string; reference: string; subject: string; status: string; createdAt: string; updatedAt: string; isComplaint: boolean; kind?: 'request' | 'complaint' | 'correction'; complaint?: { acknowledged: boolean; finalResponseDueBy: string | null }; }
export interface Update { from: 'you' | 'bank'; title?: string; text: string; at: string; }
export interface RequestDetail extends RequestSummary { description: string; updates: Update[]; }

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
