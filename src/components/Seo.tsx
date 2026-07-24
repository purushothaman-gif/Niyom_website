import { useEffect } from 'react';

/**
 * Per-page SEO head manager.
 *
 * React 18 has no native document-metadata hoisting, and we deliberately avoid
 * pulling in react-helmet — this small effect-based component upserts the head
 * tags that matter for each route: title, description, canonical, Open Graph /
 * Twitter, and a BreadcrumbList JSON-LD block. The static tags in index.html
 * remain the crawler baseline; whichever public route mounts overrides them.
 *
 * The JSON-LD <script> is the only element we create-and-remove per page (so
 * stale breadcrumbs never linger); the plain meta/link tags are upserted in
 * place and simply overwritten by the next route that mounts a <Seo>.
 */

// Canonical production origin. Used to build absolute canonical / og:url values
// regardless of the host the SPA is currently served from (preview, staging…).
export const SITE_ORIGIN = 'https://www.niyomwealth.com';

export interface Breadcrumb {
  name: string;
  /** Absolute path, e.g. '/' or '/services'. */
  path: string;
}

interface SeoProps {
  title: string;
  description: string;
  /** Route path this page canonicalises to, e.g. '/services'. */
  path: string;
  /** Breadcrumb trail including Home; omit to skip structured data. */
  breadcrumb?: Breadcrumb[];
  /** og:type — defaults to 'website'. */
  type?: string;
}

/** Find an existing tag by a unique attribute or create one in <head>. */
function upsertTag(
  selector: string,
  create: () => HTMLElement,
): HTMLElement {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  const el = upsertTag(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  });
  el.setAttribute('content', content);
}

export function Seo({ title, description, path, breadcrumb, type = 'website' }: SeoProps) {
  // Stable primitive key so the effect doesn't re-run on every parent render
  // just because a fresh breadcrumb array literal was passed in.
  const breadcrumbKey = breadcrumb ? JSON.stringify(breadcrumb) : '';
  useEffect(() => {
    const url = `${SITE_ORIGIN}${path}`;

    document.title = title;

    setMeta('name', 'description', description);

    // Canonical link.
    const canonical = upsertTag('link[rel="canonical"]', () => {
      const l = document.createElement('link');
      l.setAttribute('rel', 'canonical');
      return l;
    });
    canonical.setAttribute('href', url);

    // Open Graph + Twitter.
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', type);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);

    // Breadcrumb structured data — created here, removed on unmount so the trail
    // never outlives the page that owns it.
    let ldScript: HTMLScriptElement | null = null;
    if (breadcrumb && breadcrumb.length > 0) {
      ldScript = document.createElement('script');
      ldScript.type = 'application/ld+json';
      ldScript.setAttribute('data-seo', 'breadcrumb');
      ldScript.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumb.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          item: `${SITE_ORIGIN}${c.path}`,
        })),
      });
      document.head.appendChild(ldScript);
    }

    return () => {
      if (ldScript && ldScript.parentNode) ldScript.parentNode.removeChild(ldScript);
    };
    // breadcrumbKey stands in for the breadcrumb array (stable primitive).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, path, type, breadcrumbKey]);

  return null;
}

export default Seo;
