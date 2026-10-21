export interface Post {
  id: string;
  body?: string;
  data: { title: string; description: string; pubDate: Date; draft: boolean };
}

export const PAGE_SIZE = 12;

export function publishedPosts<T extends Post>(posts: T[]): T[] {
  const published = posts.filter((post) => !post.data.draft);
  for (const post of published) {
    if (!post.body?.trim()) throw new Error(`Published article "${post.id}" has no body.`);
  }
  return published.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function postUrl(id: string): string {
  return `/posts/${encodeURIComponent(id)}/`;
}

export function postDescription(post: Post): string {
  if (post.data.description) return post.data.description;
  const paragraphs = (post.body ?? '').replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/);
  const firstParagraph = paragraphs.find((block) => block.trim()
    && !/^(?:#{1,6}\s|!\[|[-*+]\s|\d+\.\s|\|)/.test(block.trim())) ?? '';
  return firstParagraph
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[#*_~`>|]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Dates are calendar days stored in UTC, so they never shift with the build machine's time zone.
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Formats a note date, or a photo's YYYY-MM-DD date, for reading. */
export function displayDate(date: Date | string): string {
  return dateFormat.format(typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date);
}

/** The YYYY-MM-DD form used by <time datetime>. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
