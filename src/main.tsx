import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
/*
 * Imported for its side effect: creating the three Supabase clients and handing
 * them to `shared/`, which holds the portfolio, CAS, gains and partner logic
 * this site shares with the mobile app. Those files look their client up lazily,
 * so the registration only has to happen before the first query — but relying on
 * App.tsx to happen to import this file is the kind of implicit ordering that
 * breaks the day someone lazy-loads a route. Naming it here makes it explicit.
 */
import './lib/supabase';
import { installNumberInputScrollGuard } from './lib/numberInputScrollGuard';

// Guards every number field in the app against accidental trackpad edits.
installNumberInputScrollGuard();

// A client password-recovery link arrives as a URL hash (…#type=recovery&…).
// Capture it synchronously at boot — before the Supabase client's async init
// strips the hash from the URL — so the app can route to the reset screen even
// when Supabase lands the user on the Site URL (home page) rather than the exact
// reset path. The flag is consumed and cleared by the reset screen.
try {
  if (window.location.hash.includes('type=recovery')) {
    sessionStorage.setItem('nw_pw_recovery', '1');
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
