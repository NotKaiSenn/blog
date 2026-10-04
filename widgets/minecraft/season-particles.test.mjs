import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSeasonParticles } from './season-particles.mjs';

function weatherView() {
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 20);
  camera.position.set(5, 4, 6);
  camera.lookAt(1, 1, 1);
  camera.updateMatrixWorld();
  return {
    camera,
    scene: new THREE.Scene(),
    textures: { 'environment/rain': new THREE.Texture(), 'environment/snow': new THREE.Texture() },
    own: resource => resource,
    material: (map, _brightness, options) => new THREE.MeshBasicMaterial({ map, ...options }),
  };
}

test('weather atlas falls downward and stops at water or canopy height', () => {
  const view = weatherView();
  const particles = createSeasonParticles(view, {
    season: 'summer',
    weatherTop: 3,
    weatherCells: [[0, 0], [1, 0]],
    weatherGroundAt: x => x < 1 ? 2 : -.125,
  });
  const mesh = view.scene.children[0];
  const positions = mesh.geometry.attributes.position.array;
  const uv = mesh.geometry.attributes.uv.array;
  particles.tick(0);
  const firstV = uv[1];
  const uvPerBlock = (uv[1] - uv[5]) / (positions[1] - positions[7]);
  assert.equal(positions[7], 2);
  assert.equal(positions[19], -.125);
  assert.ok(Math.abs(uvPerBlock - .25 / 3) < .000001, 'default rain texels are three times larger');
  particles.tick(50);
  const displacement = -(uv[1] - firstV) / uvPerBlock;
  assert.ok(displacement < 0, 'a fixed atlas texel moves down in world space');
  assert.ok(displacement >= -.5 && displacement <= -.375, 'rain retains vanilla 7.5–10 blocks/second speed');
});

test('reduced motion freezes weather scrolling and excludes fully covered columns', () => {
  const view = weatherView();
  const particles = createSeasonParticles(view, {
    season: 'winter', weatherTop: 3,
    weatherCells: [[0, 0], [1, 0]],
    weatherGroundAt: x => x < 1 ? 3.125 : .125,
  });
  const mesh = view.scene.children[0];
  assert.equal(mesh.geometry.drawRange.count, 6);
  particles.tick(0);
  particles.tick(50);
  const uv = [...mesh.geometry.attributes.uv.array];
  assert.ok(Math.abs((uv[2] - uv[0]) - .25) < .000001, 'default snow texels are four times larger');
  particles.tick(100, true);
  particles.tick(10000, true);
  assert.deepEqual([...mesh.geometry.attributes.uv.array], uv);
});

test('weather size can be tuned without changing world-space fall or drift speed', () => {
  for (const season of ['summer', 'winter']) {
    const velocities = [1, 3, 4].map(weatherScale => {
      const view = weatherView();
      const particles = createSeasonParticles(view, {
        season, weatherScale, weatherTop: 3,
        weatherCells: [[1, 0]], weatherGroundAt: () => 0,
      });
      const geometry = view.scene.children[0].geometry;
      const uv = geometry.attributes.uv.array;
      particles.tick(0);
      const firstU = uv[0], firstV = uv[1];
      const uvPerBlockX = uv[2] - uv[0];
      const uvPerBlockY = (uv[1] - uv[5]) / 3;
      particles.tick(50);
      return [-(uv[0] - firstU) / uvPerBlockX, -(uv[1] - firstV) / uvPerBlockY];
    });
    for (const velocity of velocities.slice(1)) {
      assert.ok(Math.abs(velocity[0] - velocities[0][0]) < .00001);
      assert.ok(Math.abs(velocity[1] - velocities[0][1]) < .00001);
    }
  }
});

test('snow follows the lowered water surface when an ice block breaks', () => {
  const view = weatherView();
  let surface = 0;
  const particles = createSeasonParticles(view, {
    season: 'winter', weatherCells: [[1, 1]], weatherGroundAt: () => surface,
  });
  const position = view.scene.children[0].geometry.attributes.position;
  particles.tick(0);
  const version = position.version;
  particles.tick(50);
  assert.equal(position.version, version, 'unchanged terrain does not reupload geometry');
  surface = -.125;
  particles.tick(100);
  assert.equal(position.array[7], -.125);
  assert.equal(position.array[10], -.125);
  assert.equal(position.version, version + 1);
});

function autumnWindView(t) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const view = weatherView();
  for (let index = 0; index < 12; index++) view.textures[`particle/leaf_${index}`] = new THREE.Texture({ width: 5, height: 5 });
  const particles = createSeasonParticles(view, {
    season: 'autumn', leafWindHeight: 1.7, leafWindHeightSpread: .7, leafWindSpeed: 3.8,
    leafWindDirection: [1, 0],
    leafWindBounds: { minX: -.8, maxX: 4.8, minZ: .05, maxZ: 3.2 },
  });
  return { particles, geometry: view.scene.children[0].geometry };
}

