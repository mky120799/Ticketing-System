import { useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { completeSignIn, signOut, userManager } from './auth';

/**
 * Who is signed in to the portal. Finishes the redirect back from the sign-in page (`?code=` in the address),
 * otherwise resumes a session from this browser tab, and keeps the token fresh while the page is open.
 */
export function usePortalSession(): { user: User | null; ready: boolean; error: string } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const returning = window.location.search.includes('code=');
        const current = returning ? await completeSignIn() : await userManager.getUser();
        // Remove ?code=... from the address bar so a refresh does not try to reuse it.
        if (returning) window.history.replaceState({}, document.title, window.location.pathname);
        setUser(current && !current.expired ? current : null);
      } catch {
        setError('Sign-in could not be completed. Please try again.');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    const renewed = (next: User) => setUser(next);
    const expired = () => { void signOut(); };
    userManager.events.addUserLoaded(renewed);
    userManager.events.addAccessTokenExpired(expired);
    return () => { userManager.events.removeUserLoaded(renewed); userManager.events.removeAccessTokenExpired(expired); };
  }, []);

  return { user, ready, error };
}
