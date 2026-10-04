interface RuntimeConfig { apiUrl?: string; oidcAuthority?: string; oidcClientId?: string; }
declare global { interface Window { __APP_CONFIG__?: RuntimeConfig; } }
const runtime = window.__APP_CONFIG__ ?? {};
export const config = { apiUrl: runtime.apiUrl || import.meta.env.VITE_API_URL || '/v1', oidcAuthority: runtime.oidcAuthority || import.meta.env.VITE_OIDC_AUTHORITY, oidcClientId: runtime.oidcClientId || import.meta.env.VITE_OIDC_CLIENT_ID };
