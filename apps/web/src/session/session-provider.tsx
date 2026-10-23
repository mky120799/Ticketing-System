/**
 * The session: who is signed in, what they may do, and whether the API wants a fresh sign-in (step-up).
 *
 * It is a React context so any component can call `useSession()` instead of passing `user` and `roles`
 * through every layer of props (which the old console did).
 *
 * Lifecycle:
 *   1. On first load, finish the identity-provider redirect if we are coming back from it (`?code=` in the URL),
 *      otherwise pick up an existing session from sessionStorage.
 *   2. After a redirect, go back to the page the person originally asked for (`returnTo`).
 *   3. Load `/me` to learn their roles and organisational scope.
 *   4. Keep listening: renewed tokens replace the user; an expired session signs out; a step-up request shows a banner.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { completeSignIn, safeReturnPath, signOut, userManager } from '../auth';
import { getCurrentUser, type CurrentUser } from '../api';
import { queryKeys } from '../lib/query-keys';
import { hasCapability, type Capability } from './roles';

interface SessionValue {
  /** The OIDC user (holds the access token). Null while signed out. */
  user: User | null;
  /** False until we know whether someone is signed in; screens show a loader meanwhile. */
  ready: boolean;
  /** Roles and scope from `/me`. Undefined while loading. */
  profile: CurrentUser | undefined;
  roles: string[];
  can: (capability: Capability) => boolean;
  /** Sign-in problem to show on the login screen. */
  error: string;
  /** True when the API refused an action because the last sign-in is too old. */
  stepUpRequired: boolean;
  dismissStepUp: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [stepUpRequired, setStepUpRequired] = useState(false);

  // 1 + 2: finish signing in (or resume a session), then return to the page the person wanted.
  useEffect(() => {
    void (async () => {
      try {
        const returningFromSignIn = window.location.search.includes('code=');
        const current = returningFromSignIn ? await completeSignIn() : await userManager.getUser();
        // An expired session in storage is as good as none: show the sign-in screen.
        setUser(current && !current.expired ? current : null);
        if (returningFromSignIn) navigate(safeReturnPath(current), { replace: true });
      } catch {
        setError('Sign-in could not be completed. Please try again.');
      } finally {
        setReady(true);
      }
    })();
  }, [navigate]);

  // 4: react to events from the identity provider and the API.
  useEffect(() => {
    const renewed = (next: User) => setUser(next);            // silent renewal produced a fresh token
    const expired = () => { void signOut(); };                  // renewal failed and the token ran out
    const stepUp = () => setStepUpRequired(true);               // raised by api.ts when the API says "step_up_required"
    userManager.events.addUserLoaded(renewed);
    userManager.events.addAccessTokenExpired(expired);
    window.addEventListener('step-up-required', stepUp);
    return () => {
      userManager.events.removeUserLoaded(renewed);
      userManager.events.removeAccessTokenExpired(expired);
      window.removeEventListener('step-up-required', stepUp);
    };
  }, []);

  // 3: roles and scope. Cached for the whole session (they only change when the person signs in again).
  const { data: profile, error: profileError } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => getCurrentUser(user!),
    enabled: Boolean(user),
    staleTime: Infinity
  });

  const value = useMemo<SessionValue>(() => {
    const roles = profile?.roles ?? [];
    return {
      user, ready, profile, roles,
      can: (capability) => hasCapability(roles, capability),
      error: error || (profileError ? 'Your profile could not be loaded. Check that your account has a role assigned.' : ''),
      stepUpRequired,
      dismissStepUp: () => setStepUpRequired(false)
    };
  }, [user, ready, profile, error, profileError, stepUpRequired]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/**
 * For screens that only render when signed in (everything behind the login page): returns the user without
 * the "might be null" check at every call site.
 */
export function useSignedInUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('useSignedInUser called while signed out');
  return user;
}
