import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { config } from './config';

if (!config.oidcAuthority || !config.oidcClientId) throw new Error('OIDC authority and client ID must be configured');
export const userManager = new UserManager({
  authority: config.oidcAuthority, client_id: config.oidcClientId, redirect_uri: `${window.location.origin}/`, post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code', scope: 'openid profile', userStore: new WebStorageStateStore({ store: window.sessionStorage }), automaticSilentRenew: true
});
export const signIn = (): Promise<void> => userManager.signinRedirect();
export const signOut = (): Promise<void> => userManager.signoutRedirect();
/** Cached so it runs once even when React StrictMode runs the effect twice: the sign-in code can only be redeemed once. */
let pendingSignIn: Promise<User | null> | null = null;
export const completeSignIn = (): Promise<User | null> => (pendingSignIn ??= userManager.signinCallback().then((user) => user ?? null));
