// Generates docs/events.md from the source: every event the platform publishes through the outbox, with its aggregate type
// and payload fields. Run after adding or changing an event:  node scripts/generate-event-catalogue.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = []; const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') && files.push(path); } };
walk(root);

// Events whose type is computed from a variable; listed explicitly so the catalogue is complete.
const DYNAMIC = { 'approval.${dto.decision}': ['approval.approved', 'approval.rejected'], 'customer_communication.${communicationStatus}': ['customer_communication.queued', 'customer_communication.rejected'] };
const events = new Map();
const add = (type, aggregate, fields, file) => { const e = events.get(type) ?? { aggregate, fields: new Set(), files: new Set() }; fields.forEach((f) => e.fields.add(f)); e.files.add(file.replace(root, 'src/')); events.set(type, e); };

/** Returns the text between the brace at `open` and its matching close, skipping strings and template literals. */
function balanced(text, open) {
  let depth = 0; let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}
/** Top-level property names of an object literal body (shorthand, `key: value`, and spreads are ignored). */
function topLevelKeys(body) {
  const keys = []; let depth = 0; let quote = null; let token = '';
  const flush = (terminator) => { const t = token.trim(); token = ''; const m = /^(\w+)$/.exec(t) ?? /^(\w+)\s*:/.exec(t); if (m && (terminator === ',' || terminator === ':' || terminator === 'end')) keys.push(m[1]); };
  let atKey = true;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { token += c; if (c === '\\') token += body[++i] ?? ''; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; token += c; continue; }
    if ('{[('.includes(c)) { depth++; token += c; continue; }
    if ('}])'.includes(c)) { depth--; token += c; continue; }
    if (depth === 0 && c === ':' && atKey) { flush(':'); atKey = false; continue; }
    if (depth === 0 && c === ',') { if (atKey) flush(','); token = ''; atKey = true; continue; }
    if (atKey) token += c;
  }
  if (atKey) flush('end');
  return keys;
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/enqueue\(client, \{/g)) {
    const open = match.index + match[0].length - 1; const body = balanced(text, open);
    const type = /eventType(?::\s*(?:'([^']+)'|`([^`]+)`)|\s*[,}])/.exec(body); if (!type) continue;
    const aggregate = /aggregateType:\s*'([^']+)'/.exec(body)?.[1] ?? 'unknown';
    const payloadAt = body.search(/payload:\s*\{/); const fields = payloadAt === -1 ? [] : topLevelKeys(balanced(body, body.indexOf('{', payloadAt)));
    const literal = type[1] ?? type[2];
    if (literal && !literal.includes('${')) add(literal, aggregate, fields, file);
    else if (literal && DYNAMIC[literal]) DYNAMIC[literal].forEach((t) => add(t, aggregate, fields, file));
  }
}
// The communication events pick their type from a variable.
add('customer_communication.queued', 'communication', ['communicationId', 'ticketId', 'channel', 'templateKey', 'status'], 'src/tickets/tickets.service.ts');
add('customer_communication.pending_approval', 'communication', ['communicationId', 'ticketId', 'channel', 'templateKey', 'status'], 'src/tickets/tickets.service.ts');

// Events whose payload is built from a variable or whose type is computed.
add('configuration.regulatory_profile_changed', 'regulatory_profile', ['profileKey', 'jurisdiction', 'acknowledgeBusinessDays', 'finalResponseCalendarDays', 'atRiskDays', 'active'], 'src/compliance/compliance.service.ts');
add('configuration.queue_member_changed', 'queue_member', ['queue', 'userId', 'active', 'previous'], 'src/configuration/routing.service.ts');
add('configuration.assignment_rule_changed', 'assignment_rule', ['ruleKey', 'queue', 'category', 'priority', 'strategy', 'sortOrder', 'active', 'previous'], 'src/configuration/routing.service.ts');
add('configuration.escalation_rule_changed', 'escalation_rule', ['ruleKey', 'queue', 'trigger', 'escalateToQueue', 'raisePriority', 'active', 'previous'], 'src/configuration/routing.service.ts');
add('configuration.intake_channel_changed', 'intake_channel', ['channel', 'defaultCategory', 'defaultQueue', 'branchCode', 'defaultPriority', 'active', 'previous'], 'src/configuration/routing.service.ts');

const rows = [...events.entries()].sort(([a], [b]) => a.localeCompare(b));
const out = `# Event catalogue

Generated by \`apps/api/scripts/generate-event-catalogue.mjs\`. Do not edit by hand.

Every business change writes one or more events to the transactional outbox in the same database transaction. The dispatcher publishes
them (at least once) to the configured bus. Topic: \`<KAFKA_TOPIC_PREFIX>.<aggregate type>\` (default prefix \`bank-case\`); message key: the aggregate ID,
so all events for one ticket stay in order on one partition.

## Envelope (every message)

\`\`\`json
{
  "eventId": "uuid, unique per event - use it to de-duplicate (delivery is at-least-once)",
  "eventType": "ticket.status_changed",
  "aggregateType": "ticket",
  "aggregateId": "uuid or key of the thing that changed",
  "correlationId": "ties the event to the request and audit records that caused it",
  "occurredAt": "ISO 8601 time the event was recorded",
  "payload": { "...": "see the table; IDs and classifications only" }
}
\`\`\`

Headers: \`event-id\`, \`event-type\`, \`correlation-id\`. Events are **notifications**: they contain opaque IDs and classifications, never customer content, free text or contact details. To learn more, call the API (the consumer needs its own authorization). Ordering is guaranteed per aggregate only on the happy path; a retried event can arrive after a later one, so compare \`occurredAt\` or re-read current state.

## Events (${rows.length})

| Event type | Aggregate (topic suffix) | Payload fields | Raised in |
|---|---|---|---|
${rows.map(([type, e]) => `| \`${type}\` | ${e.aggregate} | ${[...e.fields].map((f) => `\`${f}\``).join(', ') || '-'} | ${[...e.files].join(', ')} |`).join('\n')}

## Audit events (optional stream)

With \`AUDIT_STREAM_ENABLED=true\` every audit record is also published as \`audit.event\` (topic \`<prefix>.audit\`) with: \`eventId\`, \`occurredAt\`, \`actorId\`, \`action\`, \`targetType\`, \`targetId\`, \`outcome\`, \`eventHash\`, \`previousHash\`, \`hashVersion\`, and \`metadata\` only if \`AUDIT_STREAM_INCLUDE_METADATA=true\`.

## Compatibility

Add fields freely; consumers must ignore fields they do not know. A field is never repurposed. An event type that must change incompatibly gets a new name, and the old one is published in parallel for a deprecation period.
`;
writeFileSync(fileURLToPath(new URL('../../../docs/events.md', import.meta.url)), out);
console.log(`Wrote ${rows.length} events to docs/events.md`);
