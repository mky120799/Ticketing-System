export const ticketReference = (ticketId: string): string => `CASE-${ticketId.slice(0, 8).toUpperCase()}`;

/** Customer-friendly wording; internal workflow states are never exposed. */
export function friendlyStatus(status: string): string {
  switch (status) {
    case 'submitted': return 'received';
    case 'pending_customer': return 'waiting for your reply';
    case 'resolved': return 'resolved';
    case 'closed': return 'closed';
    case 'cancelled': return 'cancelled';
    default: return 'being worked on';
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only these placeholders exist, so a template can never pull in anything else from the case. */
export function renderMessage(subjectTemplate: string, bodyTemplate: string, ticketId: string, status: string): { subject: string; text: string; html: string } {
  const vars: Record<string, string> = { ticketRef: ticketReference(ticketId), status: friendlyStatus(status) };
  const fill = (template: string) => template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '');
  const text = fill(bodyTemplate);
  return { subject: fill(subjectTemplate).replace(/[\r\n]+/g, ' ').slice(0, 200), text, html: `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>` };
}
