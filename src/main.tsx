import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { engine } from './audio/engine';
import { useStore } from './state/store';
import './styles.css';

// Debug handle for the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { vinyl: { engine, store: useStore } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
