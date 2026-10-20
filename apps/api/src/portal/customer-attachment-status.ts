/** What a customer is told about a file they sent. Scan results are never described: a rejected file just says it was not accepted. */
export function customerAttachmentStatus(malwareStatus: string): 'being_checked' | 'received' | 'not_accepted' {
  return malwareStatus === 'clean' ? 'received' : malwareStatus === 'pending_scan' ? 'being_checked' : 'not_accepted';
}
