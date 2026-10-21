import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkAlert } from 'remark-github-blockquote-alert';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import minecraftAssets from './widgets/minecraft/astro-assets.mjs';
import uploadImages from './src/integrations/upload-images.ts';
import { rehypeUploadImages } from './src/lib/markdown-images.ts';
import { SITE } from './src/lib/links.ts';

const publicDir = new URL('./public/', import.meta.url);

export default defineConfig({
  site: SITE,
  publicDir: fileURLToPath(publicDir),
  output: 'static',
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, [remarkAlert, { tagName: 'blockquote' }]],
      rehypePlugins: [[rehypeKatex, { trust: false, strict: 'warn' }], [rehypeUploadImages, { publicDir }]],
    }),
    syntaxHighlight: { type: 'shiki', excludeLangs: ['math', 'mermaid'] },
  },
  // Fetch a page as soon as a link to it is on screen, so most clicks swap at once.
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  trailingSlash: 'always',
  server: {
    host: true,
  },
  integrations: [icon(), minecraftAssets(), uploadImages(), sitemap({
    filter: (page) => !['/404/', '/404.html'].includes(new URL(page).pathname),
  })],
});
