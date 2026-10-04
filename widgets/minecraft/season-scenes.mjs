import * as THREE from 'three';
import { createConnectedWaterGeometry } from './connected-water.mjs';
import { createCampfire } from './vanilla-campfire.mjs';
import { sampleGrassTint, tintGrassTexture } from './grass-materials.mjs';
import { createSeasonParticles, SEASON_PARTICLE_TEXTURES } from './season-particles.mjs';
import { createCod } from './vanilla-cod.mjs';
import { createBreakableIce } from './breakable-ice.mjs';

const commonTextures = ['block/stone'];

export const SEASONS = {
  spring: {
    label: 'Spring', grassClimate: { temperature: .7, downfall: .8 }, waterTint: '#3685eb',
    actionId: 'spring:wheat', actionLabel: 'Harvest wheat',
    cameraTarget: [1.6, .62, 1.1], halfHeight: 3.05,
    plots: [{ x: 2, z: 1, stage: 2 }, { x: 2, z: 2, stage: 4 }], autoGrowMs: 2600,
    textures: [...commonTextures, ...SEASON_PARTICLE_TEXTURES.spring, 'block/cherry_log', 'block/cherry_log_top', 'block/cherry_leaves', 'block/pink_petals', 'block/oxeye_daisy', 'block/azure_bluet', 'block/fern'],
  },
  summer: {
    label: 'Summer', grassClimate: { temperature: .95, downfall: .9 }, waterTint: '#258dec',
    actionId: 'summer:melon', actionLabel: 'Pick melon',
    actions: [{ id: 'summer:cane', label: 'Harvest sugar cane' }, { id: 'summer:fish', label: 'Nudge fish' }],
    cameraTarget: [1.9, .58, 1.3], halfHeight: 2.85,
    plots: [],
    textures: [...commonTextures, ...SEASON_PARTICLE_TEXTURES.summer, 'block/melon_side', 'block/melon_top', 'item/melon_slice', 'block/sand', 'block/lily_pad', 'block/sugar_cane', 'item/sugar_cane', 'entity/fish/cod', 'block/cornflower', 'block/oxeye_daisy'],
  },
  autumn: {
    label: 'Autumn', grassClimate: { temperature: .8, downfall: .4 }, waterTint: '#3f76e4',
    actionId: 'autumn:pumpkin', actionLabel: 'Toggle pumpkin light',
    actions: [{ id: 'autumn:mushroom', label: 'Pick mushroom' }],
    cameraTarget: [1.9, .3, 1.4], halfHeight: 2.7,
    plots: [],
    textures: [...commonTextures, ...SEASON_PARTICLE_TEXTURES.autumn, 'colormap/dry_foliage', 'block/leaf_litter', 'block/coarse_dirt', 'block/oak_log', 'block/oak_log_top', 'block/pumpkin_side', 'block/pumpkin_top', 'block/carved_pumpkin', 'block/jack_o_lantern', 'block/dead_bush', 'block/fern', 'block/mossy_cobblestone', 'block/brown_mushroom', 'block/red_mushroom'],
  },
  winter: {
    label: 'Winter', grassClimate: { temperature: .25, downfall: .8 }, waterTint: '#286be9',
    actionId: 'winter:campfire', actionLabel: 'Toggle campfire',
    actions: [{ id: 'winter:ice', label: 'Break ice' }],
    cameraTarget: [2.15, .38, 1.15], halfHeight: 3.05,
    plots: [],
    textures: [...commonTextures, ...SEASON_PARTICLE_TEXTURES.winter, 'block/spruce_log', 'block/spruce_log_top', 'block/spruce_leaves', 'block/spruce_sapling', 'block/snow', 'block/grass_block_snow', 'block/ice', 'block/coarse_dirt', 'block/campfire_log', 'block/campfire_log_lit', 'block/campfire_fire'],
  },
};

