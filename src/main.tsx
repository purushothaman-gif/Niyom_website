import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
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
