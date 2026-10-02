exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('case_queues', {
    queue_key: { type: 'varchar(80)', primaryKey: true },
    department: { type: 'varchar(80)', notNull: true },
    legal_entity: { type: 'varchar(50)', notNull: true },
    country: { type: 'varchar(2)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createTable('ticket_categories', {
    category_key: { type: 'varchar(80)', primaryKey: true },
    default_queue: { type: 'varchar(80)', notNull: true, references: 'case_queues', onDelete: 'restrict' },
    active: { type: 'boolean', notNull: true, default: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.sql(`INSERT INTO case_queues (queue_key,department,legal_entity,country,updated_by) VALUES
    ('customer-support','operations','BANK-IN','IN','system-seed'), ('payments','operations','BANK-IN','IN','system-seed'), ('fraud','fraud','BANK-IN','IN','system-seed'), ('cards','operations','BANK-IN','IN','system-seed'), ('kyc','compliance','BANK-IN','IN','system-seed'), ('loans','lending','BANK-IN','IN','system-seed')`);
  pgm.sql(`INSERT INTO ticket_categories (category_key,default_queue,updated_by) VALUES
    ('complaint','customer-support','system-seed'), ('service-request','customer-support','system-seed'), ('transaction-dispute','payments','system-seed'), ('fraud-case','fraud','system-seed'), ('card-issue','cards','system-seed'), ('kyc-update','kyc','system-seed'), ('loan-servicing','loans','system-seed')`);
};
exports.down = (pgm) => { pgm.dropTable('ticket_categories'); pgm.dropTable('case_queues'); };
