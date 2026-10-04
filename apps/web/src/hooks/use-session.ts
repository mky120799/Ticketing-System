import { useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { completeSignIn, signOut, userManager } from '../auth';

/**
 * Who is signed in. Completes the sign-in redirect, keeps the access token fresh (silent renewal), signs the user out when
 * the identity provider ends the session, and raises a flag when the API asks for a recent sign-in (step-up).
 */
export function useSession(): { user: User | null; error: string; stepUp: boolean; dismissStepUp: () => void } {
  const [user, setUser] = useState<User | null>(null); const [error, setError] = useState(''); const [stepUp, setStepUp] = useState(false);
  useEffect(() => {
    const loaded = (renewed: User) => setUser(renewed); const expired = () => { void signOut(); }; const needed = () => setStepUp(true);
    userManager.events.addUserLoaded(loaded); userManager.events.addAccessTokenExpired(expired); window.addEventListener('step-up-required', needed);
    return () => { userManager.events.removeUserLoaded(loaded); userManager.events.removeAccessTokenExpired(expired); window.removeEventListener('step-up-required', needed); };
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const completing = window.location.search.includes('code=');
        const current = completing ? await completeSignIn() : await userManager.getUser();
        if (completing) window.history.replaceState({}, document.title, window.location.pathname);
        setUser(current);
      } catch { setError('Sign-in could not be completed.'); }
    })();
  }, []);
  return { user, error, stepUp, dismissStepUp: () => setStepUp(false) };
}
