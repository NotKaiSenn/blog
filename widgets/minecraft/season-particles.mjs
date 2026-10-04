import * as THREE from 'three';

export const SEASON_PARTICLE_TEXTURES = {
  spring: Array.from({ length: 12 }, (_, index) => `particle/cherry_${index}`),
  summer: ['environment/rain'],
  autumn: Array.from({ length: 12 }, (_, index) => `particle/leaf_${index}`),
  winter: ['environment/snow'],
};

const LEAF_CAPACITY = 24;
const STEP_MS = 50;
const random = seed => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const gaussian = (seed, second) => Math.sqrt(-2 * Math.log(Math.max(.00001, random(seed)))) * Math.cos(Math.PI * 2 * random(second));

function particleAtlas(view, paths) {
  const images = paths.map(path => view.textures[path].image);
  const side = Math.max(...images.map(image => Math.max(image.width, image.height)));
  const stride = side + 2;
  const canvas = document.createElement('canvas');
  canvas.width = stride * 4;
  canvas.height = stride * Math.ceil(paths.length / 4);
  const context = canvas.getContext('2d');
  const frames = images.map((image, index) => {
    const x = index % 4 * stride + 1;
    const y = Math.floor(index / 4) * stride + 1;
    context.drawImage(image, x, y, side, side);
    return [x / canvas.width, 1 - (y + side) / canvas.height, (x + side) / canvas.width, 1 - y / canvas.height];
  });
  const map = view.own(new THREE.CanvasTexture(canvas));
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  return { map, frames };
}

