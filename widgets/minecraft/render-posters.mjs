// Renders each season's first frame to assets/posters/, which pages show until the live scene is ready.
// Run after changing a scene. Uses the installed Chrome; set CHROMIUM_PATH to use another Chromium build.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright-core';
import { SEASONS } from './seasons.mjs';

const root = new URL('./', import.meta.url);
const threeBuild = new URL('./', import.meta.resolve('three'));
const origin = 'http://widget.test';
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg' };
const QUALITY = .8;
const SCALE = 2;

const page = season => `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
<style>html, body { margin: 0; background: transparent; }</style>
<minecraft-widget season="${season}"></minecraft-widget>
<script type="module">
  const widget = document.querySelector('minecraft-widget');
  // The first frame is what the live scene shows when it replaces the poster.
  widget.addEventListener('minecraft-ready', () => {
    widget.view.render(performance.now());
    window.poster = widget.canvas.toDataURL('image/webp', ${QUALITY});
  }, { once: true });
  await import('./minecraft-widget.mjs');
</script>`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }),
  // Software rendering draws the same pixels on every machine.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const manifestURL = new URL('assets/sources.json', root);
const manifest = JSON.parse(await readFile(manifestURL, 'utf8'));
const posters = [];
try {
  await mkdir(new URL('assets/posters/', root), { recursive: true });
  for (const season of Object.keys(SEASONS)) {
    const context = await browser.newContext({ viewport: { width: 340, height: 280 }, deviceScaleFactor: SCALE });
    await context.route(`${origin}/**`, async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: page(season) });
      const file = pathname.startsWith('/vendor/') ? new URL(pathname.slice('/vendor/'.length), threeBuild) : new URL(`.${pathname}`, root);
      try {
        await route.fulfill({ contentType: types[extname(pathname)], body: await readFile(file) });
      } catch {
        await route.fulfill({ status: 404 });
      }
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => console.error(`${season}: ${error.message}`));
    await tab.goto(`${origin}/`);
    const poster = await (await tab.waitForFunction(() => window.poster, null, { timeout: 60_000 })).jsonValue();
    await context.close();
    const bytes = Buffer.from(poster.slice(poster.indexOf(',') + 1), 'base64');
    const path = `posters/${season}.webp`;
    await writeFile(new URL(`assets/${path}`, root), bytes);
    posters.push({ path, source: 'Rendered from the assets above by render-posters.mjs', sha256: createHash('sha256').update(bytes).digest('hex'), size: [340 * SCALE, 280 * SCALE] });
    console.log(`${path} ${(bytes.length / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}
manifest.files = [...manifest.files.filter(file => !file.path.startsWith('posters/')), ...posters];
await writeFile(manifestURL, `${JSON.stringify(manifest, null, 2)}\n`);
