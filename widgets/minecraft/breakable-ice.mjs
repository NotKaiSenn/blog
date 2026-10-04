import * as THREE from 'three';
import { createConnectedWaterGeometry } from './connected-water.mjs';

const TOP = 0;
const WATER_TOP = -.125;
const BOTTOM = -.875;
const CHIP_CAPACITY = 128;
const STEP_MS = 50;
const COLLISION_MARGIN = .0001;
const AXES = [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']];
const QUAD_CORNERS = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
const key = (x, z) => `${x}:${z}`;
const random = seed => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export function createBreakableIce(view, {
  cells, waterMap, waterTint = '#3f76e4', waterOpacity = .83,
  refreezeMs = 8000, solidBoxes = [], onSurfaceChange,
}) {
  const remaining = new Map(cells.map(([x, z]) => [key(x, z), [x, z]]));
  const melted = new Map();
  const freezeAt = new Map();
  const ice = new THREE.Mesh(view.own(createConnectedWaterGeometry(cells, TOP, BOTTOM)), view.material(view.textures['block/ice'], 1, {
    vertexColors: true, transparent: true, opacity: .92, depthWrite: false,
  }));
  ice.name = 'breakable-ice';
  ice.userData.water = false;
  ice.userData.actionId = 'winter:ice';
  const water = new THREE.Mesh(view.own(createConnectedWaterGeometry([])), view.material(waterMap, 1, {
    color: waterTint, vertexColors: true, transparent: true, opacity: waterOpacity, depthWrite: false,
  }));
  water.name = 'melted-ice-water';
  water.userData.water = true;
  water.visible = false;
  view.scene.add(ice, water);
  view.pickables.push(ice, water);

  const geometry = view.own(new THREE.BufferGeometry());
  const positions = new Float32Array(CHIP_CAPACITY * 12);
  const uvs = new Float32Array(CHIP_CAPACITY * 8);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  const indices = [];
  for (let index = 0; index < CHIP_CAPACITY; index++) {
    const vertex = index * 4;
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  const chips = new THREE.Mesh(geometry, view.material(view.textures['block/ice'], .85, { side: THREE.DoubleSide }));
  chips.name = 'ice-breaking-particles';
  chips.frustumCulled = false;
  view.scene.add(chips);
  const particles = [];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const extent = new THREE.Vector3();
  const point = new THREE.Vector3();
  const previousPoint = new THREE.Vector3();
  const renderPoint = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let sequence = 0;

  function overlapsBox(position, half, box, skipAxis) {
    return AXES.every(([axis, min, max]) => axis === skipAxis
      || (position[axis] > box[min] - half[axis] && position[axis] < box[max] + half[axis]));
  }

  function bounce(motion, axis) {
    if (!motion) return;
    motion[axis] *= -.18;
    if (axis === 'y') { motion.x *= .6; motion.z *= .6; }
    if (Math.abs(motion[axis]) < .008) motion[axis] = 0;
  }

  function constrainPoint(position, half, boxes, motion) {
    const floor = BOTTOM + half.y + COLLISION_MARGIN;
    if (position.y < floor) { position.y = floor; if (motion?.y < 0) bounce(motion, 'y'); }
    if (!boxes.some(box => overlapsBox(position, half, box))) return;
    let best;
    // Exit all touching solids so fragments cannot get trapped between them.
    for (const [axis, min, max] of AXES) for (const direction of [-1, 1]) {
      const original = position[axis];
      let candidate = original;
      for (let pass = 0; pass <= boxes.length; pass++) {
        let changed = false;
        position[axis] = candidate;
        for (const box of boxes) {
          if (!overlapsBox(position, half, box, axis)) continue;
          if (candidate <= box[min] - half[axis] || candidate >= box[max] + half[axis]) continue;
          candidate = direction > 0 ? box[max] + half[axis] + COLLISION_MARGIN : box[min] - half[axis] - COLLISION_MARGIN;
          position[axis] = candidate;
          changed = true;
        }
        if (!changed) break;
      }
      position[axis] = original;
      if (axis === 'y' && candidate < floor) continue;
      const distance = Math.abs(candidate - original);
      if (distance && (!best || distance < best.distance)) best = { axis, candidate, distance };
    }
    if (best) { position[best.axis] = best.candidate; bounce(motion, best.axis); }
  }

  function moveAxis(position, half, motion, axisIndex, boxes) {
    const [axis, min, max] = AXES[axisIndex];
    const delta = motion[axis];
    if (!delta) return;
    const start = position[axis];
    let end = start + delta;
    for (const box of boxes) {
      if (!overlapsBox(position, half, box, axis)) continue;
      const low = box[min] - half[axis] - COLLISION_MARGIN;
      const high = box[max] + half[axis] + COLLISION_MARGIN;
      if (delta > 0 && start <= low && end > low) end = Math.min(end, low);
      else if (delta < 0 && start >= high && end < high) end = Math.max(end, high);
    }
    if (axis === 'y') end = Math.max(end, BOTTOM + half.y + COLLISION_MARGIN);
    position[axis] = end;
    if (Math.abs(end - start - delta) > COLLISION_MARGIN / 2) bounce(motion, axis);
  }

  function freezeExpired(now) {
    const frozen = [];
    for (const [cellKey, deadline] of freezeAt) {
      if (now < deadline) continue;
      const cell = melted.get(cellKey);
      melted.delete(cellKey);
      freezeAt.delete(cellKey);
      remaining.set(cellKey, cell);
      frozen.push(cell);
    }
    if (!frozen.length) return;
    rebuildSurfaces();
    for (const [x, z] of frozen) onSurfaceChange?.({ x, z, height: TOP, frozen: true });
  }

  function replaceGeometry(mesh, replacement) {
    const old = mesh.geometry;
    mesh.geometry = view.own(replacement);
    if (view.release) view.release(old);
    else { old.dispose(); view.resources?.delete(old); }
  }

  function rebuildSurfaces() {
    const solidCells = [...remaining.values()];
    const liquidCells = [...melted.values()];
    replaceGeometry(ice, createConnectedWaterGeometry(solidCells, TOP, BOTTOM));
    replaceGeometry(water, createConnectedWaterGeometry(liquidCells, WATER_TOP, BOTTOM, solidCells));
    ice.visible = solidCells.length > 0;
    water.visible = liquidCells.length > 0;
  }

  function emit(x, z, now) {
    // Breaking a vanilla block emits a 4×4×4 grid of fragments from its own sprite.
    for (let ix = 0; ix < 4; ix++) for (let iy = 0; iy < 4; iy++) for (let iz = 0; iz < 4; iz++) {
      const seed = ++sequence;
      const px = x + (ix + .5) / 4;
      const py = BOTTOM + (iy + .5) / 4 * (TOP - BOTTOM);
      const pz = z + (iz + .5) / 4;
      const vx = (px - x - .5) * .3;
      const vy = .08 + (py - (TOP + BOTTOM) / 2) * .22;
      const vz = (pz - z - .5) * .3;
      if (particles.length === CHIP_CAPACITY) particles.shift();
      particles.push({
        x: px, y: py, z: pz, previousX: px, previousY: py, previousZ: pz,
        vx, vy, vz, steppedAt: now,
        expiresAt: now + 250 + random(seed + 1) * 400,
        size: .045 + random(seed + 2) * .035,
        u: random(seed + 3) * .75, v: random(seed + 4) * .75,
      });
    }
  }

  function tick(now, reducedMotion = false) {
    freezeExpired(now);
    if (reducedMotion) particles.length = 0;
    if (!particles.length) { geometry.setDrawRange(0, 0); return; }
    right.setFromMatrixColumn(view.camera.matrixWorld, 0);
    up.setFromMatrixColumn(view.camera.matrixWorld, 1);
    // Scenery adds colliders after the pond is built; read the shared array here.
    const boxes = [...solidBoxes, ...[...remaining.values()].map(([x, z]) => ({ minX: x, maxX: x + 1, minY: BOTTOM, maxY: TOP, minZ: z, maxZ: z + 1 }))];
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      if (now >= particle.expiresAt) { particles.splice(index, 1); continue; }
      extent.set((Math.abs(right.x) + Math.abs(up.x)) * particle.size, (Math.abs(right.y) + Math.abs(up.y)) * particle.size, (Math.abs(right.z) + Math.abs(up.z)) * particle.size);
      point.set(particle.x, particle.y, particle.z);
      previousPoint.set(particle.previousX, particle.previousY, particle.previousZ);
      velocity.set(particle.vx, particle.vy, particle.vz);
      constrainPoint(point, extent, boxes, velocity);
      constrainPoint(previousPoint, extent, boxes);
      while (now - particle.steppedAt >= STEP_MS) {
        previousPoint.copy(point);
        velocity.y -= .04;
        for (const axis of [1, 0, 2]) moveAxis(point, extent, velocity, axis, boxes);
        constrainPoint(point, extent, boxes, velocity);
        velocity.multiplyScalar(.98);
        particle.steppedAt += STEP_MS;
      }
      particle.x = point.x; particle.y = point.y; particle.z = point.z;
      particle.previousX = previousPoint.x; particle.previousY = previousPoint.y; particle.previousZ = previousPoint.z;
      particle.vx = velocity.x; particle.vy = velocity.y; particle.vz = velocity.z;
    }
    for (let index = 0; index < particles.length; index++) {
      const particle = particles[index];
      const alpha = Math.max(0, Math.min(1, (now - particle.steppedAt) / STEP_MS));
      renderPoint.set(THREE.MathUtils.lerp(particle.previousX, particle.x, alpha), THREE.MathUtils.lerp(particle.previousY, particle.y, alpha), THREE.MathUtils.lerp(particle.previousZ, particle.z, alpha));
      extent.set((Math.abs(right.x) + Math.abs(up.x)) * particle.size, (Math.abs(right.y) + Math.abs(up.y)) * particle.size, (Math.abs(right.z) + Math.abs(up.z)) * particle.size);
      // Interpolation can cut corners, so also constrain the rendered billboard.
      constrainPoint(renderPoint, extent, boxes);
      for (let corner = 0; corner < 4; corner++) {
        const [cx, cy, u, v] = QUAD_CORNERS[corner];
        const offset = index * 12 + corner * 3;
        positions[offset] = renderPoint.x + (right.x * cx + up.x * cy) * particle.size;
        positions[offset + 1] = renderPoint.y + (right.y * cx + up.y * cy) * particle.size;
        positions[offset + 2] = renderPoint.z + (right.z * cx + up.z * cy) * particle.size;
        uvs[index * 8 + corner * 2] = particle.u + u * .25;
        uvs[index * 8 + corner * 2 + 1] = particle.v + v * .25;
      }
    }
    geometry.setDrawRange(0, particles.length * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
  }

  return {
    surfaces: [ice, water],
    groundAt(x, z) {
      const cell = key(Math.floor(x), Math.floor(z));
      return remaining.has(cell) ? TOP : melted.has(cell) ? WATER_TOP : undefined;
    },
    hasIce(x, z) { return remaining.has(key(Math.floor(x), Math.floor(z))); },
    get nextWakeAt() { return Math.min(...freezeAt.values(), ...particles.map(particle => particle.expiresAt)); },
    breakAt(x, z, now, { reducedMotion = false } = {}) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      freezeExpired(now);
      const cellKey = key(Math.floor(x), Math.floor(z));
      if (melted.has(cellKey)) return null;
      let cell = remaining.get(cellKey);
      if (!cell) cell = [...remaining.values()].find(([cx, cz]) => x >= cx - .00001 && x <= cx + 1.00001 && z >= cz - .00001 && z <= cz + 1.00001);
      if (!cell) return null;
      const [cx, cz] = cell;
      remaining.delete(key(cx, cz));
      melted.set(key(cx, cz), cell);
      freezeAt.set(key(cx, cz), now + refreezeMs);
      rebuildSurfaces();
      onSurfaceChange?.({ x: cx, z: cz, height: WATER_TOP, frozen: false });
      if (!reducedMotion) emit(cx, cz, now);
      tick(now, reducedMotion);
      return { type: 'ice', broken: { x: cx, z: cz }, message: 'Ice broken.' };
    },
    tick,
  };
}
