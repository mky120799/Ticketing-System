import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { UploadPage } from './upload-page';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname === '/upload' ? <UploadPage /> : <App />}</React.StrictMode>);
