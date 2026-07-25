import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets scroll to the top on every path change so a fresh page starts at its
 * top (SPA navigations otherwise preserve the previous scroll offset). When the
 * URL carries a hash that matches a real page anchor (e.g. '/#contact') it
 * brings that section into view instead. A hash with no matching element — e.g.
 * '/services#risk', where the hash only selects a tab — still resets to the top.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    // Always start the new page at the top. For a hash that names a real page
    // anchor (e.g. '/#contact') we then scroll that section into view; the
    // target may not be mounted on the tick the route changes, so poll a few
    // frames for it. A hash with no matching element — e.g. '/services#risk',
    // where the hash only selects a tab — simply stays at the top.
    window.scrollTo(0, 0);
    if (hash) {
      const id = hash.replace(/^#/, '');
      let raf = 0;
      let tries = 0;
      const findAndScroll = () => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        } else if (tries++ < 60) {
          raf = requestAnimationFrame(findAndScroll);
        }
      };
      raf = requestAnimationFrame(findAndScroll);
      return () => cancelAnimationFrame(raf);
    }
  }, [pathname, hash]);
  return null;
}

export default ScrollToTop;
