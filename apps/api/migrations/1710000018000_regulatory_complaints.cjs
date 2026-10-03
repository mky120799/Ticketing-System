exports.shorthands = undefined;
const stamp = (pgm) => ({ updated_by: { type: 'varchar(160)', notNull: true }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') } });

exports.up = (pgm) => {
  // A regulatory profile defines the clocks that apply to a class of case. Jurisdiction rules are DATA, not code:
  // a bank in another market (or with stricter internal targets) edits or adds profiles instead of changing the product.
  pgm.createTable('regulatory_profiles', {
    profile_key: { type: 'varchar(60)', primaryKey: true },
    label: { type: 'varchar(160)', notNull: true },
    jurisdiction: { type: 'varchar(10)', notNull: true },
    acknowledge_business_days: { type: 'integer', notNull: true },
    final_response_calendar_days: { type: 'integer', notNull: true },
    at_risk_days: { type: 'integer', notNull: true, default: 5 },
    active: { type: 'boolean', notNull: true, default: true },
    ...stamp(pgm)
  });
  pgm.addConstraint('regulatory_profiles', 'regulatory_profiles_positive_chk', { check: 'acknowledge_business_days >= 0 AND final_response_calendar_days >= 1 AND at_risk_days >= 0' });

  pgm.createTable('business_holidays', {
    country: { type: 'varchar(2)', notNull: true },
    holiday_date: { type: 'date', notNull: true },
    name: { type: 'varchar(120)', notNull: true },
    ...stamp(pgm)
  });
  pgm.addConstraint('business_holidays', 'business_holidays_pk', { primaryKey: ['country', 'holiday_date'] });

  pgm.addColumns('ticket_categories', {
    regulatory_profile: { type: 'varchar(60)', references: 'regulatory_profiles', onDelete: 'restrict' },
    block_customer_communication: { type: 'boolean', notNull: true, default: false }
  });

  pgm.addColumns('tickets', {
    is_complaint: { type: 'boolean', notNull: true, default: false },
    regulatory_profile: { type: 'varchar(60)', references: 'regulatory_profiles', onDelete: 'restrict' },
    acknowledge_due_at: { type: 'timestamptz' },
    final_response_due_at: { type: 'timestamptz' },
    regulatory_status: { type: 'varchar(30)' },
    idr_outcome: { type: 'varchar(30)' },
    vulnerability_flag: { type: 'boolean', notNull: true, default: false },
    systemic_issue: { type: 'boolean', notNull: true, default: false },
    afca_status: { type: 'varchar(20)', notNull: true, default: 'none' },
    afca_reference: { type: 'varchar(60)' },
    communications_blocked: { type: 'boolean', notNull: true, default: false }
  });
  pgm.addConstraint('tickets', 'tickets_idr_outcome_chk', { check: "idr_outcome IS NULL OR idr_outcome IN ('upheld','partially_upheld','not_upheld','withdrawn','resolved_by_agreement')" });
  pgm.addConstraint('tickets', 'tickets_afca_status_chk', { check: "afca_status IN ('none','referred','open','closed')" });
  pgm.createIndex('tickets', ['regulatory_status'], { where: 'is_complaint = true', name: 'tickets_complaint_status_idx' });

  // Escalation rules may now also fire on regulatory clocks.
  pgm.dropConstraint('escalation_rules', 'escalation_rules_trigger_chk');
  pgm.addConstraint('escalation_rules', 'escalation_rules_trigger_chk', { check: "trigger IN ('first_response_overdue','breached','regulatory_ack_overdue','regulatory_at_risk','regulatory_breached')" });

  // Australian defaults (ASIC RG 271). Editable configuration; other markets add their own rows.
  pgm.sql(`INSERT INTO regulatory_profiles (profile_key,label,jurisdiction,acknowledge_business_days,final_response_calendar_days,at_risk_days,updated_by) VALUES
    ('au-rg271-standard','AU complaint - standard (RG 271: acknowledge within 1 business day, final response within 30 days)','AU',1,30,5,'system-seed'),
    ('au-rg271-hardship','AU complaint - credit hardship / default notice (final response within 21 days)','AU',1,21,4,'system-seed')`);
  pgm.sql("UPDATE ticket_categories SET regulatory_profile='au-rg271-standard' WHERE category_key='complaint'");
  // Fraud cases default to blocking customer communications (tipping-off / investigation integrity); a supervisor can lift it per case.
  pgm.sql("UPDATE ticket_categories SET block_customer_communication=true WHERE category_key='fraud-case'");
};

exports.down = (pgm) => {
  pgm.dropConstraint('escalation_rules', 'escalation_rules_trigger_chk');
  pgm.addConstraint('escalation_rules', 'escalation_rules_trigger_chk', { check: "trigger IN ('first_response_overdue','breached')" });
  pgm.dropIndex('tickets', ['regulatory_status'], { name: 'tickets_complaint_status_idx' });
  pgm.dropConstraint('tickets', 'tickets_afca_status_chk'); pgm.dropConstraint('tickets', 'tickets_idr_outcome_chk');
  pgm.dropColumns('tickets', ['is_complaint', 'regulatory_profile', 'acknowledge_due_at', 'final_response_due_at', 'regulatory_status', 'idr_outcome', 'vulnerability_flag', 'systemic_issue', 'afca_status', 'afca_reference', 'communications_blocked']);
  pgm.dropColumns('ticket_categories', ['regulatory_profile', 'block_customer_communication']);
  pgm.dropTable('business_holidays'); pgm.dropTable('regulatory_profiles');
};
