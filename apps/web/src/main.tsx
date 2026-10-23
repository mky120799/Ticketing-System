/**
 * Entry point. Wraps the app in its "providers", each of which makes one service available to every component:
 *
 *   MantineProvider      → the design system (theme, colours, components)
 *   Notifications        → toast messages
 *   QueryClientProvider  → the shared cache of server data (TanStack Query)
 *   BrowserRouter        → URLs: every screen has its own address, Back works, links can be shared
 *   SessionProvider      → who is signed in and what they may do
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { App } from './app';
import { queryClient } from './lib/query-client';
import { SessionProvider } from './session/session-provider';
import { cssVariablesResolver, theme } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Light scheme only for now: the accessible colour overrides in theme.ts are tuned for a white background. */}
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>
);
