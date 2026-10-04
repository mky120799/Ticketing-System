exports.shorthands = undefined;
exports.up = (pgm) => {
  // Anchors can carry a digital signature so a copy of the chain head is attributable to the platform's signing key.
  pgm.addColumn('audit_anchors', { signature: { type: 'varchar(200)' }, signed_at: { type: 'varchar(40)' } });

  // When old events are archived out of the live table, the newest archived event becomes the "base" the remaining
  // chain must link to. Without a base, a trail whose start is missing is reported as tampered.
  pgm.createTable('audit_chain_bases', {
    sequence: { type: 'bigint', primaryKey: true },
    event_hash: { type: 'varchar(64)', notNull: true },
    archived_events: { type: 'bigint', notNull: true },
    archive_sha256: { type: 'varchar(64)' },
    archive_location: { type: 'varchar(300)' },
    note: { type: 'varchar(200)' },
    archived_by: { type: 'varchar(160)', notNull: true },
    archived_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
};
exports.down = (pgm) => { pgm.dropTable('audit_chain_bases'); pgm.dropColumns('audit_anchors', ['signature', 'signed_at']); };
