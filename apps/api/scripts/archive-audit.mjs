// Run by the database OWNER account (not the application): archives old audit events and keeps the chain verifiable.
//   MIGRATION_DATABASE_URL=postgresql://case_owner:...@host/db node scripts/archive-audit.mjs --through 100000 --out /secure/archive
//   ... --accept-start     records the existing first event as the trusted start (use only after a human decision)
// Store the .jsonl file and its .manifest.json in write-once storage, and review the output before deleting any copy.
import { acceptExistingStart, archiveAuditEvents } from '../dist/audit/audit-archive.js';
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('Set MIGRATION_DATABASE_URL to the owner account'); process.exit(1); }
const archivedBy = process.env.ARCHIVED_BY ?? process.env.USER ?? 'unknown-operator';
try {
  if (process.argv.includes('--accept-start')) console.log('Accepted start at sequence', (await acceptExistingStart({ connectionString: url, archivedBy })).sequence);
  else {
    const through = Number(arg('--through')); const out = arg('--out');
    if (!Number.isInteger(through) || !out) { console.error('Usage: --through <sequence> --out <directory>'); process.exit(1); }
    console.log(await archiveAuditEvents({ connectionString: url, throughSequence: through, outDir: out, archivedBy, note: arg('--note') }));
  }
} catch (error) { console.error('Failed:', error.message); process.exit(1); }
