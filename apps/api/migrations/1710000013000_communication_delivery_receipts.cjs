exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('communication_delivery_receipts', {
    id: { type: 'uuid', primaryKey: true },
    communication_id: { type: 'uuid', notNull: true, references: 'ticket_communications', onDelete: 'cascade' },
    provider: { type: 'varchar(80)', notNull: true },
    provider_message_id: { type: 'varchar(160)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    failure_code: { type: 'varchar(80)' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    received_by: { type: 'varchar(160)', notNull: true },
    received_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('communication_delivery_receipts', 'communication_delivery_receipts_status_check', { check: "status IN ('sent','delivered','failed')" });
  pgm.addConstraint('communication_delivery_receipts', 'communication_delivery_receipts_idempotency_key', { unique: ['communication_id', 'provider', 'provider_message_id', 'status'] });
  pgm.createIndex('communication_delivery_receipts', ['communication_id', 'occurred_at']);
};
exports.down = (pgm) => { pgm.dropTable('communication_delivery_receipts'); };
