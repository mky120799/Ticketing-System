exports.shorthands = undefined;
exports.up = (pgm) => {
  // hash_version 1 = original events (timestamp not hashed; metadata key order not recoverable, so link-checked only).
  // hash_version 2 = canonical JSON including id and timestamp, fully re-computable by the verifier.
  pgm.addColumn('audit_events', { hash_version: { type: 'smallint', notNull: true, default: 1 } });
  pgm.createIndex('audit_events', ['actor_id', 'sequence']);
  pgm.createIndex('audit_events', ['action', 'sequence']);
  pgm.createIndex('audit_events', ['occurred_at']);

  // Result of every verification run; the next run resumes from the last valid one.
  pgm.createTable('audit_verifications', {
    id: { type: 'bigserial', primaryKey: true },
    status: { type: 'varchar(10)', notNull: true },
    verified_through_sequence: { type: 'bigint', notNull: true },
    head_hash: { type: 'varchar(64)' },
    events_checked: { type: 'bigint', notNull: true, default: 0 },
    legacy_events: { type: 'bigint', notNull: true, default: 0 },
    failure_sequence: { type: 'bigint' },
    failure_reason: { type: 'varchar(300)' },
    verified_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('audit_verifications', 'audit_verifications_status_chk', { check: "status IN ('valid','invalid')" });

  // Copies of the chain head published outside the database. Truncating the tail of the chain is only detectable
  // against a copy that the database owner cannot rewrite.
  pgm.createTable('audit_anchors', {
    id: { type: 'bigserial', primaryKey: true },
    sequence: { type: 'bigint', notNull: true, unique: true },
    head_hash: { type: 'varchar(64)', notNull: true },
    object_key: { type: 'varchar(200)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
};
exports.down = (pgm) => {
  pgm.dropTable('audit_anchors'); pgm.dropTable('audit_verifications');
  pgm.dropIndex('audit_events', ['occurred_at']); pgm.dropIndex('audit_events', ['action', 'sequence']); pgm.dropIndex('audit_events', ['actor_id', 'sequence']);
  pgm.dropColumn('audit_events', 'hash_version');
};
