exports.shorthands = undefined;
// Ticket lifecycles as data. A category points at a workflow; the workflow lists the legal status transitions
// and, optionally, which roles may perform each one. Replaces a hard-coded allow-list.
exports.up = (pgm) => {
  pgm.createTable('workflow_definitions', {
    workflow_key: { type: 'varchar(60)', primaryKey: true },
    label: { type: 'varchar(160)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createTable('workflow_transitions', {
    workflow_key: { type: 'varchar(60)', notNull: true, references: 'workflow_definitions', onDelete: 'cascade' },
    from_status: { type: 'varchar(30)', notNull: true },
    to_status: { type: 'varchar(30)', notNull: true },
    allowed_roles: { type: 'text[]' }
  });
  pgm.addConstraint('workflow_transitions', 'workflow_transitions_pk', { primaryKey: ['workflow_key', 'from_status', 'to_status'] });
  pgm.sql(`INSERT INTO workflow_definitions (workflow_key,label,active,updated_by) VALUES ('standard','Standard case lifecycle',true,'system-seed')`);
  pgm.sql(`INSERT INTO workflow_transitions (workflow_key,from_status,to_status,allowed_roles) VALUES
    ('standard','submitted','triage',NULL),
    ('standard','submitted','cancelled',ARRAY['supervisor']),
    ('standard','triage','assigned',NULL),
    ('standard','triage','escalated',NULL),
    ('standard','triage','cancelled',ARRAY['supervisor']),
    ('standard','assigned','in_progress',NULL),
    ('standard','assigned','pending_customer',NULL),
    ('standard','assigned','pending_external',NULL),
    ('standard','assigned','escalated',NULL),
    ('standard','assigned','cancelled',ARRAY['supervisor']),
    ('standard','in_progress','pending_customer',NULL),
    ('standard','in_progress','pending_external',NULL),
    ('standard','in_progress','pending_approval',NULL),
    ('standard','in_progress','escalated',NULL),
    ('standard','in_progress','resolved',NULL),
    ('standard','in_progress','cancelled',ARRAY['supervisor']),
    ('standard','pending_customer','in_progress',NULL),
    ('standard','pending_customer','resolved',NULL),
    ('standard','pending_customer','cancelled',ARRAY['supervisor']),
    ('standard','pending_external','in_progress',NULL),
    ('standard','pending_external','resolved',NULL),
    ('standard','pending_external','escalated',NULL),
    ('standard','pending_approval','in_progress',NULL),
    ('standard','pending_approval','resolved',NULL),
    ('standard','pending_approval','escalated',NULL),
    ('standard','escalated','assigned',NULL),
    ('standard','escalated','in_progress',NULL),
    ('standard','escalated','cancelled',ARRAY['supervisor']),
    ('standard','resolved','closed',NULL),
    ('standard','resolved','reopened',NULL),
    ('standard','closed','reopened',NULL),
    ('standard','reopened','in_progress',NULL)`);
  pgm.addColumn('ticket_categories', { workflow_key: { type: 'varchar(60)', notNull: true, default: 'standard', references: 'workflow_definitions', onDelete: 'restrict' } });
};
exports.down = (pgm) => { pgm.dropColumn('ticket_categories', 'workflow_key'); pgm.dropTable('workflow_transitions'); pgm.dropTable('workflow_definitions'); };
