import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createCampfire } from './vanilla-campfire.mjs';

const modelNames = ['campfire', 'campfire_off', 'template_campfire'];
const textureNames = ['campfire_log', 'campfire_log_lit', 'campfire_fire'];

function fixture() {
  const draws = [];
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage: (...args) => draws.push(args) }) }) };
  const resources = new Set();
  const view = {
    scene: new THREE.Scene(), pickables: [],
    blockModels: Object.fromEntries(modelNames.map(name => [name, JSON.parse(readFileSync(new URL(`./assets/models/block/${name}.json`, import.meta.url), 'utf8'))])),
    textures: Object.fromEntries(textureNames.map(name => {
      const png = readFileSync(new URL(`./assets/block/${name}.png`, import.meta.url));
      return [`block/${name}`, new THREE.Texture({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) })];
    })),
    own(value) { resources.add(value); return value; },
    material(map, _brightness, extra) { return this.own(new THREE.MeshBasicMaterial({ map, ...extra })); },
  };
  const fire = createCampfire(view, { x: 3, y: .125, z: 1, actionId: 'winter:campfire' });
  return {
    view, fire, draws,
    cleanup() {
      globalThis.document = oldDocument;
      for (const resource of resources) resource.dispose();
      for (const texture of Object.values(view.textures)) texture.dispose();
    },
  };
}

test('campfire uses the log end UV region and rotated bark strips, with correctly rescaled flame planes', () => {
  const { fire, cleanup } = fixture();
  try {
    const [on, off] = fire.group.children;
    assert.equal(on.children.length, 3);
    assert.equal(off.children.length, 1);
    const logs = off.children[0].geometry;
    assert.deepEqual(Array.from(logs.attributes.uv.array.slice(0, 8)), [0, .75, 0, .5, .25, .5, .25, .75]);
    assert.deepEqual(Array.from(logs.attributes.uv.array.slice(32, 40)), [0, .75, 1, .75, 1, 1, 0, 1]);
    logs.computeBoundingBox();
    assert.deepEqual(logs.boundingBox.min.toArray(), [0, 0, 0]);
    assert.deepEqual(logs.boundingBox.max.toArray(), [1, 7 / 16, 1]);
    const flames = on.getObjectByName('block/campfire_fire').geometry;
    flames.computeBoundingBox();
    for (const axis of ['x', 'z']) {
      assert.ok(Math.abs(flames.boundingBox.min[axis] - .05) < 1e-6);
      assert.ok(Math.abs(flames.boundingBox.max[axis] - .95) < 1e-6);
    }
    assert.equal(flames.boundingBox.min.y, 1 / 16);
    assert.equal(flames.boundingBox.max.y, 17 / 16);
    assert.equal(flames.index.count, 24);
  } finally { cleanup(); }
});

test('switching a campfire preserves one low selection box and freezes animation when unlit', () => {
  const { view, fire, draws, cleanup } = fixture();
  try {
    const [on, off] = fire.group.children;
    const flameMap = on.getObjectByName('block/campfire_fire').material.map;
    const initialOffset = flameMap.offset.y;
    fire.tick(100);
    assert.notEqual(flameMap.offset.y, initialOffset);
    const drawCount = draws.length;
    fire.setLit(false);
    assert.equal(fire.lit, false);
    assert.equal(on.visible, false);
    assert.equal(off.visible, true);
    fire.tick(1200);
    assert.equal(draws.length, drawCount);
    assert.deepEqual(view.pickables, [fire.hit]);
    assert.equal(fire.hit.geometry.parameters.height, 7 / 16);
    fire.setLit(true);
    fire.tick(1400, true);
    assert.equal(on.visible, true);
    assert.equal(off.visible, false);
    assert.equal(flameMap.offset.y, initialOffset);
    assert.deepEqual(view.pickables, [fire.hit]);
  } finally { cleanup(); }
});