function quadCenters(geometry) {
  const positions = geometry.attributes.position.array;
  return Array.from({ length: geometry.drawRange.count / 6 }, (_, index) => {
    const center = [0, 0, 0];
    for (let corner = 0; corner < 4; corner++) {
      for (let axis = 0; axis < 3; axis++) center[axis] += positions[index * 12 + corner * 3 + axis] / 4;
    }
    return center;
  });
}

test('autumn wind stays sparse, spreads across height and depth, and carries leaves quickly in one direction', t => {
  const { particles, geometry } = autumnWindView(t);
  let previous = [], previousOpacity = [], motionSamples = 0, readableFrames = 0;
  let minHeight = Infinity, maxHeight = -Infinity, maxDepthSpan = 0, maxHeightSpan = 0;
  for (let time = 0; time <= 30000; time += 50) {
    particles.tick(time);
    const centers = quadCenters(geometry);
    assert.ok(centers.length <= 6, 'continuous emission cannot build up into a dense cluster');
    if (centers.length >= 2) {
      readableFrames++;
      maxDepthSpan = Math.max(maxDepthSpan, Math.max(...centers.map(center => center[2])) - Math.min(...centers.map(center => center[2])));
      maxHeightSpan = Math.max(maxHeightSpan, Math.max(...centers.map(center => center[1])) - Math.min(...centers.map(center => center[1])));
    }
    for (let index = 0; index < centers.length; index++) {
      minHeight = Math.min(minHeight, centers[index][1]);
      maxHeight = Math.max(maxHeight, centers[index][1]);
      for (let other = index + 1; other < centers.length; other++) {
        const separation = Math.hypot(...centers[index].map((value, axis) => value - centers[other][axis]));
        assert.ok(separation > .4, 'leaves do not overlap into a short string');
      }
    }
    // Fixed Z lanes identify surviving particles; skip frames with a simultaneous exit and entry.
    const sameLeaves = centers.length && centers.length === previous.length
      && centers.every((center, index) => Math.abs(center[2] - previous[index][2]) < .000001);
    if (time >= 100 && sameLeaves) {
      for (let index = 0; index < centers.length; index++) {
        if (previousOpacity[index] === 0) continue;
        const speed = (centers[index][0] - previous[index][0]) / .05;
        assert.ok(speed >= 3.4 && speed <= 4.2, 'every surviving leaf travels with the same strong positive X wind');
        motionSamples++;
      }
    }
    previous = centers;
    previousOpacity = centers.map((_, index) => geometry.attributes.color.array[index * 16 + 3]);
  }
  assert.ok(motionSamples > 100 && readableFrames > 100, 'checks sustained airflow rather than only its first emission');
  assert.ok(maxDepthSpan > 1.4, 'the wind field spans multiple depth lanes at once');
  assert.ok(maxHeightSpan > .3 && maxHeight - minHeight > .5, 'leaves occupy clearly separated low and high layers');
});

test('continuous wind leaves fade at boundaries, expire without accumulation and freeze with reduced motion', t => {
  const { particles, geometry } = autumnWindView(t);
  let previous = [], expirations = 0, seenEntrance = false, seenExitFade = false;
  for (let time = 0; time <= 30000; time += 50) {
    particles.tick(time);
    const centers = quadCenters(geometry);
    assert.ok(centers.length <= 6);
    for (let index = 0; index < centers.length; index++) {
      const [x, y, z] = centers[index];
      assert.ok(x >= -.800001 && x <= 4.800001, 'live particles remain within the airflow bounds');
      assert.ok(y >= .95 && y <= 2.15);
      assert.ok(z >= .049999 && z <= 3.200001);
      const opacity = geometry.attributes.color.array[index * 16 + 3];
      if (x < .2 && opacity > 0 && opacity < 1) seenEntrance = true;
      if (x > 3.5 && opacity > 0 && opacity < 1) seenExitFade = true;
    }
    for (const old of previous) {
      if (centers.some(center => Math.abs(center[2] - old[2]) < .000001)) continue;
      assert.ok(old[0] > 4.3, 'a leaf expires only after crossing the scene');
      expirations++;
    }
    previous = centers;
  }
  assert.ok(expirations > 20 && seenEntrance && seenExitFade, 'new leaves continuously replace faded leaves at opposite boundaries');
  particles.tick(30050, true);
  const positions = [...geometry.attributes.position.array];
  const colors = [...geometry.attributes.color.array];
  const count = geometry.drawRange.count;
  particles.tick(100000, true);
  assert.deepEqual([...geometry.attributes.position.array], positions);
  assert.deepEqual([...geometry.attributes.color.array], colors);
  assert.equal(geometry.drawRange.count, count);
});
