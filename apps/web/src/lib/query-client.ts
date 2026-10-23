/**
 * TanStack Query setup: the shared cache for everything read from the API.
 *
 * Why a cache instead of useState + useEffect in every component:
 *   - loading and error states come for free (`isPending`, `isError`),
 *   - two components asking for the same ticket share one request,
 *   - after a change we "invalidate" a key and every screen showing that data refreshes itself.
 */
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';
import { notifyError } from './notify';

/** Retrying cannot fix "not allowed", "not found" or "invalid": only retry network trouble and server errors. */
const shouldRetry = (failureCount: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && failureCount < 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // Data is considered fresh for 30 seconds. Live updates (SSE) refresh tickets sooner when they change.
      staleTime: 30_000,
      refetchOnWindowFocus: false
    },
    mutations: { retry: false }
  },
  // Every failed change (save, assign, approve...) shows an error toast, in one place, so no screen forgets to.
  // A mutation can opt out with `meta: { silent: true }` when it shows the error itself.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => { if (!mutation.meta?.silent) notifyError(error); }
  })
});
