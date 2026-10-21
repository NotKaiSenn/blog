import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(join(root, 'dist', file), 'utf8');

test('retired works and their legacy redirects are excluded from the published template', () => {
  for (const file of [
    'lab/index.html',
    'persona/2025/index.html',
    'pages/persona-2025.html',
    'pages/sandbox-lab.html',
    'pages/home-redirect.html',
    'legacy-redirect.js',
  ]) {
    assert.ok(!existsSync(join(root, 'dist', file)), `${file} must stay outside the published template`);
  }
});

test('folder galleries enhance real navigation to their complete archives', () => {
  const home = read('index.html');
  for (const category of ['posts', 'works', 'photos', 'friends']) {
    assert.match(home, new RegExp(`href="/${category}/" data-folder-open="${category}-gallery"`));
    assert.match(home, new RegExp(`<dialog id="${category}-gallery"[^>]+aria-labelledby="${category}-gallery-title"`));
  }
  assert.doesNotMatch(home, /class="paper-notes"/);
  assert.doesNotMatch(home, /data-gallery-open|data-gallery-title/);
});

test('CMS stores the same fields used by the site with safe writing defaults', () => {
  const cms = parse(readFileSync(join(root, '.pages.yml'), 'utf8'));
  const posts = cms.content.find((entry) => entry.name === 'posts');
  assert.equal(posts.path, 'src/content/posts');
  assert.equal(posts.fields.find((field) => field.name === 'draft').default, true);
  assert.equal(posts.fields.find((field) => field.name === 'body').type, 'rich-text');
  assert.equal(posts.filename.field, 'create');
  assert.equal(posts.operations.rename, false);
  assert.ok(!posts.filename.template.includes('{primary}'), 'Chinese titles need a valid fallback filename');
  assert.equal(cms.settings.content.merge, true);
  assert.equal(cms.media[0].output, '/uploads');
  assert.equal(cms.media[0].input, 'public/uploads');
  for (const [name, path, imageField] of [
    ['profile', 'src/data/site.json', 'avatar'],
    ['photos', 'src/data/photos.json', 'src'],
    ['friends', 'src/data/friends.json', 'avatar'],
    ['works', 'src/data/works.json', 'icon'],
  ]) {
    const entry = cms.content.find(entry => entry.name === name);
    assert.ok(entry, `${name} can be managed through CMS`);
    assert.equal(entry.path, path);
    const fields = name === 'profile' ? entry.fields : entry.fields.find(field => field.name === 'items').fields;
    const image = fields.find(field => field.name === imageField);
    assert.equal(image.type, 'image');
    assert.equal(image.options.media, 'uploads');
  }
  const profileFields = cms.content.find(entry => entry.name === 'profile').fields;
  assert.equal(profileFields.find(field => field.name === 'favicon').options.media, 'uploads');
  const workFields = cms.content.find(entry => entry.name === 'works').fields.find(field => field.name === 'items').fields;
  for (const name of ['title', 'url']) assert.equal(workFields.find(field => field.name === name).required, true);
  assert.ok(workFields.find(field => field.name === 'description'));
  assert.equal(workFields.find(field => field.name === 'icon').label, '展示图片');
  for (const name of ['width', 'height']) assert.notEqual(workFields.find(field => field.name === name).required, true);
  assert.ok(!workFields.some(field => ['id', 'image', 'imageUrl'].includes(field.name) && field.required), 'New work submissions must not require identifiers or a separate cover');
});

