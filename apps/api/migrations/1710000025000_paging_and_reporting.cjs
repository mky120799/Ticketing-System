exports.shorthands = undefined;
exports.up = (pgm) => {
  // Supports the newest-first paged ticket list within a legal entity, country and queue.
  pgm.createIndex('tickets', ['legal_entity', 'country', 'queue', { name: 'created_at', sort: 'DESC' }, { name: 'id', sort: 'DESC' }], { name: 'tickets_paging_idx' });

  // A read-only reporting surface for the bank's BI tools. Only classifications, dates, outcomes and opaque IDs: no subject,
  // description, notes, custom fields, references or free-text reasons. Grant SELECT on this schema to a reporting account.
  pgm.sql('CREATE SCHEMA IF NOT EXISTS reporting');
  pgm.sql(`CREATE OR REPLACE VIEW reporting.tickets AS SELECT id, category, priority, status, sensitivity, queue, branch_code, department, legal_entity, country, source_channel,
      created_at, updated_at, closed_at, first_response_due_at, resolution_due_at, first_responded_at, resolved_at, sla_status, root_cause, assigned_to,
      is_complaint, regulatory_profile, regulatory_status, acknowledge_due_at, final_response_due_at, idr_outcome, vulnerability_flag, systemic_issue, afca_status, redacted_at
    FROM tickets`);
  pgm.sql(`CREATE OR REPLACE VIEW reporting.status_history AS SELECT ticket_id, from_status, to_status, changed_by, changed_at FROM ticket_status_history`);
  pgm.sql(`CREATE OR REPLACE VIEW reporting.escalations AS SELECT ticket_id, rule_key, trigger, from_queue, to_queue, created_at FROM ticket_escalations`);
  pgm.sql(`CREATE OR REPLACE VIEW reporting.communications AS SELECT ticket_id, channel, template_key, status, created_at, updated_at FROM ticket_communications`);
};
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS reporting.communications, reporting.escalations, reporting.status_history, reporting.tickets');
  pgm.sql('DROP SCHEMA IF EXISTS reporting');
  pgm.dropIndex('tickets', [], { name: 'tickets_paging_idx' });
};
