import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBreakableIce } from './breakable-ice.mjs';

function fixture(options = {}) {
  const resources = new Set();
  const view = {
    resources, scene: new THREE.Scene(), pickables: [], camera: new THREE.PerspectiveCamera(),
    textures: { 'block/ice': new THREE.Texture() },
    own(resource) { resources.add(resource); return resource; },
    release(resource) { resource.dispose(); resources.delete(resource); },
    material(map, _brightness, extra) { return this.own(new THREE.MeshBasicMaterial({ map, ...extra })); },
  };
  view.camera.position.set(5, 5, 5);
  view.camera.lookAt(1, 0, 1);
  view.camera.updateMatrixWorld(true);
  const pond = createBreakableIce(view, { cells: [[1, 1], [1, 2], [2, 2]], waterMap: new THREE.Texture(), ...options });
  return { pond, view, dispose() { resources.forEach(resource => resource.dispose()); } };
}

test('breaking one ice cell replaces its raycast surface and ground height without harvesting adjacent ice', () => {
  const { pond, view, dispose } = fixture();
  const ray = new THREE.Raycaster(new THREE.Vector3(1.5, 2, 1.5), new THREE.Vector3(0, -1, 0));
  view.scene.updateMatrixWorld(true);
  assert.equal(ray.intersectObjects(view.pickables, false)[0].object.userData.actionId, 'winter:ice');
  assert.equal(pond.groundAt(1.5, 1.5), 0);
  const result = pond.breakAt(1.5, 1.5, 100);
  assert.deepEqual(result.broken, { x: 1, z: 1 });
  assert.equal(result.drops, undefined, 'plain ice breaking creates water, not an item');
  assert.equal(pond.groundAt(1.5, 1.5), -.125);
  assert.equal(pond.groundAt(1.5, 2.5), 0);
  assert.equal(pond.groundAt(0, 0), undefined);
  assert.equal(pond.hasIce(1, 1), false);
  assert.equal(pond.hasIce(1, 2), true);
  assert.equal(pond.breakAt(1, 1, 120), null);
  assert.equal(pond.breakAt(-1, -1, 120), null);
  view.scene.updateMatrixWorld(true);
  const hits = ray.intersectObjects(view.pickables, false);
  assert.ok(hits.length > 0);
  assert.ok(hits.every(hit => hit.object.userData.water === true));
  dispose();
});

test('neighboring liquid cells share one continuous surface and rebuilt meshes release their previous resources', () => {
  const { pond, view, dispose } = fixture();
  const resourceCount = view.resources.size;
  let disposed = 0;
  pond.surfaces.forEach(mesh => mesh.geometry.addEventListener('dispose', () => disposed++));
  pond.breakAt(1, 1, 100, { reducedMotion: true });
  assert.equal(disposed, 2);
  assert.equal(view.resources.size, resourceCount);
  assert.equal(pond.surfaces[1].geometry.attributes.position.count, 24, 'no liquid wall against its ice neighbor');
  pond.breakAt(1, 2, 200, { reducedMotion: true });
  pond.breakAt(2, 2, 300, { reducedMotion: true });
  assert.equal(view.resources.size, resourceCount);
  assert.equal(view.scene.children.length, 3);
  assert.equal(view.pickables.length, 2);
  assert.equal(pond.surfaces[0].visible, false);
  assert.equal(pond.surfaces[0].geometry.attributes.position.count, 0);
  assert.equal(pond.surfaces[1].geometry.attributes.position.count, 66, 'three top quads and eight exterior side quads');
  const positions = pond.surfaces[1].geometry.attributes.position;
  const normals = pond.surfaces[1].geometry.attributes.normal;
  for (let index = 0; index < positions.count; index++) if (normals.getY(index) === 1) assert.equal(positions.getY(index), -.125);
  assert.equal(pond.nextWakeAt, 8100);
  dispose();
});

test('ice fragments remain bounded, expire, and disappear immediately under reduced motion', () => {
  const { pond, view, dispose } = fixture();
  const chips = view.scene.getObjectByName('ice-breaking-particles');
  pond.breakAt(1, 1, 0);
  assert.equal(chips.geometry.drawRange.count, 64 * 6);
  pond.breakAt(1, 2, 10);
  pond.breakAt(2, 2, 20);
  assert.equal(chips.geometry.drawRange.count, 128 * 6);
  assert.ok(pond.nextWakeAt >= 250 && pond.nextWakeAt <= 670);
  pond.tick(100);
  assert.ok([...chips.geometry.attributes.position.array].every(Number.isFinite));
  pond.tick(700);
  assert.equal(chips.geometry.drawRange.count, 0);
  assert.equal(pond.nextWakeAt, 8000);
  dispose();
  const reduced = fixture();
  reduced.pond.breakAt(1, 1, 0);
  reduced.pond.tick(1, true);
  assert.equal(reduced.view.scene.getObjectByName('ice-breaking-particles').geometry.drawRange.count, 0);
  assert.equal(reduced.pond.nextWakeAt, 8000);
  reduced.dispose();
});

