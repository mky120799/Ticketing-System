exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('ticket_notes', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    visibility: { type: 'varchar(20)', notNull: true },
    body: { type: 'text', notNull: true },
    author_id: { type: 'varchar(160)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createIndex('ticket_notes', ['ticket_id', 'created_at']);
  pgm.createTable('ticket_status_history', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    from_status: { type: 'varchar(30)', notNull: true },
    to_status: { type: 'varchar(30)', notNull: true },
    reason: { type: 'varchar(500)', notNull: true },
    changed_by: { type: 'varchar(160)', notNull: true },
    changed_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createIndex('ticket_status_history', ['ticket_id', 'changed_at']);
};
exports.down = (pgm) => { pgm.dropTable('ticket_status_history'); pgm.dropTable('ticket_notes'); };
