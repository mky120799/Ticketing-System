exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.sql(`CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_events is append-only';
    END;
  $$`);
  pgm.sql(`CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation()`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events');
  pgm.sql('DROP FUNCTION IF EXISTS deny_audit_mutation()');
};
