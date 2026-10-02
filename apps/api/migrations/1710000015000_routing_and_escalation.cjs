exports.shorthands = undefined;
const stamp = (pgm) => ({ updated_by: { type: 'varchar(160)', notNull: true }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') } });

exports.up = (pgm) => {
  // Who may be auto-assigned work in a queue. user_id is the IdP subject claim.
  pgm.createTable('queue_members', {
    queue_key: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'cascade' },
    user_id: { type: 'varchar(160)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    last_assigned_at: { type: 'timestamptz' },
    ...stamp(pgm)
  });
  pgm.addConstraint('queue_members', 'queue_members_pk', { primaryKey: ['queue_key', 'user_id'] });

  // First matching active rule picks the strategy for new tickets in a queue; more specific rules win.
  pgm.createTable('assignment_rules', {
    rule_key: { type: 'varchar(80)', primaryKey: true },
    queue_key: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'cascade' },
    category: { type: 'varchar(80)' },
    priority: { type: 'varchar(20)' },
    strategy: { type: 'varchar(20)', notNull: true },
    sort_order: { type: 'integer', notNull: true, default: 100 },
    active: { type: 'boolean', notNull: true, default: true },
    ...stamp(pgm)
  });
  pgm.addConstraint('assignment_rules', 'assignment_rules_strategy_chk', { check: "strategy IN ('least_loaded','round_robin')" });
  pgm.createIndex('assignment_rules', ['queue_key', 'active']);

  // When an SLA trigger fires for a ticket in queue_key, move it to escalate_to_queue.
  pgm.createTable('escalation_rules', {
    rule_key: { type: 'varchar(80)', primaryKey: true },
    queue_key: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'cascade' },
    trigger: { type: 'varchar(30)', notNull: true },
    escalate_to_queue: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'restrict' },
    raise_priority: { type: 'boolean', notNull: true, default: false },
    active: { type: 'boolean', notNull: true, default: true },
    ...stamp(pgm)
  });
  pgm.addConstraint('escalation_rules', 'escalation_rules_trigger_chk', { check: "trigger IN ('first_response_overdue','breached')" });
  pgm.addConstraint('escalation_rules', 'escalation_rules_distinct_queues_chk', { check: 'queue_key <> escalate_to_queue' });

  // One row per (ticket, rule): the unique key is what makes escalation idempotent across timer ticks and instances.
  pgm.createTable('ticket_escalations', {
    id: { type: 'uuid', primaryKey: true },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets', onDelete: 'restrict' },
    rule_key: { type: 'varchar(80)', notNull: true },
    trigger: { type: 'varchar(30)', notNull: true },
    from_queue: { type: 'varchar(80)', notNull: true },
    to_queue: { type: 'varchar(80)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('ticket_escalations', 'ticket_escalations_ticket_rule_uq', { unique: ['ticket_id', 'rule_key'] });
};

exports.down = (pgm) => ['ticket_escalations', 'escalation_rules', 'assignment_rules', 'queue_members'].forEach((table) => pgm.dropTable(table));
