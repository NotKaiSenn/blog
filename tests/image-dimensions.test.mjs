import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { withImageDimensions } from '../src/lib/image-dimensions.ts';
import { writeTinyPng, writeTransparentPng } from './helpers/image-fixture.mjs';

const photo = { id: 'test', title: '测试照片', date: '2026-09-21', src: '/uploads/照片.png', alt: '测试', width: 4, height: 3 };
const work = { title: '测试作品', url: '/project/', width: 1, height: 1 };
const photoSource = photo => photo.src;
const workSource = work => work.image;

function publicDir(t) {
  const root = mkdtempSync(join(tmpdir(), 'blog-image-dimensions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'uploads'));
  return root;
}

test('uploads use their real dimensions, including encoded filenames and stale manual values', async t => {
  const root = publicDir(t);
  writeTinyPng(join(root, 'uploads/照片.png'));
  writeTransparentPng(join(root, 'uploads/作品.png'), 12, 7);
  const photos = await withImageDimensions([
    photo,
    { ...photo, id: 'encoded', src: '/uploads/%E7%85%A7%E7%89%87.png', width: 300, height: 400 },
  ], pathToFileURL(root), 'photo', photoSource);
  assert.deepEqual(photos.map(({ width, height }) => [width, height]), [[1, 1], [1, 1]]);
  const works = await withImageDimensions([
    { ...work, image: '/uploads/作品.png', width: 900, height: 1600 },
    { ...work, image: '/uploads/%E4%BD%9C%E5%93%81.png' },
  ], pathToFileURL(root), 'work', workSource);
  assert.deepEqual(works.map(({ width, height }) => [width, height]), [[12, 7], [12, 7]]);
  assert.deepEqual([photo.width, photo.height, work.width, work.height], [4, 3, 1, 1], 'inputs are not modified');
});

test('remote and imageless items keep supplied or fallback geometry without fetching', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Remote image metadata must not be fetched.'); });
  const missing = new URL('file:///missing-public-directory/');
  const photos = [{ ...photo, src: 'https://images.example.com/unavailable.webp', width: 900, height: 1600 }, { ...photo, id: 'fallback', src: 'https://images.example.com/no-size.webp' }];
  assert.deepEqual(await withImageDimensions(photos, missing, 'photo', photoSource), photos);
  const works = [{ ...work, image: 'https://images.example.com/cover.webp', width: 900, height: 1600 }, work];
  assert.deepEqual(await withImageDimensions(works, missing, 'work', workSource), works);
});

test('missing, invalid and out-of-directory uploads fail with an actionable error', async t => {
  const root = publicDir(t);
  writeFileSync(join(root, 'uploads/invalid.webp'), 'not an image');
  for (const [kind, items, source] of [['photo', src => [{ ...photo, src }], photoSource], ['work', image => [{ ...work, image }], workSource]]) {
    for (const src of ['/uploads/missing.webp', '/uploads/invalid.webp']) {
      await assert.rejects(withImageDimensions(items(src), pathToFileURL(root), kind, source), new RegExp(`Unable to read local ${kind} ${src}`));
    }
    await assert.rejects(withImageDimensions(items('/uploads/%2e%2e/private.webp'), pathToFileURL(root), kind, source), new RegExp(`Local ${kind} must point to a file within /uploads/`));
  }
});
