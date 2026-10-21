/** Links that leave the site open in a new tab, as the contact and friend links always have. */
export function linkAttributes(href: string): { rel?: string; target?: string } {
  return /^https?:\/\//i.test(href) ? { rel: 'noopener noreferrer', target: '_blank' } : {};
}
