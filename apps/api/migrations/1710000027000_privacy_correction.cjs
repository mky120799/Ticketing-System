exports.shorthands = undefined;
// A second kind of regulated request alongside complaints: a customer's request to correct personal information held about them
// (Privacy Act APP 13). It uses the same clock machinery; profiles say which kind they are.
exports.up = (pgm) => {
  pgm.addColumn('regulatory_profiles', { case_kind: { type: 'varchar(30)', notNull: true, default: 'complaint' } });
  pgm.addConstraint('regulatory_profiles', 'regulatory_profiles_kind_chk', { check: "case_kind IN ('complaint','privacy_request')" });
  pgm.addColumn('tickets', { case_kind: { type: 'varchar(30)' } });
  pgm.sql("UPDATE tickets SET case_kind='complaint' WHERE is_complaint=true");
  pgm.dropConstraint('tickets', 'tickets_idr_outcome_chk');
  pgm.addConstraint('tickets', 'tickets_idr_outcome_chk', { check: "idr_outcome IS NULL OR idr_outcome IN ('upheld','partially_upheld','not_upheld','withdrawn','resolved_by_agreement','corrected','corrected_with_statement','refused_with_reasons')" });
  pgm.sql(`INSERT INTO regulatory_profiles (profile_key,label,jurisdiction,case_kind,acknowledge_business_days,final_response_calendar_days,at_risk_days,updated_by) VALUES
    ('au-app13-correction','AU request to correct personal information (Privacy Act APP 13: acknowledge in 5 business days, respond within 30 days)','AU','privacy_request',5,30,5,'system-seed')`);
  pgm.sql("INSERT INTO ticket_categories (category_key,default_queue,regulatory_profile,updated_by) VALUES ('privacy-correction','customer-support','au-app13-correction','system-seed') ON CONFLICT (category_key) DO NOTHING");
};
exports.down = (pgm) => {
  pgm.sql("DELETE FROM ticket_categories WHERE category_key='privacy-correction'");
  pgm.sql("DELETE FROM regulatory_profiles WHERE profile_key='au-app13-correction'");
  pgm.dropConstraint('tickets', 'tickets_idr_outcome_chk');
  pgm.addConstraint('tickets', 'tickets_idr_outcome_chk', { check: "idr_outcome IS NULL OR idr_outcome IN ('upheld','partially_upheld','not_upheld','withdrawn','resolved_by_agreement')" });
  pgm.dropColumn('tickets', 'case_kind'); pgm.dropConstraint('regulatory_profiles', 'regulatory_profiles_kind_chk'); pgm.dropColumn('regulatory_profiles', 'case_kind');
};
