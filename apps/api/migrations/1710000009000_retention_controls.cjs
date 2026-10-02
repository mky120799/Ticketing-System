exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('ticket_retention_controls', {
    ticket_id: { type: 'uuid', primaryKey: true, references: 'tickets', onDelete: 'restrict' },
    retention_until: { type: 'timestamptz' },
    legal_hold: { type: 'boolean', notNull: true, default: false },
    hold_reason: { type: 'varchar(500)' },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
};
exports.down = (pgm) => { pgm.dropTable('ticket_retention_controls'); };
