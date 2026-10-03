interface RuntimeConfig { apiUrl?: string; oidcAuthority?: string; oidcClientId?: string; }
declare global { interface Window { __APP_CONFIG__?: RuntimeConfig; } }

/**
 * One container image serves every bank: deployment-specific values come from /config.js, generated at container
 * start from environment variables. Build-time VITE_* values remain as the local-development fallback.
 */
const runtime = window.__APP_CONFIG__ ?? {};
export const config = {
  apiUrl: runtime.apiUrl || import.meta.env.VITE_API_URL || '/v1',
  oidcAuthority: runtime.oidcAuthority || import.meta.env.VITE_OIDC_AUTHORITY,
  oidcClientId: runtime.oidcClientId || import.meta.env.VITE_OIDC_CLIENT_ID
};
