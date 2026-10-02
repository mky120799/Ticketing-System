exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('communication_templates', {
    template_key: { type: 'varchar(100)', primaryKey: true },
    channel: { type: 'varchar(20)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    requires_approval: { type: 'boolean', notNull: true, default: false },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createTable('ticket_communications', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    channel: { type: 'varchar(20)', notNull: true },
    template_key: { type: 'varchar(100)', notNull: true, references: 'communication_templates', onDelete: 'restrict' },
    recipient_reference: { type: 'varchar(255)', notNull: true },
    recipient_masked: { type: 'varchar(255)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'queued' },
    created_by: { type: 'varchar(160)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createIndex('ticket_communications', ['ticket_id', 'created_at']);
  pgm.sql(`INSERT INTO communication_templates (template_key,channel,requires_approval,updated_by) VALUES
    ('ticket_acknowledgement','email',false,'system-seed'), ('resolution_notice','email',true,'system-seed'), ('ticket_status_sms','sms',false,'system-seed'), ('portal_update','portal',false,'system-seed')`);
};
exports.down = (pgm) => { pgm.dropTable('ticket_communications'); pgm.dropTable('communication_templates'); };
