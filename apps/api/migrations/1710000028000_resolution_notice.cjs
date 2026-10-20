exports.shorthands = undefined;
// Customers are told when their request is resolved without anyone having to remember. A category can switch the automatic
// notice off; a portal-specific template exists because portal customers are reached in the portal, not by email.
exports.up = (pgm) => {
  pgm.addColumn('ticket_categories', { resolution_notice_enabled: { type: 'boolean', notNull: true, default: true } });
  pgm.sql(`INSERT INTO communication_templates (template_key,channel,requires_approval,subject_template,body_template,updated_by) VALUES
    ('resolution_notice_portal','portal',true,'Your request has been resolved [{{ticketRef}}]','We have finished reviewing your request {{ticketRef}} and have recorded it as resolved.\n\nIf you are not satisfied with the outcome, reply to this message and we will look at it again.','system-seed')
    ON CONFLICT (template_key) DO NOTHING`);
};
exports.down = (pgm) => {
  pgm.sql("DELETE FROM ticket_communications WHERE template_key='resolution_notice_portal'");
  pgm.sql("DELETE FROM communication_templates WHERE template_key='resolution_notice_portal'");
  pgm.dropColumn('ticket_categories', 'resolution_notice_enabled');
};
