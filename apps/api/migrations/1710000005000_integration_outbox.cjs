exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('integration_outbox', {
    id: { type: 'uuid', primaryKey: true },
    event_type: { type: 'varchar(100)', notNull: true },
    aggregate_type: { type: 'varchar(60)', notNull: true },
    aggregate_id: { type: 'varchar(160)', notNull: true },
    correlation_id: { type: 'varchar(128)', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_error: { type: 'varchar(500)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    published_at: { type: 'timestamptz' }
  });
  pgm.createIndex('integration_outbox', ['status', 'next_attempt_at']);
  pgm.createIndex('integration_outbox', ['aggregate_type', 'aggregate_id']);
};
exports.down = (pgm) => pgm.dropTable('integration_outbox');
