import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets scroll to the top on every path change so a fresh page starts at its
 * top (SPA navigations otherwise preserve the previous scroll offset). Skips
 * when the URL carries a hash, so in-page anchors (e.g. '/#contact') still land
 * on their section.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      // Defer a tick so the target section is mounted (e.g. '/#contact' after
      // landing on the home route), then bring it into view.
      const id = hash.replace(/^#/, '');
      const t = setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default ScrollToTop;
