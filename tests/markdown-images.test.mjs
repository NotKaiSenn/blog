import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { htmlToHast } from 'satteri';
import { toHtml } from 'hast-util-to-html';
import { rehypeUploadImages, PROSE_IMAGE_SIZES } from '../src/lib/markdown-images.ts';
import { writeTransparentPng } from './helpers/image-fixture.mjs';

async function render(t, html) {
  const root = mkdtempSync(join(tmpdir(), 'blog-markdown-images-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'uploads'));
  writeTransparentPng(join(root, 'uploads/wide.png'), 1000, 400);
  writeTransparentPng(join(root, 'uploads/small.png'), 300, 200);
  const tree = htmlToHast(html, { fragment: true });
  await rehypeUploadImages({ publicDir: pathToFileURL(`${root}/`) })(tree);
  return htmlToHast(toHtml(tree), { fragment: true }).children.filter(node => node.type === 'element').map(node => node.properties);
}

test('uploaded note images reserve their space and offer smaller variants', async t => {
  const [first, second, small] = await render(t, '<img src="/uploads/wide.png" alt="首图"><img src="/uploads/wide.png" alt="后图"><img src="/uploads/small.png" alt="小图">');
  for (const image of [first, second]) {
    assert.equal(image.width, 1000);
    assert.equal(image.height, 400);
    assert.equal(image.srcSet, '/_uploads/480/wide.png.webp 480w, /_uploads/720/wide.png.webp 720w, /_uploads/960/wide.png.webp 960w, /_uploads/1000/wide.png.webp 1000w');
    assert.equal(image.sizes, PROSE_IMAGE_SIZES);
    assert.equal(image.decoding, 'async');
  }
  assert.equal(first.loading, undefined, 'the first image may be the largest content on screen');
  assert.equal(second.loading, 'lazy');
  assert.deepEqual([small.width, small.height, small.srcSet, small.sizes], [300, 200, undefined, undefined]);
});

test('author sizes, remote images and unreadable paths are left as written', async t => {
  const [sized, remote, missing, outside] = await render(t, '<img src="/uploads/wide.png" width="320"><img src="https://images.example.com/a.png"><img src="/uploads/missing.png"><img src="/uploads/%2e%2e/wide.png">');
  assert.equal(sized.width, 320);
  assert.equal(sized.height, undefined, 'a single author dimension keeps its natural aspect ratio');
  assert.ok(sized.srcSet);
  for (const image of [remote, missing, outside]) {
    assert.deepEqual(Object.keys(image), ['src']);
  }
});