test('optional CMS external links accept empty strings while required website links remain required', () => {
  const cms = parse(readFileSync(join(root, '.pages.yml'), 'utf8'));
  for (const [name, keys] of [
    ['profile', ['avatarUrl', 'contactUrl']],
    ['photos', ['externalSrc']],
    ['friends', ['avatarUrl']],
  ]) {
    const entry = cms.content.find(entry => entry.name === name);
    const fields = name === 'profile' ? entry.fields : entry.fields.find(field => field.name === 'items').fields;
    for (const key of keys) {
      const field = fields.find(field => field.name === key);
      const label = `${name}.${key}`;
      assert.notEqual(field.required, true, `${label} must be optional`);
      const pattern = new RegExp(field.pattern.regex);
      assert.ok(pattern.test(''), `${label} must allow clearing an existing external link`);
      assert.ok(pattern.test('https://cdn.example.com/image.webp?v=2'), `${label} must accept HTTPS links`);
      for (const invalid of ['http://example.com/image.png', 'https://', '/uploads/image.png', 'https://example.com/a b.png', 'not a URL']) {
        assert.ok(!pattern.test(invalid), `${label} must reject ${invalid}`);
      }
    }
  }
  const friendFields = cms.content.find(entry => entry.name === 'friends').fields.find(field => field.name === 'items').fields;
  const website = friendFields.find(field => field.name === 'url');
  assert.equal(website.required, true);
  assert.ok(!new RegExp(website.pattern.regex).test(''), 'A friend must still have a website destination');
});

test('production CSS retains standard backdrop filters after vendor-prefix minification', () => {
  const css = readdirSync(join(root, 'dist/_astro')).filter(file => file.endsWith('.css')).map(file => read(`_astro/${file}`)).join('');
  for (const selector of ['.folder-stage::backdrop', '.folder-flap']) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(([, selectors]) => selectors.includes(selector));
    assert.ok(rules.some(([, , declarations]) => /(?:^|;)backdrop-filter:blur\(/.test(declarations)), `${selector} lost its standard blur declaration`);
  }
});

test('the gallery stage leaves horizontal swipes to the card switcher', () => {
  const css = readdirSync(join(root, 'dist/_astro')).filter(file => file.endsWith('.css')).map(file => read(`_astro/${file}`)).join('');
  const stage = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(([, selectors]) => selectors.trim() === '.stage-viewport');
  assert.ok(stage, 'the stage viewport has its own rule');
  assert.match(stage[2], /(?:^|;)touch-action:pan-y pinch-zoom(?:;|$)/, 'browsers otherwise claim a horizontal swipe as a pan and cancel it');
});

test('all content destinations use the client router without fading the page canvas', () => {
  const pages = readdirSync(join(root, 'dist'), { recursive: true })
    .filter(file => file.endsWith('.html') && !file.startsWith('pages/'));
  assert.ok(pages.length > 0);
  for (const file of pages) {
    const html = read(file);
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/)?.[1] ?? '';
    assert.match(head, /<meta name="astro-view-transitions-enabled" content="true"/, `${file} must participate in client navigation`);
    assert.match(head, /<meta name="astro-view-transitions-fallback" content="swap"/, `${file} must swap without a fallback fade`);
    assert.doesNotMatch(head, /@view-transition\s*\{\s*navigation:\s*auto/, `${file} must not start a second cross-document transition`);
    const transitionStyle = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
      .map(([, css]) => css).find(css => css.includes('::view-transition-new(*)'));
    assert.ok(transitionStyle, `${file} needs the shared transition styles`);
    const canvasStyle = transitionStyle.match(/::view-transition-old\(\*\),\s*::view-transition-new\(\*\)\s*\{([^}]+)\}/)?.[1] ?? '';
    assert.match(canvasStyle, /animation:\s*none\s*;/, `${file} must not animate the entire page canvas`);
    assert.match(canvasStyle, /opacity:\s*1\s*;/, `${file} must keep the page canvas opaque`);
    assert.match(html, /<html\b[^>]*style="[^"]*background-color:#[0-9a-f]{6};color-scheme:light"/, `${file} needs its canvas color before external CSS loads`);
  }
});

test('production output keeps the domain and omits retired pages and 404 from sitemap', () => {
  assert.equal(read('CNAME').trim(), 'kaisenn.net');
  const sitemap = readdirSync(join(root, 'dist')).filter((file) => /^sitemap-\d+\.xml$/.test(file)).map(read).join('');
  assert.match(sitemap, /https:\/\/kaisenn.net\/posts\//);
  assert.doesNotMatch(sitemap, /\/pages\/|\/404|\/persona\/2025\/|\/lab\//);
  assert.match(read('robots.txt'), /https:\/\/kaisenn.net\/sitemap-index.xml/);
  assert.match(read('404.html'), /noindex, follow/);
});
