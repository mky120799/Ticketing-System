exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('sla_policies', {
    policy_key: { type: 'varchar(80)', notNull: true },
    priority: { type: 'varchar(20)', notNull: true },
    first_response_minutes: { type: 'integer', notNull: true },
    resolution_minutes: { type: 'integer', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('sla_policies', 'sla_policy_key_priority', { primaryKey: ['policy_key', 'priority'] });
  pgm.sql(`INSERT INTO sla_policies (policy_key, priority, first_response_minutes, resolution_minutes, updated_by) VALUES
    ('default','low',1440,10080,'system-seed'), ('default','normal',480,2880,'system-seed'), ('default','high',120,1440,'system-seed'), ('default','critical',30,240,'system-seed')`);
  pgm.addColumn('tickets', {
    sla_policy_key: { type: 'varchar(80)', notNull: false },
    first_response_due_at: { type: 'timestamptz', notNull: false },
    resolution_due_at: { type: 'timestamptz', notNull: false },
    sla_status: { type: 'varchar(20)', notNull: false, default: 'running' }
  });
  pgm.createIndex('tickets', ['sla_status', 'resolution_due_at']);
};
exports.down = (pgm) => { pgm.dropColumn('tickets', ['sla_policy_key', 'first_response_due_at', 'resolution_due_at', 'sla_status']); pgm.dropTable('sla_policies'); };
