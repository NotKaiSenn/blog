import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCod } from './vanilla-cod.mjs';

const route = [[2.35, 2.5], [1.45, 2.5], [.55, 2.5], [1.45, 2.5], [2.35, 2.5], [2.4, 1.5]];
const pond = new Set(['1:1', '2:1', '0:2', '1:2', '2:2']);

function fixture(swimRoute = []) {
  const resources = new Set();
  const view = {
    scene: new THREE.Scene(), pickables: [], textures: { 'entity/fish/cod': new THREE.Texture() },
    own(value) { resources.add(value); return value; },
    material(map, _brightness, extra) { return this.own(new THREE.MeshBasicMaterial({ map, ...extra })); },
  };
  const fish = createCod(view, { x: 2.35, y: -.38, z: 2.5, swimRoute, waterCells: [...pond] });
  return { fish, cleanup() { for (const resource of resources) resource.dispose(); view.textures['entity/fish/cod'].dispose(); } };
}

test('cod swims autonomously, turns gradually, and keeps its full model inside the connected pond', () => {
  const { fish, cleanup } = fixture(route);
  try {
    const point = new THREE.Vector3();
    let previousYaw = 0;
    let minX = 2.35;
    let minZ = 2.5;
    for (let now = 0; now <= 30000; now += 50) {
      fish.tick(now);
      const angle = fish.group.rotation.y - previousYaw;
      assert.ok(Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < .4, 'heading must not snap at route corners');
      previousYaw = fish.group.rotation.y;
      minX = Math.min(minX, fish.group.position.x);
      minZ = Math.min(minZ, fish.group.position.z);
      fish.group.updateMatrixWorld(true);
      for (const mesh of fish.group.children) {
        if (mesh === fish.hit) continue;
        const positions = mesh.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          assert.ok(pond.has(`${Math.floor(point.x)}:${Math.floor(point.z)}`), 'body and fins must stay over water');
        }
      }
      assert.equal(fish.group.position.y, -.38);
    }
    assert.ok(minX <= 1.0, 'fish should reach the western end without clicking');
    assert.ok(minZ <= 1.85, 'fish should visit the upper pond');
  } finally { cleanup(); }
});

test('frightened cod keeps moving through turns and returns to cruising without a fixed stop', () => {
  const point = new THREE.Vector3();
  for (const phase of [0, 1200, 4400, 10000, 16700, 24000]) {
    const { fish, cleanup } = fixture(route);
    try {
      for (let now = 0; now <= phase; now += 50) fish.tick(now);
      const initialPosition = fish.group.position.clone();
      const initialYaw = fish.group.rotation.y;
      fish.flee(phase);
      assert.deepEqual(fish.group.position.toArray(), initialPosition.toArray());
      assert.equal(fish.group.rotation.y, initialYaw);
      let stoppedFor = 0;
      let travelled = 0;
      for (let now = phase + 50; now <= phase + 8000; now += 50) {
        const previous = fish.group.position.clone();
        const previousYaw = fish.group.rotation.y;
        fish.tick(now);
        const movement = fish.group.position.clone().sub(previous);
        const distance = movement.length();
        if (now === phase + 50) assert.ok(distance > .001, 'click should respond on the next frame');
        travelled += distance;
        stoppedFor = distance < .00025 ? stoppedFor + 50 : 0;
        assert.ok(stoppedFor <= 100, 'frightened movement and recovery must not freeze');
        const yawDelta = fish.group.rotation.y - previousYaw;
        assert.ok(Math.abs(Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta))) < .85, 'turns must remain continuous');
        if (distance > .00001) {
          const forward = new THREE.Vector3(-Math.sin(fish.group.rotation.y), 0, -Math.cos(fish.group.rotation.y));
          assert.ok(movement.normalize().dot(forward) > .9, 'fish should swim forwards, not slide sideways');
        }
        fish.group.updateMatrixWorld(true);
        for (const mesh of fish.group.children) {
          if (mesh === fish.hit) continue;
          const positions = mesh.geometry.getAttribute('position');
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            assert.ok(pond.has(`${Math.floor(point.x)}:${Math.floor(point.z)}`), 'body and fins must stay over water while fleeing');
          }
        }
      }
      assert.ok(travelled > 2.5, 'fish must continue cruising after the fright response');
    } finally { cleanup(); }
  }
});

test('reduced motion freezes autonomous swimming while click commands change position immediately', () => {
  const { fish, cleanup } = fixture(route);
  try {
    fish.tick(0, true);
    const initialPosition = fish.group.position.clone();
    fish.tick(9000, true);
    assert.deepEqual(fish.group.position.toArray(), initialPosition.toArray());
    fish.flee(9050);
    assert.ok(fish.group.position.distanceTo(initialPosition) > .65);
    const destination = fish.group.position.clone();
    fish.tick(20000, true);
    assert.deepEqual(fish.group.position.toArray(), destination.toArray());
    assert.equal(fish.group.getObjectByName('tail_fin').rotation.y, 0);
    fish.moveTo(2.4, 1.5, 20100);
    assert.deepEqual(fish.group.position.toArray(), [2.4, -.38, 1.5]);
    fish.tick(30000, true);
    assert.deepEqual(fish.group.position.toArray(), [2.4, -.38, 1.5]);
  } finally { cleanup(); }
});

test('rapid repeated scares do not trap a fish against the concave pond bank', () => {
  const { fish, cleanup } = fixture(route);
  try {
    let nextClick = 500;
    let stoppedFor = 0;
    for (let now = 0; now < 30000; now += 33) {
      const previous = fish.group.position.clone();
      if (now >= nextClick) { fish.flee(now); nextClick += 713; }
      fish.tick(now);
      const distance = fish.group.position.distanceTo(previous);
      stoppedFor = distance < .00015 ? stoppedFor + 33 : 0;
      assert.ok(stoppedFor < 100, 'repeated destination changes must not trap the fish at the inner corner');
    }
  } finally { cleanup(); }
});

test('five-minute swims stay bounded and moving at 120 Hz and irregular display frame times', () => {
  const scenarios = [
    { deltas: [1000 / 120], clicks: [] },
    { deltas: [1000 / 120], clicks: [10000, 20000] },
    { deltas: [4, 17, 8, 11, 33, 7, 19], clicks: Array.from({ length: 430 }, (_, index) => 500 + index * 713) },
  ];
  const point = new THREE.Vector3();
  for (const scenario of scenarios) {
    const { fish, cleanup } = fixture(route);
    try {
      let now = 0, frame = 0, click = 0, windowEnd = 2200, progress = 0;
      fish.tick(0);
      while (now < 300000) {
        now += scenario.deltas[frame++ % scenario.deltas.length];
        const previous = fish.group.position.clone();
        if (now >= scenario.clicks[click]) { fish.flee(now); click++; }
        fish.tick(now);
        progress += fish.group.position.distanceTo(previous);
        if (now >= windowEnd) {
          assert.ok(progress > .3, 'every 2.2-second window must include continuous swimming');
          progress = 0;
          windowEnd += 2200;
        }
        fish.group.updateMatrixWorld(true);
        for (const mesh of fish.group.children) {
          if (mesh === fish.hit) continue;
          const positions = mesh.geometry.getAttribute('position');
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            assert.ok(pond.has(`${Math.floor(point.x)}:${Math.floor(point.z)}`), 'interpolated fish body and fins must stay in water');
          }
        }
      }
    } finally { cleanup(); }
  }
});