const shadeByFace = [.6, .6, 1, .5, .8, .8];
const hash = value => { const n = Math.sin(value * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

export function buildSeasonScenery(view, seasonId, state) {
  const season = SEASONS[seasonId] ?? SEASONS.spring;
  const geometries = new Map();
  const materials = new Map();
  const groundHeights = new Map();
  const solidBoxes = [];
  const animations = [];
  const leafSources = [];
  const weatherHeights = new Map();
  let icePond;
  const actionId = season.actionId;
  const key = (x, z) => `${x}:${z}`;
  const texture = name => view.textures[`block/${name}`];

  function boxGeometry(width = 1, height = 1, depth = 1) {
    const id = `${width}:${height}:${depth}`;
    if (!geometries.has(id)) geometries.set(id, view.own(new THREE.BoxGeometry(width, height, depth)));
    return geometries.get(id);
  }

  function faceMaterials(side, top = side, bottom = side, tint = null, options = {}) {
    const id = `${side}:${top}:${bottom}:${tint}:${JSON.stringify(options)}`;
    if (!materials.has(id)) {
      materials.set(id, shadeByFace.map((shade, face) => view.material(texture(face === 2 ? top : face === 3 ? bottom : side), shade, {
        ...options,
        ...(tint ? { color: new THREE.Color(tint).multiplyScalar(shade) } : {}),
      })));
    }
    return materials.get(id);
  }

  function addBox(x, y, z, material, dimensions = [1, 1, 1], action = null) {
    const mesh = new THREE.Mesh(boxGeometry(...dimensions), material);
    mesh.position.set(x, y, z);
    if (seasonId === 'winter') {
      const [width, height, depth] = dimensions;
      solidBoxes.push({ minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2, maxY: y + height / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
    }
    if (action) mesh.userData.actionId = action;
    view.scene.add(mesh);
    view.pickables.push(mesh);
    return mesh;
  }

  function plant(x, z, name, size = 1, y = 0, grassTint = false, action = null) {
    const id = `plant:${name}:${grassTint}`;
    if (!materials.has(id)) {
      let map = texture(name);
      if (grassTint) {
        map = view.own(new THREE.CanvasTexture(tintGrassTexture(map.image, view.grassTint)));
        map.colorSpace = THREE.SRGBColorSpace;
        map.magFilter = map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
      }
      materials.set(id, view.material(map, 1, { side: THREE.DoubleSide }));
    }
    const geometryId = `plant:${size}`;
    if (!geometries.has(geometryId)) geometries.set(geometryId, view.own(new THREE.PlaneGeometry(.9 * Math.SQRT2 * size, size)));
    const group = new THREE.Group();
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const mesh = new THREE.Mesh(geometries.get(geometryId), materials.get(id));
      mesh.rotation.y = angle;
      mesh.position.set(x + .5, y + size / 2, z + .5);
      group.add(mesh);
    }
    view.scene.add(group);
    if (action) {
      const mushroom = name.endsWith('_mushroom');
      const hitHeight = mushroom ? 6 / 16 : size;
      const hitWidth = mushroom ? 6 / 16 : .7;
      const hit = new THREE.Mesh(boxGeometry(hitWidth, hitHeight, hitWidth), view.own(new THREE.MeshBasicMaterial({ visible: false })));
      hit.position.set(x + .5, y + hitHeight / 2, z + .5);
      hit.userData.actionId = action;
      group.add(hit); view.pickables.push(hit); group.userData.hit = hit;
    }
    return group;
  }

  function animatedTexture(name, frameDuration) {
    const map = view.own(texture(name).clone());
    const frames = Math.max(1, Math.floor(map.image.height / map.image.width));
    map.repeat.set(1 - 1 / map.image.width, (map.image.width - 1) / map.image.height);
    map.offset.set(.5 / map.image.width, 1 - 1 / frames + .5 / map.image.height);
    map.needsUpdate = true;
    animations.push({ map, frames, frameDuration, previous: -1 });
    return map;
  }

  function addWaterBed(x, z) {
    if (!geometries.has('water-bed')) {
      const geometry = view.own(new THREE.BoxGeometry(1, .125, 1));
      const uv = geometry.attributes.uv;
      // Show the bottom two texture rows at full pixel scale on the cutaway sides.
      for (const face of [0, 1, 4, 5]) {
        for (let i = face * 4; i < face * 4 + 4; i++) uv.setY(i, uv.getY(i) * .125);
      }
      geometries.set('water-bed', geometry);
    }
    const bed = addBox(x + .5, -.9375, z + .5, faceMaterials('stone'), [1, .125, 1]);
    bed.geometry = geometries.get('water-bed');
  }

  function addWater(cells) {
    const top = -.125;
    const map = animatedTexture('water_still', 100);
    const material = view.material(map, 1, {
      color: season.waterTint,
      vertexColors: true, transparent: true, opacity: seasonId === 'summer' ? .68 : .86, depthWrite: false,
    });
    const geometry = view.own(createConnectedWaterGeometry(cells, top, -.875));
    const surface = new THREE.Mesh(geometry, material);
    surface.userData.water = true;
    view.scene.add(surface); view.pickables.push(surface);
    for (const [x, z] of cells) {
      addWaterBed(x, z);
      groundHeights.set(key(x, z), top);
    }
  }

  function grassGeometry(x, z) {
    const turns = Math.floor(hash(x * 83 + z * 43 + 17) * 4);
    const id = `grass:${turns}`;
    if (!geometries.has(id)) {
      const geometry = view.own(new THREE.BoxGeometry(1, 1, 1));
      const uv = geometry.attributes.uv;
      for (let index = 8; index < 12; index++) {
        let u = uv.getX(index), v = uv.getY(index);
        for (let turn = 0; turn < turns; turn++) [u, v] = [1 - v, u];
        uv.setXY(index, u, v);
      }
      geometries.set(id, geometry);
    }
    return geometries.get(id);
  }

  const waterCells = seasonId === 'spring' ? ['0:1', '0:2', '1:2'] : seasonId === 'summer' ? ['1:1', '2:1', '0:2', '1:2', '2:2'] : [];
  const iceCells = seasonId === 'winter' ? ['1:1', '1:2', '2:2'] : [];
  const holes = seasonId === 'winter' ? ['0:0'] : seasonId === 'summer' || seasonId === 'autumn' ? ['3:2'] : ['3:0'];
  const pathCells = seasonId === 'autumn' ? ['0:1', '1:1', '1:2', '2:1', '3:1'] : seasonId === 'winter' ? ['0:2'] : [];
  const sandCells = seasonId === 'summer' ? ['3:0', '3:1'] : [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 3; z++) {
      const cell = key(x, z);
      if (holes.includes(cell) || waterCells.includes(cell) || iceCells.includes(cell)) continue;
      const winter = seasonId === 'winter';
      const path = pathCells.includes(cell);
      const sand = sandCells.includes(cell);
      const plot = state.plots.find(plot => plot.x === x && plot.z === z);
      if (plot) {
        const farm = addBox(x + .5, -17 / 32, z + .5, view.farmMaterials, [1, 15 / 16, 1]);
        if (!geometries.has('farmland')) {
          const geometry = view.own(new THREE.BoxGeometry(1, 15 / 16, 1));
          for (const face of [0, 1, 4, 5]) for (let i = face * 4; i < face * 4 + 4; i++) geometry.attributes.uv.setY(i, geometry.attributes.uv.getY(i) * 15 / 16);
          geometries.set('farmland', geometry);
        }
        farm.geometry = geometries.get('farmland');
        farm.userData.plotId = plot.id;
        groundHeights.set(cell, -1 / 16);
        continue;
      }
      const blockMaterials = path ? faceMaterials('coarse_dirt') : sand ? faceMaterials('sand') : winter ? faceMaterials('grass_block_snow', 'snow', 'dirt') : view.grassMaterials;
      const block = addBox(x + .5, -.5, z + .5, blockMaterials);
      if (!path && !sand && !winter) block.geometry = grassGeometry(x, z);
      groundHeights.set(cell, 0);
      if (winter && !path) {
        addBox(x + .5, 1 / 16, z + .5, faceMaterials('snow'), [1, .125, 1]);
        groundHeights.set(cell, .125);
      }
    }
  }
  if (waterCells.length) addWater(waterCells.map(cell => cell.split(':').map(Number)));
  if (iceCells.length) {
    const cells = iceCells.map(cell => cell.split(':').map(Number));
    icePond = createBreakableIce(view, {
      cells,
      waterMap: animatedTexture('water_still', 100),
      waterTint: season.waterTint,
      solidBoxes,
      refreezeMs: 8000,
      onSurfaceChange: ({ x, z, height }) => groundHeights.set(key(x, z), height),
    });
    for (const [x, z] of cells) {
      addWaterBed(x, z);
      groundHeights.set(key(x, z), 0);
    }
  }

  function leaf(x, y, z, kind, tint) {
    leafSources.push({ x, y, z });
    weatherHeights.set(key(x, z), Math.max(weatherHeights.get(key(x, z)) ?? 0, y + 1.125));
    addBox(x + .5, y + .5, z + .5, faceMaterials(`${kind}_leaves`, `${kind}_leaves`, `${kind}_leaves`, tint, { side: THREE.DoubleSide }));
  }

  let interact = () => null;
  let updateScenery = () => {};
  let nextWakeAt = () => Infinity;

  if (seasonId === 'spring') {
    addBox(.5, .5, .5, faceMaterials('cherry_log', 'cherry_log_top', 'cherry_log_top'));
    for (const [x, z] of [[-1, 0], [0, -1], [0, 0], [1, 0], [0, 1]]) leaf(x, 1, z, 'cherry');
    leaf(0, 2, 0, 'cherry');
    const petalsMaterial = view.material(texture('pink_petals'), 1, { side: THREE.DoubleSide });
    const petalsGeometry = view.own(new THREE.PlaneGeometry(.8, .8));
    for (const [x, z, rotation] of [[1.55, .55, 0], [1.4, 1.5, 1.2], [3.5, 1.45, .6]]) {
      const petals = new THREE.Mesh(petalsGeometry, petalsMaterial);
      petals.rotation.set(-Math.PI / 2, 0, rotation);
      petals.position.set(x, .012, z);
      view.scene.add(petals);
    }
    plant(3.02, 2.03, 'oxeye_daisy');
    plant(1.01, 1.03, 'azure_bluet');
    plant(2.01, .02, 'fern', 1, 0, true);
    plant(3.01, 1.02, 'azure_bluet');
  }

  if (seasonId === 'summer') {
    const melons = [.5, 1.5].map((x, index) => ({ mesh: addBox(x, .5, .5, faceMaterials('melon_side', 'melon_top', 'melon_top'), [1, 1, 1], `${actionId}:${index}`), regrowAt: 0 }));
    plant(.04, 1.03, 'oxeye_daisy');
    plant(2.01, .01, 'cornflower');
    plant(3, 1, 'sugar_cane', 1, 0, true, 'summer:cane');
    const caneSegments = [1, 2].map(height => ({ group: plant(3, 1, 'sugar_cane', 1, height, true, 'summer:cane'), height, regrowAt: 0 }));
    let caneRegrowAt = 0;
    nextWakeAt = () => Math.min(...caneSegments.map(segment => segment.regrowAt || Infinity), ...melons.map(fruit => fruit.regrowAt || Infinity));
    const lily = new THREE.Mesh(view.own(new THREE.PlaneGeometry(1, 1)), view.material(texture('lily_pad'), 1, { color: '#208030', side: THREE.DoubleSide }));
    lily.rotation.x = -Math.PI / 2;
    lily.rotation.z = Math.PI / 2;
    lily.position.set(1.5, -.125 + .25 / 16, 1.5);
    view.scene.add(lily);
    const fishRoute = [[2.35, 2.5], [1.45, 2.5], [.55, 2.5], [1.45, 2.5], [2.35, 2.5], [2.4, 1.5]];
    const fish = createCod(view, { x: 2.35, y: -.38, z: 2.5, actionId: 'summer:fish', swimRoute: fishRoute, waterCells });
    let nextMelon = 0;
    interact = (id, now) => {
      if (id === 'summer:cane') {
        if (caneRegrowAt) return { type: 'cane', message: 'Sugar cane growing.' };
        for (const segment of caneSegments) {
          segment.group.visible = false;
          view.pickables.splice(view.pickables.indexOf(segment.group.userData.hit), 1);
          segment.regrowAt = now + 4200 + (segment.height - 1) * 2200;
        }
        caneRegrowAt = now + 6400;
        return { type: 'cane', message: 'Sugar cane harvested.', drops: caneSegments.map(segment => ({ kind: 'sugar_cane', count: 1, x: 3, z: 1, y: segment.height + .05 })) };
      }
      if (id === 'summer:fish') {
        fish.flee(now);
        return { type: 'fish', message: 'Fish moved.' };
      }
      let index;
      if (id === actionId) index = [nextMelon, (nextMelon + 1) % melons.length].find(candidate => !melons[candidate].regrowAt);
      else if (id === `${actionId}:0`) index = 0;
      else if (id === `${actionId}:1`) index = 1;
      else return null;
      if (index === undefined || melons[index].regrowAt) return null;
      const fruit = melons[index];
      const melon = fruit.mesh;
      melon.visible = false;
      // Raycasting does not use visibility, so remove the picked fruit until it regrows.
      view.pickables.splice(view.pickables.indexOf(melon), 1);
      fruit.regrowAt = now + 2200;
      nextMelon = (index + 1) % melons.length;
      return { type: 'melon', message: 'Melon picked.', x: Math.floor(melon.position.x), z: Math.floor(melon.position.z) };
    };
    updateScenery = (now, reducedMotion) => {
      fish.tick(now, reducedMotion);
      for (const segment of caneSegments) if (segment.regrowAt && now >= segment.regrowAt) {
        segment.group.visible = true;
        view.pickables.push(segment.group.userData.hit);
        segment.regrowAt = 0;
      }
      if (caneRegrowAt && now >= caneRegrowAt) caneRegrowAt = 0;
      for (const fruit of melons) {
        if (fruit.regrowAt && now >= fruit.regrowAt) {
          fruit.mesh.visible = true;
          view.pickables.push(fruit.mesh);
          fruit.regrowAt = 0;
        }
      }
    };
  }

  if (seasonId === 'autumn') {
    for (const x of [.5, 1.5, 2.5]) {
      const log = addBox(x, .5, .5, faceMaterials('oak_log', 'oak_log_top', 'oak_log_top'));
      log.rotation.z = Math.PI / 2;
    }
    const mossySlab = addBox(.5, .25, 2.5, faceMaterials('mossy_cobblestone'), [1, .5, 1]);
    const slabGeometry = view.own(mossySlab.geometry.clone());
    const slabUV = slabGeometry.attributes.uv;
    for (const face of [0, 1, 4, 5]) {
      for (let i = face * 4; i < face * 4 + 4; i++) slabUV.setY(i, slabUV.getY(i) * .5);
    }
    mossySlab.geometry = slabGeometry;
    const pumpkinMaterials = faceMaterials('pumpkin_side', 'pumpkin_top');
    const carved = [...pumpkinMaterials];
    carved[4] = view.material(texture('carved_pumpkin'), .8);
    const lit = [...pumpkinMaterials];
    lit[4] = view.material(texture('jack_o_lantern'), 1);
    const pumpkin = addBox(3.5, .5, 1.5, lit, [1, 1, 1], actionId);
    const mushrooms = [[.01, 1.04, 'red_mushroom', 0], [1.02, 2.04, 'brown_mushroom', 0], [2.03, 1.04, 'red_mushroom', 0], [3.01, .03, 'brown_mushroom', 0], [.1, .05, 'brown_mushroom', 1]].map(([x, z, kind, y], index) => ({
      group: plant(x, z, kind, 1, y, false, `autumn:mushroom:${index}`), x, y, z, kind, regrowAt: 0,
    }));
    nextWakeAt = () => Math.min(...mushrooms.map(mushroom => mushroom.regrowAt || Infinity));
    plant(2.05, 2.02, 'fern', 1, 0, true);
    const litterTint = sampleGrassTint(view.textures['colormap/dry_foliage'].image, season.grassClimate);
    const litterMaterial = view.material(texture('leaf_litter'), 1, { color: litterTint, side: THREE.DoubleSide });
    for (const [x, z, rotation, amount] of [[.0, 1, 0, 2], [1, 1, 1, 4], [1, 2, 3, 2], [2, 1, 2, 3], [3, 0, 0, 1]]) {
      const litter = new THREE.Group();
      for (const model of (amount === 3 ? [2, 3] : [amount]).map(part => `template_leaf_litter_${part}`)) {
        for (const element of view.blockModels[model].elements) {
          const [x0, y0, z0] = element.from.map(v => v / 16);
          const [x1, , z1] = element.to.map(v => v / 16);
          const geometry = view.own(new THREE.PlaneGeometry(x1 - x0, z1 - z0));
          const face = element.faces.up;
          const uv = geometry.attributes.uv;
          for (let i = 0; i < uv.count; i++) {
            let u = uv.getX(i), v = uv.getY(i);
            for (let turn = 0; turn < (face.rotation ?? 0) / 90; turn++) [u, v] = [1 - v, u];
            uv.setXY(i, (face.uv[0] + u * (face.uv[2] - face.uv[0])) / 16, 1 - (face.uv[1] + (1 - v) * (face.uv[3] - face.uv[1])) / 16);
          }
          const mesh = new THREE.Mesh(geometry, litterMaterial);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set((x0 + x1) / 2 - .5, y0 + .003, (z0 + z1) / 2 - .5);
          litter.add(mesh);
        }
      }
      litter.position.set(x + .5, 0, z + .5);
      litter.rotation.y = rotation * Math.PI / 2;
      view.scene.add(litter);
    }
    let lampLit = true;
    let nextMushroom = 0;
    interact = (id, now) => {
      if (id.startsWith('autumn:mushroom')) {
        const index = id === 'autumn:mushroom' ? mushrooms.map((_, i) => (nextMushroom + i) % mushrooms.length).find(i => !mushrooms[i].regrowAt) : Number(id.split(':')[2]);
        const mushroom = mushrooms[index];
        if (!mushroom || mushroom.regrowAt) return null;
        mushroom.group.visible = false;
        view.pickables.splice(view.pickables.indexOf(mushroom.group.userData.hit), 1);
        mushroom.regrowAt = now + 6500;
        nextMushroom = (index + 1) % mushrooms.length;
        return { type: 'mushroom', message: 'Mushroom picked.', drops: [{ kind: mushroom.kind, count: 1, x: mushroom.x, z: mushroom.z, y: mushroom.y + .18 }] };
      }
      if (id !== actionId) return null;
      lampLit = !lampLit;
      pumpkin.material = lampLit ? lit : carved;
      return { type: 'pumpkin', message: lampLit ? 'Pumpkin light on.' : 'Pumpkin light off.', lit: lampLit };
    };
    updateScenery = now => {
      for (const mushroom of mushrooms) if (mushroom.regrowAt && now >= mushroom.regrowAt) {
        mushroom.group.visible = true;
        view.pickables.push(mushroom.group.userData.hit);
        mushroom.regrowAt = 0;
      }
    };
  }

  if (seasonId === 'winter') {
    const treeX = 2, treeZ = 0;
    addBox(treeX + .5, .625, treeZ + .5, faceMaterials('spruce_log', 'spruce_log_top', 'spruce_log_top'), [1, 1, 1]);
    const snowMaterials = faceMaterials('snow');
    for (const [dx, y, dz] of [[-1, 1, 0], [0, 1, -1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [0, 2, 0]]) {
      const x = treeX + dx, z = treeZ + dz;
      leaf(x, y, z, 'spruce', '#5d8572');
      if (dx !== 0 || dz !== 0 || y === 2) addBox(x + .5, y + 1.0625, z + .5, snowMaterials, [1, .125, 1]);
    }
    addBox(3.5, .1875, 2.5, snowMaterials, [1, .125, 1]);
    groundHeights.set('3:2', .25);
    plant(.03, 1.02, 'spruce_sapling', 1, .125);
    const campfire = createCampfire(view, { x: 0, y: 0, z: 2, actionId });
    solidBoxes.push({ minX: 0, maxX: 1, minY: 0, maxY: 7 / 16, minZ: 2, maxZ: 3 });
    nextWakeAt = () => icePond.nextWakeAt;
    updateScenery = (now, reducedMotion) => {
      campfire.tick(now, reducedMotion);
      icePond.tick(now, reducedMotion);
    };
    interact = (id, now, center, reducedMotion = false) => {
      if (id === 'winter:ice') {
        const cell = center ?? iceCells.map(cell => cell.split(':').map(Number)).find(([x, z]) => icePond.hasIce(x, z));
        if (!cell) return null;
        return icePond.breakAt(cell.x ?? cell[0], cell.z ?? cell[1], now, { reducedMotion });
      }
      if (id !== actionId) return null;
      campfire.setLit(!campfire.lit);
      return { type: 'campfire', message: campfire.lit ? 'Campfire lit.' : 'Campfire out.', lit: campfire.lit };
    };
  }

  const groundAt = (x, z) => groundHeights.get(key(Math.floor(x), Math.floor(z))) ?? 0;
  const particles = createSeasonParticles(view, {
    season: seasonId,
    leaves: leafSources.filter(source => seasonId === 'spring' && (source.x !== 0 || source.z !== 0)),
    leafMode: seasonId === 'autumn' ? 'wind' : 'falling',
    leafInterval: 1050,
    leafWindDirection: [1, 0],
    leafWindBounds: { minX: -.8, maxX: 4.8, minZ: .05, maxZ: 3.2 },
    leafWindHeight: 1.7,
    leafWindHeightSpread: .7,
    leafWindSpeed: 3.8,
    groundAt,
    weatherGroundAt: (x, z) => weatherHeights.get(key(Math.floor(x), Math.floor(z))) ?? groundAt(x, z),
    weatherCells: [...groundHeights.keys()].map(cell => cell.split(':').map(Number)),
    leafTint: seasonId === 'autumn' ? sampleGrassTint(view.textures['colormap/dry_foliage'].image, season.grassClimate) : '#ffffff',
  });
  return {
    get nextWakeAt() { return nextWakeAt(); },
    bounds: { minX: .04, maxX: 3.96, minZ: .04, maxZ: 2.96 },
    groundAt,
    interact,
    tick(now, reducedMotion = false) {
      for (const animation of animations) {
        const frame = reducedMotion ? 0 : Math.floor(now / animation.frameDuration) % animation.frames;
        if (frame === animation.previous) continue;
        animation.map.offset.y = 1 - (frame + 1) / animation.frames + .5 / animation.map.image.height;
        animation.previous = frame;
      }
      updateScenery(now, reducedMotion);
      particles.tick(now, reducedMotion);
    },
  };
}
