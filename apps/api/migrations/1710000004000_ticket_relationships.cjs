exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('ticket_relationships', {
    source_ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    target_ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    relationship_type: { type: 'varchar(30)', notNull: true },
    created_by: { type: 'varchar(160)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('ticket_relationships', 'ticket_relationship_pk', { primaryKey: ['source_ticket_id', 'target_ticket_id', 'relationship_type'] });
  pgm.addConstraint('ticket_relationships', 'ticket_relationship_not_self', { check: 'source_ticket_id <> target_ticket_id' });
  pgm.createIndex('ticket_relationships', ['target_ticket_id', 'relationship_type']);
};
exports.down = (pgm) => pgm.dropTable('ticket_relationships');
