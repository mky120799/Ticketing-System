/**
 * Refuses to start in production with settings that are only acceptable on a developer's machine. The development identity
 * realm, demo passwords and secrets are public, so a deployment that points at them is effectively unauthenticated.
 * Set ALLOW_DEV_SETTINGS=true to run the local container stack, which uses production mode with development settings.
 */
export function assertProductionSafety(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production' || env.ALLOW_DEV_SETTINGS === 'true') return;
  const problems: string[] = [];
  const looksLocal = (value: string | undefined) => !!value && /(localhost|127\.0\.0\.1|host\.docker\.internal|(^|[/.-])dev([/.-]|$))/i.test(value);
  if (looksLocal(env.OIDC_ISSUER)) problems.push('OIDC_ISSUER points at a local or development identity provider');
  if (looksLocal(env.PORTAL_OIDC_ISSUER)) problems.push('PORTAL_OIDC_ISSUER points at a local or development identity provider');
  if ((env.DATABASE_URL ?? '').includes('case_password')) problems.push('DATABASE_URL uses the development database password');
  if ((env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? '').startsWith('local-')) problems.push('Object storage uses a development secret');
  if ((env.EMAIL_REFERENCE_SECRET ?? '').startsWith('local-dev')) problems.push('EMAIL_REFERENCE_SECRET is the development value');
  if ((env.AUTH_INTROSPECTION_CLIENT_SECRET ?? '').startsWith('local-dev')) problems.push('The token-introspection secret is the development value');
  if (env.AUTH_ALLOWED_CLIENTS === undefined || env.AUTH_ALLOWED_CLIENTS === '') problems.push('AUTH_ALLOWED_CLIENTS is not set (tokens issued to any application would be accepted)');
  if (env.AUDIT_REQUIRE_RESTRICTED_DB_ROLE !== 'true') problems.push('AUDIT_REQUIRE_RESTRICTED_DB_ROLE is not true (the application could be running as an account that can alter the audit trail)');
  if (problems.length) throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}\nFix these, or set ALLOW_DEV_SETTINGS=true on a development machine.`);
}
