import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { profile } from '../lib/site-data';
import { getPosts } from '../lib/posts';
import { postUrl, postDescription } from '../lib/post-data';

export async function GET(context: APIContext) {
  return rss({
    title: `${profile.name} 的笔记`,
    description: profile.bio,
    site: context.site!,
    items: (await getPosts()).map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: postDescription(post),
      link: postUrl(post.id),
    })),
    customData: '<language>zh-CN</language>',
  });
}
