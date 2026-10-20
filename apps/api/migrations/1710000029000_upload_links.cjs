exports.shorthands = undefined;
// A secure link a customer can use to send documents for one request without signing in (for example, a caller who has no
// portal account). The link itself is not stored: it is derived from the link's ID with a server secret, so a database leak
// does not reveal usable links. A link works for one ticket, until it expires, for a limited number of files.
exports.up = (pgm) => {
  pgm.createTable('upload_links', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    communication_id: { type: 'uuid', references: 'ticket_communications', onDelete: 'restrict' },
    created_by: { type: 'varchar(160)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    expires_at: { type: 'timestamptz', notNull: true },
    max_files: { type: 'integer', notNull: true, default: 5 },
    revoked_at: { type: 'timestamptz' },
    revoked_by: { type: 'varchar(160)' }
  });
  pgm.createIndex('upload_links', ['ticket_id']);
  pgm.createIndex('upload_links', ['communication_id']);
  pgm.addColumn('attachments', { upload_link_id: { type: 'uuid', references: 'upload_links', onDelete: 'restrict' } });
  pgm.sql(`INSERT INTO communication_templates (template_key,channel,requires_approval,subject_template,body_template,updated_by) VALUES
    ('document_request_email','email',false,'Please send us your documents [{{ticketRef}}]','To help us with your request {{ticketRef}}, please send the documents we asked about using this secure link:\n\n{{uploadLink}}\n\nThe link works only for this request and only for a limited time. We will never ask you for your PIN or password.\n\nIf you did not expect this message, please ignore it.','system-seed'),
    ('document_request_sms','sms',false,'Documents for your request','Please send the documents for {{ticketRef}} using this secure link: {{uploadLink}} (we never ask for your PIN or password)','system-seed')
    ON CONFLICT (template_key) DO NOTHING`);
};
exports.down = (pgm) => {
  pgm.dropColumn('attachments', 'upload_link_id');
  pgm.dropTable('upload_links');
  pgm.sql("DELETE FROM ticket_communications WHERE template_key IN ('document_request_email','document_request_sms')");
  pgm.sql("DELETE FROM communication_templates WHERE template_key IN ('document_request_email','document_request_sms')");
};
