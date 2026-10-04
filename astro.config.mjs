import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import minecraftAssets from './widgets/minecraft/astro-assets.mjs';

export default defineConfig({
  site: 'https://kaisenn.net',
  output: 'static',
  trailingSlash: 'always',
  server: {
    host: true,
  },
  integrations: [icon(), minecraftAssets(), sitemap({
    filter: (page) => !['/404/', '/404.html'].includes(new URL(page).pathname),
  })],
});
