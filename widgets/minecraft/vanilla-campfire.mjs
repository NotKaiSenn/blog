import * as THREE from 'three';

const FACE_SHADE = { down: .5, up: 1, north: .8, south: .8, west: .6, east: .6 };
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function faceCorners(direction, from, to) {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  return {
    north: [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]],
    south: [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]],
    east: [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]],
    west: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    up: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    down: [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],
  }[direction];
}

function buildModel(view, model, maps) {
  const group = new THREE.Group();
  const buckets = new Map();
  for (const element of model.elements) {
    for (const [direction, face] of Object.entries(element.faces)) {
      const texture = model.textures[face.texture.slice(1)].replace(/^minecraft:/, '');
      if (!buckets.has(texture)) buckets.set(texture, { positions: [], uv: [], colors: [], indices: [] });
      const bucket = buckets.get(texture);
      const offset = bucket.positions.length / 3;
      const [u0, v0, u1, v1] = face.uv;
      const uvCorners = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      const shade = element.shade === false ? 1 : FACE_SHADE[direction];
      for (const [index, corner] of faceCorners(direction, element.from, element.to).entries()) {
        const point = new THREE.Vector3(...corner);
        if (element.rotation) {
          const { origin, axis, angle, rescale } = element.rotation;
          const pivot = new THREE.Vector3(...origin);
          const radians = THREE.MathUtils.degToRad(angle);
          point.sub(pivot).applyAxisAngle(AXES[axis], radians);
          if (rescale) {
            const scale = 1 / Math.cos(radians);
            for (const component of ['x', 'y', 'z']) if (component !== axis) point[component] *= scale;
          }
          point.add(pivot);
        }
        bucket.positions.push(point.x / 16, point.y / 16, point.z / 16);
        const [u, v] = uvCorners[(index + (face.rotation ?? 0) / 90) % 4];
        bucket.uv.push(u / 16, 1 - v / 16);
        bucket.colors.push(shade, shade, shade);
      }
      bucket.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  }
  for (const [texture, bucket] of buckets) {
    const geometry = view.own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.setIndex(bucket.indices);
    geometry.computeBoundingSphere();
    const material = view.material(maps[texture], 1, { vertexColors: true, alphaTest: .1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = texture;
    group.add(mesh);
  }
  return group;
}

function fireAnimation(view) {
  const map = view.own(view.textures['block/campfire_fire'].clone());
  const frames = map.image.height / map.image.width;
  map.repeat.set(1, 1 / frames);
  let previous = -1;
  return {
    map,
    tick(now) {
      // campfire_fire.png.mcmeta: two game ticks per frame.
      const frame = Math.floor(now / 100) % frames;
      if (frame === previous) return;
      map.offset.y = 1 - (frame + 1) / frames;
      previous = frame;
    },
  };
}

function emberAnimation(view) {
  const source = view.textures['block/campfire_log_lit'];
  const size = source.image.width;
  const frames = source.image.height / size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const map = view.own(new THREE.CanvasTexture(canvas));
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  let previous = -1;
  return {
    map,
    tick(now) {
      // The lit log texture interpolates between its frames on the 20 Hz game tick.
      const tick = Math.floor(now / 50);
      if (tick === previous) return;
      const frame = Math.floor(tick / 20) % frames;
      context.globalAlpha = 1;
      context.drawImage(source.image, 0, frame * size, size, size, 0, 0, size, size);
      context.globalAlpha = (tick % 20) / 20;
      context.drawImage(source.image, 0, ((frame + 1) % frames) * size, size, size, 0, 0, size, size);
      context.globalAlpha = 1;
      map.needsUpdate = true;
      previous = tick;
    },
  };
}

export function createCampfire(view, { x, y = 0, z, actionId }) {
  const { campfire, campfire_off: offModel, template_campfire: template } = view.blockModels;
  const onModel = {
    ...template,
    ...campfire,
    elements: campfire.elements ?? template.elements,
    textures: { ...template.textures, ...campfire.textures },
  };
  const fire = fireAnimation(view);
  const embers = emberAnimation(view);
  const maps = {
    'block/campfire_log': view.textures['block/campfire_log'],
    'block/campfire_log_lit': embers.map,
    'block/campfire_fire': fire.map,
  };
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const on = buildModel(view, onModel, maps);
  const off = buildModel(view, offModel, maps);
  off.visible = false;
  group.add(on, off);

  // Campfire's stable 7/16-block selection shape excludes its transparent flame sprite.
  const hit = new THREE.Mesh(view.own(new THREE.BoxGeometry(1, 7 / 16, 1)), view.own(new THREE.MeshBasicMaterial({ visible: false })));
  hit.position.set(.5, 7 / 32, .5);
  hit.userData.actionId = actionId;
  group.add(hit);
  view.pickables.push(hit);
  view.scene.add(group);

  let lit = true;
  const result = {
    group,
    hit,
    get lit() { return lit; },
    setLit(value) {
      lit = Boolean(value);
      on.visible = lit;
      off.visible = !lit;
    },
    tick(now, reducedMotion = false) {
      if (!lit) return;
      fire.tick(reducedMotion ? 0 : now);
      embers.tick(reducedMotion ? 0 : now);
    },
  };
  result.tick(0);
  return result;
}
