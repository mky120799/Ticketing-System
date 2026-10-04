exports.shorthands = undefined;
// Defence in depth: TRUNCATE bypasses row triggers, so audit_events also refuses it at statement level.
// (Archiving old events is a deliberate, owner-run procedure that disables this trigger inside a transaction.)
exports.up = (pgm) => { pgm.sql('CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION deny_audit_mutation()'); };
exports.down = (pgm) => { pgm.sql('DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events'); };
