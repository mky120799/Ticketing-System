import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

import { config } from './config';

const authority = config.oidcAuthority;
const clientId = config.oidcClientId;
if (!authority || !clientId) throw new Error('OIDC authority and client ID must be configured');

export const userManager = new UserManager({
  authority, client_id: clientId, redirect_uri: `${window.location.origin}/`, post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code', scope: 'openid profile', userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: false, monitorSession: true
});
export const signIn = (): Promise<void> => userManager.signinRedirect();
export const signOut = (): Promise<void> => userManager.signoutRedirect();
export const completeSignIn = async (): Promise<User | null> => (await userManager.signinCallback()) ?? null;
