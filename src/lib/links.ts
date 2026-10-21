// The published address. The Astro config reads it too, so links can recognise the site's own pages.
export const SITE = 'https://kaisenn.net';
const site = new URL(SITE);

/**
 * href and target for a link. An address on this site, even one written out in full, becomes a path the
 * client router can follow; a link to another site opens in a new tab, as the contact and friend links do.
 */
export function linkProps(href: string): { href: string; rel?: string; target?: string } {
  const url = new URL(href, site);
  if (url.origin !== site.origin) return { href, rel: 'noopener noreferrer', target: '_blank' };
  return { href: href.startsWith('/') ? href : url.pathname + url.search + url.hash };
}
