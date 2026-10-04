import { assertProductionSafety } from '../src/production-safety.js';

describe('production safety guard', () => {
  const good = { NODE_ENV: 'production', OIDC_ISSUER: 'https://idp.bank.example/realms/staff', DATABASE_URL: 'postgresql://case_app:s3cret@db.bank.example/cases', AUTH_ALLOWED_CLIENTS: 'case-console', AUDIT_REQUIRE_RESTRICTED_DB_ROLE: 'true' } as NodeJS.ProcessEnv;
  it('does nothing outside production', () => { expect(() => assertProductionSafety({ NODE_ENV: 'development', OIDC_ISSUER: 'http://localhost:8080/realms/x' } as NodeJS.ProcessEnv)).not.toThrow(); });
  it('accepts a properly configured production environment', () => { expect(() => assertProductionSafety(good)).not.toThrow(); });
  it('refuses a local or development identity provider', () => {
    expect(() => assertProductionSafety({ ...good, OIDC_ISSUER: 'http://localhost:8080/realms/bank-case-dev' })).toThrow(/OIDC_ISSUER/);
    expect(() => assertProductionSafety({ ...good, OIDC_ISSUER: 'https://idp.bank.example/realms/staff-dev' })).toThrow(/OIDC_ISSUER/);
  });
  it('refuses development secrets and missing hardening', () => {
    expect(() => assertProductionSafety({ ...good, DATABASE_URL: 'postgresql://case_user:case_password@db/x' })).toThrow(/database password/);
    expect(() => assertProductionSafety({ ...good, AUTH_ALLOWED_CLIENTS: '' })).toThrow(/AUTH_ALLOWED_CLIENTS/);
    expect(() => assertProductionSafety({ ...good, AUDIT_REQUIRE_RESTRICTED_DB_ROLE: 'false' })).toThrow(/AUDIT_REQUIRE_RESTRICTED_DB_ROLE/);
  });
  it('lists every problem and can be overridden on a developer machine', () => {
    expect(() => assertProductionSafety({ NODE_ENV: 'production', OIDC_ISSUER: 'http://localhost/x' } as NodeJS.ProcessEnv)).toThrow(/OIDC_ISSUER[\s\S]*AUTH_ALLOWED_CLIENTS[\s\S]*AUDIT_REQUIRE_RESTRICTED_DB_ROLE/);
    expect(() => assertProductionSafety({ NODE_ENV: 'production', OIDC_ISSUER: 'http://localhost/x', ALLOW_DEV_SETTINGS: 'true' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
