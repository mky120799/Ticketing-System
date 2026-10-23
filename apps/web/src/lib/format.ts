/**
 * Small display helpers shared by every screen, so dates, sizes and codes look the same everywhere.
 */

/** "first_response_overdue" → "First response overdue". The API speaks in codes; people read sentences. */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const words = code.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Absolute date and time in the viewer's locale, or a dash when there is no value. */
export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

/**
 * "in 3 hours", "2 days ago". Used for due dates and ages in lists, where "how long" matters more than the exact
 * time. Screens show the exact time in a tooltip next to it.
 */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const seconds = (new Date(value).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return relative.format(Math.round(seconds), 'second');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The human-friendly case reference the customer sees (same rule as the API's `ticketReference`). */
export const caseReference = (ticketId: string): string => `CASE-${ticketId.slice(0, 8).toUpperCase()}`;

/** Turns an Error (or anything thrown) into a message fit for a toast. */
export const errorMessage = (error: unknown, fallback = 'Something went wrong'): string => (error instanceof Error && error.message ? error.message : fallback);
