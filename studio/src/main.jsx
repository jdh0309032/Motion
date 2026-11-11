import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(<App />);

// dev handle for debugging / automated tests
if (import.meta.env.DEV) Promise.all([import('./store.js'), import('./engine/actions.js')]).then(([m, a]) => { window.__motion = { ...m, actions: a }; });
