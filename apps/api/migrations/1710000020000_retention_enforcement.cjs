exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.addColumns('tickets', { closed_at: { type: 'timestamptz' }, redacted_at: { type: 'timestamptz' } });
  pgm.addColumn('ticket_categories', { retention_years: { type: 'integer', notNull: true, default: 7 } });
  pgm.addConstraint('ticket_categories', 'ticket_categories_retention_chk', { check: 'retention_years BETWEEN 1 AND 99' });
  // Existing closed tickets get a closed_at so they are subject to retention too.
  pgm.sql("UPDATE tickets SET closed_at = updated_at WHERE status IN ('closed','cancelled') AND closed_at IS NULL");
  pgm.createIndex('tickets', ['closed_at'], { where: 'redacted_at IS NULL AND closed_at IS NOT NULL', name: 'tickets_retention_candidates_idx' });
};
exports.down = (pgm) => {
  pgm.dropIndex('tickets', ['closed_at'], { name: 'tickets_retention_candidates_idx' });
  pgm.dropConstraint('ticket_categories', 'ticket_categories_retention_chk'); pgm.dropColumn('ticket_categories', 'retention_years');
  pgm.dropColumns('tickets', ['closed_at', 'redacted_at']);
};
