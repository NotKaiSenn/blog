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

export default defineConfig({
  site: 'https://kaisenn.net',
  output: 'static',
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, [remarkAlert, { tagName: 'blockquote' }]],
      rehypePlugins: [[rehypeKatex, { trust: false, strict: 'warn' }], [rehypeUploadImages, { publicDir: new URL('./public/', import.meta.url) }]],
    }),
    syntaxHighlight: { type: 'shiki', excludeLangs: ['math', 'mermaid'] },
  },
  trailingSlash: 'always',
  server: {
    host: true,
  },
  integrations: [icon(), minecraftAssets(), uploadImages(), sitemap({
    filter: (page) => !['/404/', '/404.html'].includes(new URL(page).pathname),
  })],
});
