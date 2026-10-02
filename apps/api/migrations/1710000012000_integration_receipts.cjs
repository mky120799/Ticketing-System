exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('integration_receipts', {
    id: { type: 'uuid', primaryKey: true },
    outbox_event_id: { type: 'uuid', notNull: true, references: 'integration_outbox', onDelete: 'restrict' },
    external_system: { type: 'varchar(80)', notNull: true },
    external_reference: { type: 'varchar(160)', notNull: true },
    outcome: { type: 'varchar(20)', notNull: true },
    payload_hash: { type: 'varchar(64)' },
    observed_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    received_by: { type: 'varchar(160)', notNull: true }
  });
  pgm.addConstraint('integration_receipts', 'integration_receipt_outcome', { check: "outcome IN ('accepted','rejected')" });
  pgm.addConstraint('integration_receipts', 'integration_receipt_unique', { unique: ['outbox_event_id', 'external_system'] });
};
exports.down = (pgm) => { pgm.dropTable('integration_receipts'); };
