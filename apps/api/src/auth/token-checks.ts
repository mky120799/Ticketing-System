import { createHash } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import type { UserContext } from './user-context.js';

const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

/** Tokens must have been issued to one of the applications we expect (the `azp`/`client_id` claim). Off unless AUTH_ALLOWED_CLIENTS is set. */
export function assertAllowedClient(payload: JWTPayload): void {
  const allowed = list(process.env.AUTH_ALLOWED_CLIENTS);
  if (!allowed.length) return;
  const client = typeof payload.azp === 'string' ? payload.azp : typeof payload.client_id === 'string' ? payload.client_id : '';
  if (!allowed.includes(client)) throw new UnauthorizedException('Token was issued to an unrecognised application');
}

interface CacheEntry { value: unknown; expires: number; }
class TtlCache {
  private readonly entries = new Map<string, CacheEntry>();
  constructor(private readonly maxEntries = 5000) {}
  get<T>(key: string): T | undefined { const hit = this.entries.get(key); if (!hit) return undefined; if (hit.expires < Date.now()) { this.entries.delete(key); return undefined; } return hit.value as T; }
  set(key: string, value: unknown, ttlSeconds: number): void { if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string); this.entries.set(key, { value, expires: Date.now() + ttlSeconds * 1000 }); }
}

const introspectionCache = new TtlCache();
/**
 * Optional revocation check (RFC 7662). With AUTH_INTROSPECTION_URL set, a token the identity provider no longer
 * considers active (user disabled, session ended, token revoked) is refused even before it expires. Results are cached
 * briefly (AUTH_INTROSPECTION_CACHE_SECONDS, default 30), so revocation takes effect within that window. If the lookup
 * fails the request is refused unless AUTH_INTROSPECTION_FAIL_OPEN=true.
 */
export async function assertTokenActive(token: string): Promise<void> {
  const url = process.env.AUTH_INTROSPECTION_URL;
  if (!url) return;
  const key = createHash('sha256').update(token).digest('hex');
  const cached = introspectionCache.get<boolean>(key);
  if (cached !== undefined) { if (!cached) throw new UnauthorizedException('Token has been revoked'); return; }
  try {
    const credentials = Buffer.from(`${process.env.AUTH_INTROSPECTION_CLIENT_ID ?? ''}:${process.env.AUTH_INTROSPECTION_CLIENT_SECRET ?? ''}`).toString('base64');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`introspection returned ${response.status}`);
    const active = ((await response.json()) as { active?: boolean }).active === true;
    introspectionCache.set(key, active, Number(process.env.AUTH_INTROSPECTION_CACHE_SECONDS ?? 30));
    if (!active) throw new UnauthorizedException('Token has been revoked');
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    if (process.env.AUTH_INTROSPECTION_FAIL_OPEN !== 'true') throw new UnauthorizedException('Token status could not be verified');
  }
}

export interface EntitlementOverride { roles?: string[]; queues?: string[]; branch?: string; department?: string; legal_entity?: string; country?: string; }
const entitlementCache = new TtlCache(2000);
/**
 * Optional central entitlement lookup. With ENTITLEMENT_URL set, the bank's entitlement service decides the user's
 * roles, queues, branch, department, entity and country, so a change there applies within ENTITLEMENT_CACHE_SECONDS
 * (default 60) instead of at next login. Fields it omits fall back to the token. Fails closed unless ENTITLEMENT_FAIL_OPEN=true.
 */
export async function lookupEntitlements(subject: string): Promise<EntitlementOverride | null> {
  const url = process.env.ENTITLEMENT_URL;
  if (!url) return null;
  const cached = entitlementCache.get<EntitlementOverride>(subject);
  if (cached) return cached;
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}subject=${encodeURIComponent(subject)}`, { headers: process.env.ENTITLEMENT_TOKEN ? { Authorization: `Bearer ${process.env.ENTITLEMENT_TOKEN}` } : {}, signal: AbortSignal.timeout(3000) });
    if (response.status === 404) throw new UnauthorizedException('No entitlements are recorded for this user');
    if (!response.ok) throw new Error(`entitlement service returned ${response.status}`);
    const value = (await response.json()) as EntitlementOverride;
    entitlementCache.set(subject, value, Number(process.env.ENTITLEMENT_CACHE_SECONDS ?? 60));
    return value;
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    if (process.env.ENTITLEMENT_FAIL_OPEN === 'true') return null;
    throw new UnauthorizedException('Entitlements could not be verified');
  }
}

/**
 * Step-up authentication for the most sensitive actions. Enabled when STEP_UP_MAX_AGE_SECONDS (how recent the login must
 * be, from the `auth_time` claim) and/or STEP_UP_ACR_VALUES (accepted `acr` values, for example a multi-factor level)
 * is set. Automated service identities are exempt. The client reacts to the `step_up_required` code by asking the user to sign in again.
 */
export function assertStepUp(user: UserContext, action: string): void {
  if (user.serviceIdentity) return;
  const maxAge = Number(process.env.STEP_UP_MAX_AGE_SECONDS ?? 0); const acrValues = list(process.env.STEP_UP_ACR_VALUES);
  if (!maxAge && !acrValues.length) return;
  const strongEnough = acrValues.length > 0 && user.acr !== undefined && acrValues.includes(user.acr);
  const recentEnough = maxAge > 0 && user.authTime !== undefined && Date.now() / 1000 - user.authTime <= maxAge;
  if (!strongEnough && !recentEnough) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'step_up_required', message: `Please sign in again to ${action}.` });
}
