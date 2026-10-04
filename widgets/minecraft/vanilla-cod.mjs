import * as THREE from 'three';

// Java CodModel's 32×32 texture layout, expressed in its original pixel units.
const PARTS = [
  { name: 'body', uv: [0, 0], box: [-1, -2, 0, 2, 4, 7], pivot: [0, 0, 0] },
  { name: 'head', uv: [11, 0], box: [-1, -2, -3, 2, 4, 3], pivot: [0, 0, 0] },
  { name: 'nose', uv: [0, 0], box: [-1, -2, -1, 2, 3, 1], pivot: [0, 0, -3] },
  { name: 'right_fin', uv: [22, 1], box: [-2, 0, -1, 2, 0, 2], pivot: [-1, 1, 0], roll: -Math.PI / 4 },
  { name: 'left_fin', uv: [22, 4], box: [0, 0, -1, 2, 0, 2], pivot: [1, 1, 0], roll: Math.PI / 4 },
  { name: 'tail_fin', uv: [22, 3], box: [0, -2, 0, 0, 4, 4], pivot: [0, 0, 7] },
  { name: 'top_fin', uv: [20, -6], box: [0, -1, -1, 0, 1, 6], pivot: [0, -2, 0] },
];

function codPartGeometry(part) {
  const [x, y, z, width, height, depth] = part.box;
  const [u, v] = part.uv;
  const vertices = [[x, y, z], [x + width, y, z], [x + width, y + height, z], [x, y + height, z],
    [x, y, z + depth], [x + width, y, z + depth], [x + width, y + height, z + depth], [x, y + height, z + depth]];
  const a = u + depth, b = a + width, c = b + width, d = b + depth, e = d + width;
  const f = v + depth, g = f + height;
  const faces = [
    { corners: [5, 4, 0, 1], uv: [a, v, b, f], area: width * depth, shade: 1 },
    { corners: [2, 3, 7, 6], uv: [b, f, c, v], area: width * depth, shade: .72 },
    { corners: [0, 4, 7, 3], uv: [u, f, a, g], area: depth * height, shade: .86 },
    { corners: [1, 0, 3, 2], uv: [a, f, b, g], area: width * height, shade: .92 },
    { corners: [5, 1, 2, 6], uv: [b, f, d, g], area: depth * height, shade: .86 },
    { corners: [4, 5, 6, 7], uv: [d, f, e, g], area: width * height, shade: .92 },
  ];
  const positions = [], uvs = [], colors = [], indices = [];
  const planar = width === 0 || height === 0 || depth === 0;
  let planeAdded = false;
  for (const face of faces) {
    if (!face.area || (planar && planeAdded)) continue;
    planeAdded = true;
    const offset = positions.length / 3;
    const [u0, v0, u1, v1] = face.uv;
    const textureCorners = [[u1, v0], [u0, v0], [u0, v1], [u1, v1]];
    for (const [i, vertex] of face.corners.entries()) {
      const [px, py, pz] = vertices[vertex];
      positions.push(px / 16, -py / 16, pz / 16);
      uvs.push(textureCorners[i][0] / 32, 1 - textureCorners[i][1] / 32);
      colors.push(face.shade, face.shade, face.shade);
    }
    // ModelPart uses downward-positive Y; reversing winding restores outward faces.
    indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createCod(view, { x, y = -.4, z, actionId = 'summer:fish', swimRoute = [], waterCells = [] }) {
  const group = new THREE.Group();
  group.name = 'cod';
  group.position.set(x, y, z);
  const material = view.material(view.textures['entity/fish/cod'], 1, { side: THREE.DoubleSide, vertexColors: true, alphaTest: .1 });
  let tail;
  for (const part of PARTS) {
    const mesh = new THREE.Mesh(view.own(codPartGeometry(part)), material);
    mesh.name = part.name;
    mesh.position.set(part.pivot[0] / 16, -part.pivot[1] / 16, (part.pivot[2] - 3.5) / 16);
    mesh.rotation.z = -(part.roll ?? 0);
    group.add(mesh);
    if (part.name === 'tail_fin') tail = mesh;
  }
  const hit = new THREE.Mesh(view.own(new THREE.BoxGeometry(.45, .42, 1.02)), view.own(new THREE.MeshBasicMaterial({ visible: false })));
  hit.userData.actionId = actionId;
  hit.name = 'cod-hit';
  group.add(hit);
  view.pickables.push(hit);
  view.scene.add(group);
  const position = group.position.clone();
  const previousPosition = position.clone();
  let previousHeading = 0;
  let renderHeading = 0;
  let accumulatedTime = 0;
  let navigationStarted = false;
  const route = swimRoute.map(point => Array.isArray(point) ? { x: point[0], z: point[1] } : point)
    .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z));
  const cells = waterCells.map(cell => Array.isArray(cell) ? cell : cell.split(':').map(Number));
  const minX = Math.min(...cells.map(cell => cell[0]));
  const minZ = Math.min(...cells.map(cell => cell[1]));
  const maxX = Math.max(...cells.map(cell => cell[0]));
  const maxZ = Math.max(...cells.map(cell => cell[1]));
  const rowWidth = maxX - minX + 1;
  const water = new Set(cells.map(([cx, cz]) => cx - minX + (cz - minZ) * rowWidth));
  const footprint = new Map();
  const point = new THREE.Vector3();
  for (const mesh of group.children) {
    if (mesh === hit) continue;
    for (const tailAngle of mesh === tail ? [-.45, 0, .45] : [0]) {
      mesh.rotation.y = tailAngle;
      mesh.updateMatrix();
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrix);
        for (const wobble of [-THREE.MathUtils.degToRad(4.3), 0, THREE.MathUtils.degToRad(4.3)]) {
          const px = point.x * Math.cos(wobble) + point.z * Math.sin(wobble);
          const pz = point.z * Math.cos(wobble) - point.x * Math.sin(wobble);
          footprint.set(`${px.toFixed(5)}:${pz.toFixed(5)}`, [px, pz]);
        }
      }
    }
  }
  tail.rotation.y = 0;
  const samples = [...footprint.values()];
  const fits = (px, pz, yaw) => {
    if (!water.size) return true;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    for (const [sx, sz] of samples) {
      const cx = Math.floor(px + sx * cos + sz * sin);
      const cz = Math.floor(pz + sz * cos - sx * sin);
      if (cx < minX || cx > maxX || cz < minZ || cz > maxZ || !water.has(cx - minX + (cz - minZ) * rowWidth)) return false;
    }
    return true;
  };
  const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
  let heading = 0;
  let speed = .36;
  let angularSpeed = 0;
  let lastTime = null;
  let reduced = false;
  let startledUntil = 0;
  let pace = 1;
  let routeIndex = route.length ? route.reduce((best, entry, index) =>
    Math.hypot(entry.x - x, entry.z - z) < Math.hypot(route[best].x - x, route[best].z - z) ? index : best, 0) : 0;
  let motion = route.length > 1 ? { ...route[(routeIndex + 1) % route.length], commanded: false } : null;
  if (motion) routeIndex = (routeIndex + 1) % route.length;
  const nextWaypoint = () => {
    if (route.length < 2) { motion = null; return; }
    for (let index = 0; index < route.length; index++) {
      routeIndex = (routeIndex + 1) % route.length;
      const target = route[routeIndex];
      if (Math.hypot(target.x - position.x, target.z - position.z) > .35) {
        motion = { ...target, commanded: false };
        return;
      }
    }
    motion = null;
  };
  const stepPosition = (seconds, reducedMotion) => {
    if (reducedMotion) {
      if (motion?.commanded) {
        position.set(motion.x, y, motion.z);
        motion.commanded = false;
      }
      speed = .36;
      angularSpeed = 0;
      startledUntil = 0;
      return;
    }
    if (!motion || !seconds) return;
    let dx = motion.x - position.x, dz = motion.z - position.z;
    const distance = Math.hypot(dx, dz);
    // Steer through waypoints without stopping at each one.
    if (distance < (route.length > 1 ? .32 : .08)) {
      nextWaypoint();
      if (!motion) { speed *= Math.exp(-seconds * 6); return; }
      dx = motion.x - position.x;
      dz = motion.z - position.z;
    }
    const desiredHeading = Math.atan2(-dx, -dz);
    const error = angleDelta(desiredHeading, heading);
    const turnLimit = 4.8;
    const desiredAngularSpeed = THREE.MathUtils.clamp(error * 5, -turnLimit, turnLimit);
    angularSpeed += (desiredAngularSpeed - angularSpeed) * (1 - Math.exp(-seconds * 12));
    const cruisingSpeed = speed + (.36 - speed) * (1 - Math.exp(-seconds * 3.5));
    const turns = [...new Set([angularSpeed, -turnLimit, turnLimit, -turnLimit / 2, turnLimit / 2, 0])];
    let best = null;
    for (const turn of turns) {
      const nextHeading = heading + turn * seconds;
      for (const fraction of [1, .75, .5, .28, .12]) {
        const candidateSpeed = cruisingSpeed * fraction;
        const travel = candidateSpeed * seconds;
        const nextX = position.x - Math.sin(nextHeading) * travel;
        const nextZ = position.z - Math.cos(nextHeading) * travel;
        if (!fits(nextX, nextZ, nextHeading)) continue;
        let clearAhead = true;
        for (const horizon of [.1, .22, .38]) {
          const futureHeading = nextHeading + turn * horizon;
          const futureX = nextX + (Math.abs(turn) > .001
            ? (Math.cos(futureHeading) - Math.cos(nextHeading)) / turn * candidateSpeed
            : -Math.sin(nextHeading) * candidateSpeed * horizon);
          const futureZ = nextZ + (Math.abs(turn) > .001
            ? (Math.sin(nextHeading) - Math.sin(futureHeading)) / turn * candidateSpeed
            : -Math.cos(nextHeading) * candidateSpeed * horizon);
          if (!fits(futureX, futureZ, futureHeading)) { clearAhead = false; break; }
        }
        if (!clearAhead) continue;
        const score = Math.abs(angleDelta(desiredHeading, nextHeading)) * 1.7
          + Math.abs(turn - angularSpeed) * .035 + (1 - fraction) * .48;
        if (!best || score < best.score) best = { x: nextX, z: nextZ, heading: nextHeading, speed: candidateSpeed, turn, score };
      }
    }
    if (best) {
      position.set(best.x, y, best.z);
      heading = best.heading;
      speed = best.speed;
      angularSpeed = best.turn;
    } else {
      // A bank can prevent advancing; retain forward steering at a very small radius.
      for (const turn of turns) {
        const nextHeading = heading + turn * seconds;
        if (!fits(position.x, position.z, nextHeading)) continue;
        heading = nextHeading;
        angularSpeed = turn;
        speed *= Math.exp(-seconds * 8);
        break;
      }
    }
  };
  const updatePosition = (now, reducedMotion) => {
    const elapsed = lastTime === null ? 0 : Math.max(0, Math.min(250, now - lastTime));
    lastTime = now;
    reduced = reducedMotion;
    if (reducedMotion) {
      stepPosition(0, true);
      previousPosition.copy(position);
      previousHeading = heading;
      renderHeading = heading;
      accumulatedTime = 0;
      navigationStarted = false;
      pace = 1;
      group.position.copy(position);
      return;
    }
    // Use fixed steps for consistent bank avoidance at any frame rate.
    const desiredPace = now < startledUntil ? 1.2 / .36 : 1;
    pace += (desiredPace - pace) * (1 - Math.exp(-elapsed / (desiredPace > pace ? 160 : 420)));
    if (!navigationStarted) {
      navigationStarted = true;
      previousPosition.copy(position);
      previousHeading = heading;
      stepPosition(.05, false);
    } else accumulatedTime += elapsed * pace;
    while (accumulatedTime >= 50) {
      accumulatedTime -= 50;
      previousPosition.copy(position);
      previousHeading = heading;
      stepPosition(.05, false);
    }
    const blend = accumulatedTime / 50;
    group.position.lerpVectors(previousPosition, position, blend);
    renderHeading = THREE.MathUtils.lerp(previousHeading, heading, blend);
  };
  const command = (nextX, nextZ, now) => {
    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) return;
    updatePosition(now, reduced);
    if (Math.hypot(nextX - position.x, nextZ - position.z) < .2) return;
    routeIndex = route.length ? route.reduce((best, entry, index) =>
      Math.hypot(entry.x - nextX, entry.z - nextZ) < Math.hypot(route[best].x - nextX, route[best].z - nextZ) ? index : best, 0) : 0;
    motion = { x: nextX, z: nextZ, commanded: true };
    startledUntil = now + 2000;
    if (reduced) updatePosition(now, true);
  };
  return {
    group,
    hit,
    moveTo: command,
    flee(now) {
      updatePosition(now, reduced);
      if (reduced) {
        const destination = route.find(target => Math.hypot(target.x - position.x, target.z - position.z) > .65);
        if (destination) command(destination.x, destination.z, now);
      } else if (motion) {
        // Repeated clicks extend the speed burst along the same route.
        startledUntil = now + 1350;
      }
    },
    tick(now, reducedMotion = false) {
      updatePosition(now, reducedMotion);
      const swimPhase = Math.sin(.6 * now / 50);
      // CodRenderer adds a 4.3-degree body yaw; CodModel swings its tail by .45 radians.
      group.rotation.y = renderHeading + (reducedMotion ? 0 : THREE.MathUtils.degToRad(4.3) * swimPhase);
      tail.rotation.y = reducedMotion ? 0 : -.45 * swimPhase;
    },
  };
}
