import { Logger } from '@nestjs/common';

export const CONTACT_RESOLVER = Symbol('CONTACT_RESOLVER');

/**
 * Turns an opaque customer reference into a delivery address. The platform deliberately does not keep customer contact
 * data; the bank's CRM owns it. Production points CRM_CONTACT_URL at a bank-controlled lookup; development can treat the
 * reference itself as the address (ALLOW_DIRECT_ADDRESS_REFERENCES=true).
 */
export interface ContactResolver {
  resolveEmail(reference: string): Promise<string | null>;
  resolveMobile(reference: string): Promise<string | null>;
}

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/;
const MOBILE = /^\+?[0-9]{8,15}$/;

/** `mailto:` references are created by the email intake for the address a customer wrote from, so replying to it is always safe. */
const fromMailto = (reference: string): string | null => (reference.startsWith('mailto:') && EMAIL.test(reference.slice(7)) ? reference.slice(7) : null);

export class DirectAddressResolver implements ContactResolver {
  private readonly allowed = process.env.ALLOW_DIRECT_ADDRESS_REFERENCES === 'true';
  async resolveEmail(reference: string): Promise<string | null> { return fromMailto(reference) ?? (this.allowed && EMAIL.test(reference) ? reference : null); }
  async resolveMobile(reference: string): Promise<string | null> { return this.allowed && MOBILE.test(reference) ? reference : null; }
}

/** Calls GET {CRM_CONTACT_URL}?reference=... expecting {"email": "...", "mobile": "..."}; a bank-side adapter can sit in front of any CRM. */
export class HttpContactResolver implements ContactResolver {
  private readonly logger = new Logger('ContactResolver');
  constructor(private readonly url: string, private readonly token?: string) {}
  private async lookup(reference: string): Promise<{ email?: string; mobile?: string }> {
    const response = await fetch(`${this.url}${this.url.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return {};
    if (!response.ok) { this.logger.warn(`Contact lookup failed with status ${response.status}`); throw new Error('contact lookup failed'); }
    return (await response.json()) as { email?: string; mobile?: string };
  }
  async resolveEmail(reference: string): Promise<string | null> { const direct = fromMailto(reference); if (direct) return direct; const found = (await this.lookup(reference)).email; return found && EMAIL.test(found) ? found : null; }
  async resolveMobile(reference: string): Promise<string | null> { const found = (await this.lookup(reference)).mobile; return found && MOBILE.test(found) ? found : null; }
}

export function createContactResolver(): ContactResolver {
  return process.env.CRM_CONTACT_URL ? new HttpContactResolver(process.env.CRM_CONTACT_URL, process.env.CRM_CONTACT_TOKEN) : new DirectAddressResolver();
}
