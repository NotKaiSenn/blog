import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVariantPath, responsiveImage, variantPath, VARIANT_WIDTHS } from '../src/lib/upload-variants.ts';

const sizes = '(max-width: 540px) 100vw, 320px';

function candidates(srcset) {
  return srcset.split(', ').map(candidate => candidate.split(' '));
}

test('uploads offer every smaller variant and a full-width candidate', () => {
  const { srcset, sizes: attribute } = responsiveImage('/uploads/photo.png', 1000, sizes);
  assert.equal(attribute, sizes);
  assert.deepEqual(candidates(srcset), [
    ['/_uploads/480/photo.png.webp', '480w'],
    ['/_uploads/720/photo.png.webp', '720w'],
    ['/_uploads/960/photo.png.webp', '960w'],
    ['/_uploads/1000/photo.png.webp', '1000w'],
  ], 'a full-size WebP replaces a heavier PNG or JPEG');
  assert.deepEqual(candidates(responsiveImage('/uploads/photo.webp', 1000, sizes).srcset).at(-1), ['/uploads/photo.webp', '1000w'], 'WebP originals are not encoded again');
  const large = candidates(responsiveImage('/uploads/photo.jpg', 5712, sizes).srcset);
  assert.deepEqual(large.map(([, descriptor]) => descriptor), [...VARIANT_WIDTHS.map(width => `${width}w`), '5712w']);
  assert.deepEqual(large.at(-1), ['/uploads/photo.jpg', '5712w'], 'beyond the variant range, the original keeps full detail');
});

test('remote, small and unmeasured images keep a plain src without a stray sizes attribute', () => {
  for (const [src, width] of [
    ['https://images.example.com/photo.jpg', 4000],
    ['/uploads/avatar.webp', 480],
    ['/uploads/avatar.webp', 400],
    ['/uploads/photo.jpg', undefined],
    [undefined, 4000],
    ['/favicon.svg', 4000],
  ]) {
    assert.deepEqual(responsiveImage(src, width, sizes), {}, `${src} at ${width}`);
  }
});

test('variant URLs stay valid srcset candidates and round-trip raw and encoded file names', () => {
  for (const src of ['/uploads/照片 1,2.png', '/uploads/%E7%85%A7%E7%89%87%201%2C2.png']) {
    const { srcset } = responsiveImage(src, 2000, sizes);
    for (const [url, descriptor] of candidates(srcset)) {
      assert.match(descriptor, /^\d+w$/);
      assert.doesNotMatch(url, /[\s,]/, 'commas and spaces would split the candidate list');
    }
    assert.deepEqual(parseVariantPath(variantPath(src, 960)), { file: '照片 1,2.png', width: 960 });
  }
  assert.deepEqual(parseVariantPath('/_uploads/480/2026/photo.png.webp'), { file: '2026/photo.png', width: 480 });
  assert.equal(responsiveImage('/uploads/%E0%A4%A.png', 2000, sizes).srcset, undefined, 'malformed escapes fall back to the original');
});

test('variant URLs cannot name other widths, formats or files outside uploads', () => {
  assert.deepEqual(parseVariantPath('/_uploads/1000/photo.png.webp'), { file: 'photo.png', width: 1000 });
  for (const pathname of [
    '/_uploads/1921/photo.png.webp',
    '/_uploads/0/photo.png.webp',
    '/_uploads/0480/photo.png.webp',
    '/_uploads/-480/photo.png.webp',
    '/_uploads/960/photo.png',
    '/_uploads/960/.webp',
    '/_uploads/960/../package.json.webp',
    '/_uploads/960/%2e%2e/package.json.webp',
    '/_uploads/960/..%2Fpackage.json.webp',
    '/_uploads/960/a%5C..%5Cpackage.json.webp',
    '/_uploads/960/a//b.png.webp',
    '/_uploads/960/%00.png.webp',
    '/_uploads/960/%E0%A4%A.png.webp',
    '/uploads/960/photo.png.webp',
  ]) {
    assert.equal(parseVariantPath(pathname), undefined, pathname);
  }
});
