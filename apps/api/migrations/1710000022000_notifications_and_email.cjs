exports.shorthands = undefined;
exports.up = (pgm) => {
  // Template content. Placeholders: {{ticketRef}} {{status}}. No customer data is ever stored in a template.
  pgm.addColumns('communication_templates', { subject_template: { type: 'varchar(200)' }, body_template: { type: 'text' } });
  pgm.sql(`UPDATE communication_templates SET subject_template='We have received your request [{{ticketRef}}]', body_template='Thank you for contacting us. We have received your request and your reference is {{ticketRef}}.\n\nPlease keep the reference in the subject line if you reply, so we can match your message to your request.\n\nWe will be in touch with an update.' WHERE template_key='ticket_acknowledgement'`);
  pgm.sql(`UPDATE communication_templates SET subject_template='Your request has been resolved [{{ticketRef}}]', body_template='We have finished reviewing your request {{ticketRef}} and have recorded it as resolved.\n\nIf you are not satisfied with the outcome, reply to this message and quote the reference so we can look at it again.' WHERE template_key='resolution_notice'`);
  pgm.sql(`UPDATE communication_templates SET subject_template='Update on your request', body_template='Your request {{ticketRef}} is now: {{status}}.' WHERE template_key='ticket_status_sms'`);
  pgm.sql(`UPDATE communication_templates SET subject_template='Update on your request [{{ticketRef}}]', body_template='There is an update on your request {{ticketRef}}. Its status is now: {{status}}.' WHERE template_key='portal_update'`);

  // Delivery bookkeeping for the sender workers (retry with backoff, then fail).
  pgm.addColumns('ticket_communications', { delivery_attempts: { type: 'integer', notNull: true, default: 0 }, next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }, last_error: { type: 'varchar(200)' } });
  pgm.createIndex('ticket_communications', ['next_attempt_at'], { where: "status = 'queued'", name: 'ticket_communications_due_idx' });

  // Staff notification inbox. A notification targets one person, or everyone holding a role in a queue
  // (for example supervisors of the payments queue). Read state is per person.
  pgm.createTable('notifications', {
    id: { type: 'uuid', primaryKey: true },
    recipient_user: { type: 'varchar(160)' },
    recipient_queue: { type: 'varchar(80)' },
    audience_role: { type: 'varchar(40)' },
    legal_entity: { type: 'varchar(50)' },
    country: { type: 'varchar(2)' },
    type: { type: 'varchar(40)', notNull: true },
    ticket_id: { type: 'uuid', references: 'tickets', onDelete: 'cascade' },
    title: { type: 'varchar(160)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('notifications', 'notifications_target_chk', { check: 'recipient_user IS NOT NULL OR (recipient_queue IS NOT NULL AND audience_role IS NOT NULL)' });
  pgm.createIndex('notifications', ['recipient_user', 'created_at']);
  pgm.createIndex('notifications', ['recipient_queue', 'audience_role', 'created_at']);
  pgm.createTable('notification_reads', {
    notification_id: { type: 'uuid', notNull: true, references: 'notifications', onDelete: 'cascade' },
    user_id: { type: 'varchar(160)', notNull: true },
    read_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('notification_reads', 'notification_reads_pk', { primaryKey: ['notification_id', 'user_id'] });
};
exports.down = (pgm) => {
  pgm.dropTable('notification_reads'); pgm.dropTable('notifications');
  pgm.dropIndex('ticket_communications', ['next_attempt_at'], { name: 'ticket_communications_due_idx' });
  pgm.dropColumns('ticket_communications', ['delivery_attempts', 'next_attempt_at', 'last_error']);
  pgm.dropColumns('communication_templates', ['subject_template', 'body_template']);
};
