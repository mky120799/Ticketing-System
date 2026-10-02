exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('attachments', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    object_key: { type: 'varchar(300)', notNull: true, unique: true },
    original_filename: { type: 'varchar(255)', notNull: true },
    content_type: { type: 'varchar(120)', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    classification: { type: 'varchar(20)', notNull: true },
    upload_status: { type: 'varchar(30)', notNull: true, default: 'pending_upload' },
    malware_status: { type: 'varchar(30)', notNull: true, default: 'pending_scan' },
    checksum_sha256: { type: 'varchar(64)' },
    uploaded_by: { type: 'varchar(160)', notNull: true },
    retention_until: { type: 'timestamptz' },
    legal_hold: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createIndex('attachments', ['ticket_id', 'created_at']);
};
exports.down = (pgm) => pgm.dropTable('attachments');
