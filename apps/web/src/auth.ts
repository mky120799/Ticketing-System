/**
 * Sign-in with the bank's identity provider (OpenID Connect, authorization code flow with PKCE).
 * The console never sees a password: it redirects to the identity provider and receives tokens back.
 */
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { config } from './config';

const authority = config.oidcAuthority;
const clientId = config.oidcClientId;
if (!authority || !clientId) throw new Error('OIDC authority and client ID must be configured');

export const userManager = new UserManager({
  authority, client_id: clientId,
  // The identity provider always sends people back to the site root; the page they wanted travels in `state` (below).
  redirect_uri: `${window.location.origin}/`, post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code', scope: 'openid profile',
  // sessionStorage: tokens disappear when the tab closes and are not shared with other tabs.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true, monitorSession: true
});

/** What we round-trip through the identity provider so people land back where they started. */
interface SignInState { returnTo?: string }

const currentPath = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/**
 * Only same-site paths are allowed as a return target. "//evil.example" is a protocol-relative URL that would
 * leave the site, so it is rejected along with anything not starting with a single "/" (open-redirect protection).
 */
export function safeReturnPath(user: User | null): string {
  const returnTo = (user?.state as SignInState | undefined)?.returnTo;
  return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
}

export const signIn = (returnTo = currentPath()): Promise<void> => userManager.signinRedirect({ state: { returnTo } satisfies SignInState });
export const signOut = (): Promise<void> => userManager.signoutRedirect();
/** Step-up: ask the identity provider for a fresh login (and, if it supports it, a stronger one) before a sensitive action. */
export const reauthenticate = (returnTo = currentPath()): Promise<void> => userManager.signinRedirect({ max_age: 0, state: { returnTo } satisfies SignInState });

/**
 * Finishes the redirect back from the identity provider. The promise is cached so it runs once even if React
 * calls the effect twice (StrictMode does this in development); the one-time `code` cannot be redeemed twice.
 */
let pendingSignIn: Promise<User | null> | null = null;
export const completeSignIn = (): Promise<User | null> => (pendingSignIn ??= userManager.signinCallback().then((user) => user ?? null));
