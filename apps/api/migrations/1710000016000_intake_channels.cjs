exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.addColumn('tickets', { source_channel: { type: 'varchar(20)', notNull: true, default: 'staff' } });

  // Per-channel defaults for tickets that arrive without a staff member (email, portal, mobile, phone, internal).
  pgm.createTable('intake_channels', {
    channel_key: { type: 'varchar(20)', primaryKey: true },
    default_category: { type: 'varchar(80)', notNull: true, references: 'ticket_categories', onDelete: 'restrict' },
    default_queue: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'restrict' },
    branch_code: { type: 'varchar(30)', notNull: true },
    default_priority: { type: 'varchar(20)', notNull: true, default: 'normal' },
    active: { type: 'boolean', notNull: true, default: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('intake_channels', 'intake_channels_key_chk', { check: "channel_key IN ('email','portal','mobile','phone','internal')" });

  // Source-message ledger: the (channel, message_id) key makes redelivery of the same message a no-op.
  pgm.createTable('intake_messages', {
    channel: { type: 'varchar(20)', notNull: true },
    message_id: { type: 'varchar(200)', notNull: true },
    request_hash: { type: 'varchar(64)', notNull: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('intake_messages', 'intake_messages_pk', { primaryKey: ['channel', 'message_id'] });
};
exports.down = (pgm) => { pgm.dropTable('intake_messages'); pgm.dropTable('intake_channels'); pgm.dropColumn('tickets', 'source_channel'); };