function quadGeometry(view, capacity) {
  const geometry = view.own(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(capacity * 8), 2).setUsage(THREE.DynamicDrawUsage));
  const indices = [];
  for (let index = 0; index < capacity; index++) {
    const vertex = index * 4;
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function createLeaves(view, { season, leaves, groundAt, leafTint, leafInterval }) {
  const cherry = season === 'spring';
  const atlas = particleAtlas(view, SEASON_PARTICLE_TEXTURES[season]);
  const geometry = quadGeometry(view, LEAF_CAPACITY);
  const material = view.material(atlas.map, 1, {
    color: season === 'spring' ? '#ffffff' : leafTint,
    side: THREE.DoubleSide,
    alphaTest: .1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = `${season}-falling-leaves`;
  view.scene.add(mesh);
  const particles = [];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const positions = geometry.attributes.position.array;
  const uvs = geometry.attributes.uv.array;
  let sequence = 0;
  let untilNext = 300;

  function emit(count = 1) {
    if (!leaves.length) return;
    for (let index = 0; index < count && particles.length < LEAF_CAPACITY; index++) {
      const seed = ++sequence * 19.73;
      const emitter = leaves[Math.floor(random(seed + 1) * leaves.length)];
      const point = Array.isArray(emitter) ? { x: emitter[0], y: emitter[1], z: emitter[2] } : emitter;
      const x = point.x + .1 + random(seed + 2) * .8;
      const y = point.y - .04;
      const z = point.z + .1 + random(seed + 3) * .8;
      particles.push({
        x, y, z, previousX: x, previousY: y, previousZ: z,
        vx: 0, vy: cherry ? 0 : -.021, vz: 0, age: 0,
        roll: 0, previousRoll: 0,
        rotationSpeed: (random(seed + 4) < .5 ? -1 : 1) * Math.PI / 6,
        spinAcceleration: (random(seed + 5) < .5 ? -1 : 1) * Math.PI / 36,
        windAngle: random(seed + 6) * Math.PI / 3,
        swirlPeriod: (1000 + random(seed + 6) * 3000) * Math.PI / 180,
        size: (cherry ? 1 : 2) * (random(seed + 7) < .5 ? .05 : .075),
        sprite: Math.floor(random(seed + 8) * 12),
      });
    }
  }

  function step() {
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.previousX = particle.x;
      particle.previousY = particle.y;
      particle.previousZ = particle.z;
      particle.previousRoll = particle.roll;
      particle.age++;
      // The vanilla leaf is a rolling camera-facing sprite, accelerated once per game tick.
      const progress = Math.min(particle.age / 300, 1);
      const wind = cherry ? 2 * Math.pow(progress, 1.25) * .0025 : progress * 10 * .0025;
      const angle = cherry ? particle.windAngle : progress * particle.swirlPeriod;
      particle.vx += Math.cos(angle) * wind;
      particle.vz += Math.sin(angle) * wind;
      particle.vy -= (cherry ? .25 : .07) * 1.2 * .0025;
      particle.rotationSpeed += particle.spinAcceleration / 20;
      particle.roll += particle.rotationSpeed / 20;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.z += particle.vz;
      const floor = groundAt(particle.x, particle.z);
      if (particle.age >= 300 || particle.y <= floor + .01 || particle.y < -1.2) particles.splice(index, 1);
    }
  }

  function render(alpha) {
    right.setFromMatrixColumn(view.camera.matrixWorld, 0);
    up.setFromMatrixColumn(view.camera.matrixWorld, 1);
    for (let index = 0; index < particles.length; index++) {
      const particle = particles[index];
      const x = THREE.MathUtils.lerp(particle.previousX, particle.x, alpha);
      const y = THREE.MathUtils.lerp(particle.previousY, particle.y, alpha);
      const z = THREE.MathUtils.lerp(particle.previousZ, particle.z, alpha);
      const roll = THREE.MathUtils.lerp(particle.previousRoll, particle.roll, alpha);
      const c = Math.cos(roll) * particle.size;
      const s = Math.sin(roll) * particle.size;
      const [u0, v0, u1, v1] = atlas.frames[particle.sprite];
      const corners = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
      for (let corner = 0; corner < 4; corner++) {
        const [cx, cy, u, v] = corners[corner];
        const horizontal = cx * c - cy * s;
        const vertical = cx * s + cy * c;
        const positionOffset = index * 12 + corner * 3;
        positions[positionOffset] = x + right.x * horizontal + up.x * vertical;
        positions[positionOffset + 1] = y + right.y * horizontal + up.y * vertical;
        positions[positionOffset + 2] = z + right.z * horizontal + up.z * vertical;
        uvs[index * 8 + corner * 2] = u;
        uvs[index * 8 + corner * 2 + 1] = v;
      }
    }
    geometry.setDrawRange(0, particles.length * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
  }

  // Start with a few leaves at different heights.
  emit(1);
  for (let index = 0; index < 20; index++) step();
  emit(1);
  for (let index = 0; index < 10; index++) step();
  emit(1);
  render(1);
  return {
    step() {
      step();
      untilNext -= STEP_MS;
      if (untilNext <= 0) {
        emit(1);
        untilNext = leafInterval * (.75 + random(++sequence) * .5);
      }
    },
    render,
  };
}

function createWindLeaves(view, { leafTint, direction, bounds, height, heightSpread, speed }) {
  const capacity = 6;
  const atlas = particleAtlas(view, SEASON_PARTICLE_TEXTURES.autumn);
  const geometry = quadGeometry(view, capacity);
  const colors = new Float32Array(capacity * 4 * 4).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
  const tint = new THREE.Color(leafTint).lerp(new THREE.Color('#e7cc89'), .55).multiplyScalar(2);
  const mesh = new THREE.Mesh(geometry, view.material(atlas.map, 1, {
    color: tint, vertexColors: true, transparent: true,
    depthWrite: false, alphaTest: .01, side: THREE.DoubleSide,
  }));
  mesh.name = 'autumn-wind-leaves';
  mesh.frustumCulled = false;
  view.scene.add(mesh);
  const particles = [];
  const positions = geometry.attributes.position.array;
  const uvs = geometry.attributes.uv.array;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const length = Math.hypot(...direction) || 1;
  const windX = direction[0] / length, windZ = direction[1] / length;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const crossSpan = Math.abs(windZ) * (bounds.maxX - bounds.minX) + Math.abs(windX) * (bounds.maxZ - bounds.minZ);
  let sequence = 0;
  let untilNext = 0;

  function emitLeaf() {
    const seed = ++sequence * 43.7;
    if (particles.length < capacity) {
      // Cycle across the full wind front instead of stacking leaves in one lane.
      const lane = (((sequence * 3 % 5) + .2 + random(seed + 2) * .6) / 5 - .5) * crossSpan * .94;
      const x = centerX - windZ * lane;
      const z = centerZ + windX * lane;
      let entry = -Infinity, exit = Infinity;
      for (const [origin, velocity, min, max] of [[x, windX, bounds.minX, bounds.maxX], [z, windZ, bounds.minZ, bounds.maxZ]]) {
        if (Math.abs(velocity) < .00001) continue;
        const a = (min - origin) / velocity, b = (max - origin) / velocity;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
      if (Number.isFinite(entry) && Number.isFinite(exit) && exit > entry) {
        const duration = (exit - entry) / (speed * (.95 + random(seed + 3) * .1)) * 1000;
        const level = ((sequence * 2 % 5) + .2 + random(seed + 5) * .6) / 5 - .5;
        particles.push({
          x: x + windX * entry, z: z + windZ * entry,
          distance: exit - entry, age: 0, previousAge: 0, duration,
          height: height + level * heightSpread - (z > 2.4 ? .3 : 0),
          roll: random(seed + 6) * Math.PI * 2,
          spin: (random(seed + 7) < .5 ? -1 : 1) * (.4 + random(seed + 8) * .4),
          phase: random(seed + 9) * Math.PI * 2,
          size: .15 + random(seed + 10) * .04,
          sprite: Math.floor(random(seed + 11) * 12),
        });
      }
    }
    untilNext += 380 + random(seed + 12) * 170;
  }

  function step() {
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.previousAge = particle.age;
      particle.age += STEP_MS;
      if (particle.age >= particle.duration) particles.splice(index, 1);
    }
    untilNext -= STEP_MS;
    if (untilNext <= 0) emitLeaf();
  }

  emitLeaf();
  for (let index = 0; index < 26; index++) step();
  return {
    step,
    render(alpha) {
      right.setFromMatrixColumn(view.camera.matrixWorld, 0);
      up.setFromMatrixColumn(view.camera.matrixWorld, 1);
      let visible = 0;
      for (const particle of particles) {
        const age = THREE.MathUtils.lerp(particle.previousAge, particle.age, alpha);
        const progress = Math.min(age / particle.duration, 1);
        const x = particle.x + windX * particle.distance * progress;
        const z = particle.z + windZ * particle.distance * progress;
        const y = particle.height + Math.sin(progress * Math.PI * 2 + particle.phase) * .04;
        const roll = particle.roll + age / 1000 * particle.spin;
        const flutter = .8 + Math.cos(age / 450 + particle.phase) * .2;
        const opacity = Math.max(0, Math.min(age / 220, (particle.duration - age) / 300, 1));
        const [u0, v0, u1, v1] = atlas.frames[particle.sprite];
        const corners = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
        for (let corner = 0; corner < 4; corner++) {
          const [cx, cy, u, v] = corners[corner];
          const horizontal = (cx * flutter * Math.cos(roll) - cy * Math.sin(roll)) * particle.size;
          const vertical = (cx * flutter * Math.sin(roll) + cy * Math.cos(roll)) * particle.size;
          const offset = visible * 12 + corner * 3;
          positions[offset] = x + right.x * horizontal + up.x * vertical;
          positions[offset + 1] = y + right.y * horizontal + up.y * vertical;
          positions[offset + 2] = z + right.z * horizontal + up.z * vertical;
          uvs[visible * 8 + corner * 2] = u;
          uvs[visible * 8 + corner * 2 + 1] = v;
          colors[visible * 16 + corner * 4 + 3] = opacity;
        }
        visible++;
      }
      geometry.setDrawRange(0, visible * 6);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.uv.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

function createWeather(view, { season, weatherCells, weatherGroundAt, weatherTop, weatherOpacity, weatherScale }) {
  const snow = season === 'winter';
  const source = view.textures[snow ? 'environment/snow' : 'environment/rain'];
  const map = view.own(source.clone());
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;
  const geometry = quadGeometry(view, weatherCells.length);
  const material = view.material(map, 1, {
    transparent: true, opacity: weatherOpacity ?? (snow ? .8 : .65),
    depthWrite: false, alphaTest: .01, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${snow ? 'snow' : 'rain'}-weather-columns`;
  mesh.frustumCulled = false;
  view.scene.add(mesh);
  const right = new THREE.Vector3().setFromMatrixColumn(view.camera.matrixWorld, 0);
  right.y = 0;
  right.normalize().multiplyScalar(.5);
  const positions = geometry.attributes.position.array;
  const uvs = geometry.attributes.uv.array;
  const columns = [];
  const candidates = weatherCells.map(([x, z]) => {
    const seed = x * x * 3121 + x * 45238971 + z * z * 418711 + z * 13761;
    return { x, z, bottom: undefined, seed, phase: random(seed + 4), horizontalPhase: random(seed + 10), speed: 3 + random(seed + 5), driftX: gaussian(seed + 6, seed + 7), driftY: gaussian(seed + 8, seed + 9) };
  });
  function updateGround() {
    let changed = false;
    for (const column of candidates) {
      const bottom = weatherGroundAt(column.x + .5, column.z + .5);
      if (!Object.is(bottom, column.bottom)) {
        column.bottom = bottom;
        changed = true;
      }
    }
    if (!changed) return;
    columns.length = 0;
    for (const column of candidates) {
      const { x, z, bottom } = column;
      if (!Number.isFinite(bottom) || bottom >= weatherTop) continue;
      positions.set([
        x + .5 - right.x, weatherTop, z + .5 - right.z,
        x + .5 + right.x, weatherTop, z + .5 + right.z,
        x + .5 + right.x, bottom, z + .5 + right.z,
        x + .5 - right.x, bottom, z + .5 - right.z,
      ], columns.length * 12);
      columns.push(column);
    }
    geometry.setDrawRange(0, columns.length * 6);
    geometry.attributes.position.needsUpdate = true;
  }
  updateGround();
  return {
    tick(time) {
      updateGround();
      const ticks = time / STEP_MS;
      for (let index = 0; index < columns.length; index++) {
        const column = columns[index];
        // Enlarge the original texels for the widget; scale UV motion equally to retain fall speed.
        const horizontal = column.horizontalPhase + (snow ? ticks * .01 * column.driftX / weatherScale : 0);
        const verticalMotion = snow ? -ticks / 512 + ticks * column.driftY * .001 : -(ticks + column.seed % 32) / 32 * column.speed;
        const topV = 1 - column.phase - (column.bottom * .25 + verticalMotion) / weatherScale;
        const bottomV = 1 - column.phase - (weatherTop * .25 + verticalMotion) / weatherScale;
        uvs.set([horizontal, topV, horizontal + 1 / weatherScale, topV, horizontal + 1 / weatherScale, bottomV, horizontal, bottomV], index * 8);
      }
      geometry.attributes.uv.needsUpdate = true;
    },
  };
}

export function createSeasonParticles(view, {
  season,
  leaves = [],
  groundAt = () => 0,
  leafMode = season === 'autumn' ? 'wind' : 'falling',
  leafGroundAt = groundAt,
  leafWindDirection = [1, 0],
  leafWindBounds = { minX: -.8, maxX: 4.8, minZ: .05, maxZ: 3.2 },
  leafWindHeight = 1.7,
  leafWindHeightSpread = .7,
  leafWindSpeed = 3.8,
  leafTint = '#9caa55',
  leafInterval = season === 'spring' ? 1050 : 1550,
  weatherCells = [],
  weatherGroundAt = groundAt,
  weatherTop = season === 'winter' ? 3.75 : 3.2,
  weatherOpacity,
  weatherScale = season === 'winter' ? 4 : 3,
} = {}) {
  const windLeaves = season === 'autumn' && (leafMode === 'wind' || leafMode === 'ground');
  const leafSystem = windLeaves
    ? createWindLeaves(view, { leafTint, direction: leafWindDirection, bounds: leafWindBounds, height: leafWindHeight, heightSpread: leafWindHeightSpread, speed: leafWindSpeed })
    : leaves.length && (season === 'spring' || season === 'autumn')
      ? createLeaves(view, { season, leaves, groundAt: leafGroundAt, leafTint, leafInterval })
      : null;
  const weather = weatherCells.length && (season === 'summer' || season === 'winter')
    ? createWeather(view, { season, weatherCells, weatherGroundAt, weatherTop, weatherOpacity, weatherScale }) : null;
  let previousTime;
  let elapsed = 0;
  let remainder = 0;
  return {
    tick(now, reducedMotion = false) {
      const delta = previousTime === undefined ? 0 : Math.max(0, Math.min(now - previousTime, 100));
      previousTime = now;
      if (!reducedMotion) {
        elapsed += delta;
        remainder += delta;
        while (remainder >= STEP_MS) {
          leafSystem?.step();
          remainder -= STEP_MS;
        }
      }
      leafSystem?.render(reducedMotion ? 1 : remainder / STEP_MS);
      weather?.tick(elapsed);
    },
  };
}