test('each water cell refreezes at its own deadline and another break only restarts that cell', () => {
  const changes = [];
  const { pond, view, dispose } = fixture({ onSurfaceChange: change => changes.push(change) });
  const resourceCount = view.resources.size;
  assert.equal(pond.nextWakeAt, Infinity);
  pond.breakAt(1, 1, 100, { reducedMotion: true });
  pond.breakAt(1, 2, 1100, { reducedMotion: true });
  assert.equal(pond.nextWakeAt, 8100);
  pond.tick(8099, true);
  assert.equal(pond.hasIce(1, 1), false);
  assert.equal(changes.length, 2);
  pond.tick(8100, true);
  assert.equal(pond.hasIce(1, 1), true);
  assert.equal(pond.groundAt(1.5, 1.5), 0);
  assert.equal(pond.hasIce(1, 2), false);
  assert.equal(pond.nextWakeAt, 9100);
  pond.breakAt(1, 1, 8200, { reducedMotion: true });
  assert.equal(pond.nextWakeAt, 9100, 'a new break must not postpone another cell');
  pond.tick(9100, true);
  assert.equal(pond.hasIce(1, 2), true);
  assert.equal(pond.hasIce(1, 1), false);
  assert.equal(pond.nextWakeAt, 16200);
  pond.tick(16200, true);
  assert.equal(pond.nextWakeAt, Infinity);
  assert.equal(pond.surfaces[1].visible, false);
  assert.equal(pond.surfaces[0].geometry.attributes.position.count, 66);
  assert.equal(view.resources.size, resourceCount);
  assert.deepEqual(changes, [
    { x: 1, z: 1, height: -.125, frozen: false },
    { x: 1, z: 2, height: -.125, frozen: false },
    { x: 1, z: 1, height: 0, frozen: true },
    { x: 1, z: 1, height: -.125, frozen: false },
    { x: 1, z: 2, height: 0, frozen: true },
    { x: 1, z: 1, height: 0, frozen: true },
  ]);
  for (let cycle = 0; cycle < 10; cycle++) {
    const now = 17000 + cycle * 8100;
    pond.breakAt(2, 2, now, { reducedMotion: true });
    pond.tick(now + 8000, true);
    assert.equal(view.resources.size, resourceCount);
  }
  dispose();
});

test('whole fragment billboards collide with beds, adjacent ice and live world solids at uneven frame intervals', () => {
  const solidBoxes = [
    { minX: 0, maxX: 4, minY: -1, maxY: -.875, minZ: 0, maxZ: 3 },
    { minX: 0, maxX: 1, minY: -1, maxY: .125, minZ: 0, maxZ: 3 },
    { minX: 2, maxX: 3, minY: -1, maxY: .125, minZ: 1, maxZ: 2 },
    { minX: 1.3, maxX: 1.7, minY: .04, maxY: .48, minZ: 1.3, maxZ: 1.7 },
  ];
  const { pond, view, dispose } = fixture({ solidBoxes });
  const chips = view.scene.getObjectByName('ice-breaking-particles');
  const intactIce = [
    { minX: 1, maxX: 2, minY: -.875, maxY: 0, minZ: 2, maxZ: 3 },
    { minX: 2, maxX: 3, minY: -.875, maxY: 0, minZ: 2, maxZ: 3 },
  ];
  pond.breakAt(1, 1, 0);
  function assertClear(now) {
    const positions = chips.geometry.attributes.position;
    for (let chip = 0; chip < chips.geometry.drawRange.count / 6; chip++) {
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (let corner = 0; corner < 4; corner++) {
        const vertex = chip * 4 + corner;
        for (const [axis, getter] of [['X', 'getX'], ['Y', 'getY'], ['Z', 'getZ']]) {
          const value = positions[getter](vertex);
          assert.ok(Number.isFinite(value));
          bounds[`min${axis}`] = Math.min(bounds[`min${axis}`], value);
          bounds[`max${axis}`] = Math.max(bounds[`max${axis}`], value);
        }
      }
      assert.ok(bounds.minY >= -.875, `billboard sinks below the island bed at ${now}`);
      for (const box of [...solidBoxes, ...intactIce]) {
        const overlaps = ['X', 'Y', 'Z'].every(axis => bounds[`max${axis}`] > box[`min${axis}`] + .00001 && bounds[`min${axis}`] < box[`max${axis}`] - .00001);
        assert.equal(overlaps, false, `billboard ${chip} intersects a solid at ${now}`);
      }
    }
  }
  for (const now of [0, 9, 17, 49, 50, 83, 113, 161, 249, 311, 370, 459, 510, 599, 649]) {
    if (now === 83) solidBoxes.push({ minX: 1.02, maxX: 1.1, minY: -.875, maxY: .5, minZ: 1, maxZ: 2 });
    pond.tick(now);
    assertClear(now);
  }
  pond.tick(700);
  assert.equal(chips.geometry.drawRange.count, 0);
  dispose();
});
