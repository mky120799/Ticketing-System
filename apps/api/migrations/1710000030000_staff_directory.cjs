exports.shorthands = undefined;
// Staff directory: maps the identity provider's opaque subject ID (stored as `assigned_to`, `created_by`, audit `actor_id`...)
// to a display name, so screens can show "Priya Shah" instead of "dd8a043a-e38f-...". Filled from the person's own token
// whenever they open the console; a bank can instead feed it from its HR directory (for example over SCIM).
// Holds staff names only, never customer data.
exports.up = (pgm) => {
  pgm.createTable('staff_directory', {
    subject: { type: 'varchar(160)', primaryKey: true },
    display_name: { type: 'varchar(200)', notNull: true },
    username: { type: 'varchar(200)' },
    email: { type: 'varchar(320)' },
    legal_entity: { type: 'varchar(50)', notNull: true },
    country: { type: 'varchar(2)', notNull: true },
    queues: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    roles: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.createIndex('staff_directory', ['legal_entity', 'country']);
};
exports.down = (pgm) => { pgm.dropTable('staff_directory'); };
