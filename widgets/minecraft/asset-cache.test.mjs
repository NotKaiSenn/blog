import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonAssets, seasonIdFor } from './seasons.mjs';
import { loadImage, loadModel, modelURL, prefetchSeason, resolveAssetBase, textureURL } from './asset-cache.mjs';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function stubNetwork({ failImages = new Set(), failModels = new Set() } = {}) {
  const requests = [];
  globalThis.Image = class {
    set src(url) {
      requests.push(url);
      this.url = url;
      queueMicrotask(() => (failImages.has(url) ? this.onerror : this.onload)?.());
    }
  };
  globalThis.fetch = async url => {
    requests.push(url);
    return failModels.has(url) ? { ok: false } : { ok: true, json: async () => ({ url }) };
  };
  return requests;
}

test('each season lists exactly the textures and block models its scene uses', () => {
  const spring = seasonAssets('spring');
  assert.ok(spring.models.includes('crop'));
  assert.ok(spring.textures.includes('block/wheat_stage7') && spring.textures.includes('block/water_still') && spring.textures.includes('colormap/grass'));
  assert.equal(new Set(spring.textures).size, spring.textures.length, 'shared textures are requested once');
  const summer = seasonAssets('summer');
  assert.deepEqual(summer.models, []);
  assert.ok(!summer.textures.includes('block/wheat_stage0'));
  const autumn = seasonAssets('autumn');
  assert.ok(!autumn.textures.includes('block/water_still'));
  assert.deepEqual(autumn.models, [1, 2, 3, 4].map(part => `template_leaf_litter_${part}`));
  const winter = seasonAssets('winter');
  assert.deepEqual(winter.models, ['campfire', 'campfire_off', 'template_campfire']);
  assert.ok(!winter.textures.includes('block/grass_block_top'));
  assert.equal(seasonIdFor('monsoon'), 'spring');
  assert.deepEqual(seasonAssets('monsoon'), spring);
});

test('asset URLs resolve against the configured base', () => {
  assert.equal(textureURL('https://example.test/assets/', 'block/dirt'), 'https://example.test/assets/block/dirt.png');
  assert.equal(modelURL('https://example.test/assets/', 'crop'), 'https://example.test/assets/models/block/crop.json');
  assert.equal(resolveAssetBase('https://cdn.example.test/mc/'), 'https://cdn.example.test/mc/');
  assert.ok(resolveAssetBase(null).endsWith('/widgets/minecraft/assets/'));
});

test('images and models are requested once per page and retried after a failure', async () => {
  const failImages = new Set(['https://example.test/a/block/ice.png']);
  const failModels = new Set(['https://example.test/a/models/block/crop.json']);
  const requests = stubNetwork({ failImages, failModels });
  const image = await loadImage('https://example.test/a/block/dirt.png');
  assert.equal(image.crossOrigin, 'anonymous', 'WebGL may only read pixels from CORS-enabled images');
  assert.equal(await loadImage('https://example.test/a/block/dirt.png'), image);
  await assert.rejects(loadImage('https://example.test/a/block/ice.png'));
  await assert.rejects(loadModel('https://example.test/a/models/block/crop.json'));
  failImages.clear();
  failModels.clear();
  assert.ok(await loadImage('https://example.test/a/block/ice.png'));
  assert.deepEqual(await loadModel('https://example.test/a/models/block/crop.json'), { url: 'https://example.test/a/models/block/crop.json' });
  assert.deepEqual(requests, [
    'https://example.test/a/block/dirt.png',
    'https://example.test/a/block/ice.png',
    'https://example.test/a/models/block/crop.json',
    'https://example.test/a/block/ice.png',
    'https://example.test/a/models/block/crop.json',
  ]);
});

test('prefetching a season warms the cache the scene reads from and swallows failures', async () => {
  const base = 'https://example.test/b/';
  const failImages = new Set([textureURL(base, 'block/snow')]);
  const requests = stubNetwork({ failImages });
  prefetchSeason('winter', base);
  await flush();
  const { textures, models } = seasonAssets('winter');
  assert.equal(requests.length, textures.length + models.length);
  await loadModel(modelURL(base, 'campfire'));
  await loadImage(textureURL(base, 'block/ice'));
  assert.equal(requests.length, textures.length + models.length, 'the scene reuses prefetched files');
  failImages.clear();
  await loadImage(textureURL(base, 'block/snow'));
  assert.equal(requests.length, textures.length + models.length + 1);
  assert.equal(requests.at(-1), textureURL(base, 'block/snow'), 'a failed prefetch is retried by the scene');
});
