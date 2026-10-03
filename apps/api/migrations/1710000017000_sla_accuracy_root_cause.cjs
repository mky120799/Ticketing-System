exports.shorthands = undefined;
// first_responded_at: first customer-facing response. resolved_at / root_cause: set when a ticket is resolved.
exports.up = (pgm) => {
  pgm.addColumns('tickets', { first_responded_at: { type: 'timestamptz' }, resolved_at: { type: 'timestamptz' }, root_cause: { type: 'varchar(40)' } });
  pgm.addConstraint('tickets', 'tickets_root_cause_chk', { check: "root_cause IS NULL OR root_cause IN ('process_gap','system_error','staff_error','customer_error','third_party','fraud_or_scam','policy_or_product','communication','other')" });
  pgm.createIndex('tickets', ['resolved_at'], { where: 'resolved_at IS NOT NULL', name: 'tickets_resolved_at_idx' });
};
exports.down = (pgm) => { pgm.dropIndex('tickets', ['resolved_at'], { name: 'tickets_resolved_at_idx' }); pgm.dropConstraint('tickets', 'tickets_root_cause_chk'); pgm.dropColumns('tickets', ['first_responded_at', 'resolved_at', 'root_cause']); };
