/**
 * Customer portal entry point.
 *
 * Two pages, chosen by the address:
 *   /upload#<token>  → the secure-link page: send documents without an account (the link is the only credential)
 *   anything else    → the signed-in portal: raise and follow requests and complaints
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './styles.css';
import { App } from './app';
import { cssVariablesResolver, theme } from './theme';
import { UploadPage } from './upload-page';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
      {window.location.pathname === '/upload' ? <UploadPage /> : <App />}
    </MantineProvider>
  </React.StrictMode>
);
