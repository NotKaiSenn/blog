import * as THREE from 'three';
import { PICKUP_DURATION_MS } from './farm-state.mjs';
import { MERGE_ANIMATION_MS } from './drop-stacks.mjs';
import { createGeneratedItemGeometry } from './generated-item-geometry.mjs';
import { createGrassCanvases } from './grass-materials.mjs';
import { SEASONS, buildSeasonScenery } from './season-scenes.mjs';

const PLAYER_EYE_HEIGHT = 1.62;
const random = seed => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

function configureTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class FarmRenderer {
  constructor(canvas, seasonId, assetBase = new URL(/* @vite-ignore */ './assets/', import.meta.url)) {
    this.canvas = canvas;
    this.assetURL = path => new URL(path, assetBase).href;
    this.seasonId = Object.hasOwn(SEASONS, seasonId) ? seasonId : 'spring';
    this.season = SEASONS[this.seasonId];
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-2.8, 2.8, 2.3, -2.3, .1, 50);
    this.camera.position.set(8.4, 6.8, 9.4);
    this.camera.lookAt(...this.season.cameraTarget);
    this.camera.updateMatrixWorld();
    this.raycaster = new THREE.Raycaster();
    this.plots = new Map();
    this.cropHits = new Map();
    this.pickables = [];
    this.items = new Map();
    this.dropPositions = new Map();
    this.pointer = new THREE.Vector2();
    // An invisible standing player beside the farm, with their feet at ground level.
    this.pickupTarget = new THREE.Vector3(5.4, PLAYER_EYE_HEIGHT / 2, -1.2);
    this.screenRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.bursts = [];
    this.resources = new Set();
    this.textures = {};
    this.disposed = false;
  }

  own(value) { this.resources.add(value); return value; }

  async initialize(state) {
    const loader = new THREE.TextureLoader();
    const paths = [...new Set([
      'block/dirt', 'block/grass_block_top', 'block/grass_block_side', 'block/grass_block_side_overlay',
      'colormap/grass', 'block/farmland_moist', 'block/water_still',
      'item/wheat', 'item/wheat_seeds', ...this.season.textures,
      ...Array.from({ length: 8 }, (_, i) => `block/wheat_stage${i}`),
    ])];
    const requests = paths.map(async path => {
      const texture = configureTexture(await loader.loadAsync(this.assetURL(`${path}.png`)));
      if (this.disposed) { texture.dispose(); return; }
      this.textures[path] = this.own(texture);
    });
    const modelNames = ['crop', ...(this.seasonId === 'winter' ? ['campfire', 'campfire_off', 'template_campfire'] : []), ...(this.seasonId === 'autumn' ? ['template_leaf_litter_1', 'template_leaf_litter_2', 'template_leaf_litter_3', 'template_leaf_litter_4'] : [])];
    const modelRequest = Promise.all(modelNames.map(async name => {
      const response = await fetch(this.assetURL(`models/block/${name}.json`));
      if (!response.ok) throw new Error(`Block model unavailable: ${name}`);
      return [name, await response.json()];
    })).then(Object.fromEntries);
    const results = await Promise.allSettled([...requests, modelRequest]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (this.disposed) return;
    this.blockModels = results.at(-1).value;
    this.cropModel = this.blockModels.crop;
    this.prepareMaterials();
    this.scenery = buildSeasonScenery(this, this.seasonId, state);
    this.buildPlants(state);
    this.itemTemplates = {
      wheat: this.generatedItem(this.textures['item/wheat']),
      seeds: this.generatedItem(this.textures['item/wheat_seeds']),
    };
    if (this.textures['item/melon_slice']) this.itemTemplates.melon = this.generatedItem(this.textures['item/melon_slice']);
    for (const [kind, path] of Object.entries({ sugar_cane: 'item/sugar_cane', red_mushroom: 'block/red_mushroom', brown_mushroom: 'block/brown_mushroom' })) {
      if (this.textures[path]) this.itemTemplates[kind] = this.generatedItem(this.textures[path]);
    }
    this.itemShadowGeometry = this.own(new THREE.CircleGeometry(.16, 12));
    this.itemShadowMaterial = this.own(new THREE.MeshBasicMaterial({ color: '#17170d', transparent: true, opacity: .17, depthWrite: false }));
    this.resize();
    this.ready = true;
    this.render(performance.now());
  }

  material(map, brightness = 1, extra = {}) {
    return this.own(new THREE.MeshBasicMaterial({ map, color: new THREE.Color().setScalar(brightness), alphaTest: .1, ...extra }));
  }

  prepareMaterials() {
    const grass = createGrassCanvases(this.textures, this.season.grassClimate);
    this.grassTint = grass.tint;
    const top = this.own(configureTexture(new THREE.CanvasTexture(grass.top)));
    const side = this.own(configureTexture(new THREE.CanvasTexture(grass.side)));
    this.grassMaterials = [.6, .6, 1, .5, .8, .8].map((shade, i) => this.material(i === 2 ? top : i === 3 ? this.textures['block/dirt'] : side, shade));
    this.farmMaterials = [.6, .6, 1, .5, .8, .8].map((shade, i) => this.material(this.textures[i === 2 ? 'block/farmland_moist' : 'block/dirt'], shade));
    this.cropMaterials = Array.from({ length: 8 }, (_, i) => this.material(this.textures[`block/wheat_stage${i}`], 1, { side: THREE.DoubleSide }));
  }

  buildPlants(state) {
    const hitGeometry = this.own(new THREE.BoxGeometry(1, 1, 1));
    const hitMaterial = this.own(new THREE.MeshBasicMaterial({ visible: false }));
    for (const plot of state.plots) {
      const group = new THREE.Group(); group.position.set(plot.x, 0, plot.z);
      for (const element of this.cropModel.elements) {
        const [x0, y0, z0] = element.from.map(v => v / 16);
        const [x1, y1, z1] = element.to.map(v => v / 16);
        const alongZ = x0 === x1;
        const geometry = this.own(new THREE.PlaneGeometry(alongZ ? z1 - z0 : x1 - x0, y1 - y0));
        const uv = element.faces[alongZ ? 'east' : 'south'].uv;
        const coords = geometry.attributes.uv;
        for (let i = 0; i < coords.count; i++) coords.setXY(i, (uv[0] + coords.getX(i) * (uv[2] - uv[0])) / 16, 1 - (uv[1] + (1 - coords.getY(i)) * (uv[3] - uv[1])) / 16);
        const mesh = new THREE.Mesh(geometry, this.cropMaterials[plot.stage]);
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        if (alongZ) mesh.rotation.y = Math.PI / 2;
        mesh.userData.plotId = plot.id;
        group.add(mesh);
      }
      this.plots.set(plot.id, group); this.scene.add(group);
      // Vanilla selection bounds grow with the crop; transparent sprite pixels do not block adjacent plots.
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.scale.y = (plot.stage + 1) / 8;
      hit.position.set(plot.x + .5, hit.scale.y / 2, plot.z + .5);
      hit.userData.plotId = plot.id;
      this.scene.add(hit); this.pickables.push(hit); this.cropHits.set(plot.id, hit);
    }
  }

  updatePlot(plot) {
    this.plots.get(plot.id)?.children.forEach(mesh => { mesh.material = this.cropMaterials[plot.stage]; });
    const hit = this.cropHits.get(plot.id);
    hit.scale.y = (plot.stage + 1) / 8;
    hit.position.y = hit.scale.y / 2;
  }

  generatedItem(texture) {
    const c = document.createElement('canvas');
    c.width = texture.image.width; c.height = texture.image.height;
    const ctx = c.getContext('2d'); ctx.drawImage(texture.image, 0, 0);
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const geometry = this.own(createGeneratedItemGeometry(pixels, c.width, c.height));
    const mesh = new THREE.Mesh(geometry, this.material(texture, 1, { vertexColors: true }));
    mesh.scale.setScalar(.5);
    return mesh;
  }

  spawnDrops(drops, now) {
    for (const drop of drops) {
      const model = new THREE.Group();
      const position = new THREE.Vector3(drop.x + .5, drop.y ?? .18, drop.z + .5);
      const separation = drop.kind === 'wheat' ? -.14 : .14;
      position.addScaledVector(this.screenRight, separation);
      const velocity = this.screenRight.clone().multiplyScalar(separation * .28);
      velocity.x += (random(drop.id) - .5) * .08;
      velocity.z += (random(drop.id + 53) - .5) * .08;
      velocity.y = .17 + random(drop.id + 29) * .05;
      const shadow = new THREE.Mesh(this.itemShadowGeometry, this.itemShadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      this.scene.add(model, shadow);
      this.items.set(drop.id, { id: drop.id, model, shadow, kind: drop.kind, position, previous: position.clone(), velocity, born: now, steppedAt: now, phase: random(drop.id + 83) * Math.PI * 2, collectingAt: null, mergingAt: null });
      this.syncDropStack(drop.id, drop.count ?? 1);
    }
  }

  syncDropStack(id, count) {
    const item = this.items.get(id);
    if (!item) return;
    const copies = count > 32 ? 4 : count > 16 ? 3 : count > 1 ? 2 : 1;
    while (item.model.children.length > copies) item.model.remove(item.model.children.at(-1));
    while (item.model.children.length < copies) {
      const index = item.model.children.length;
      const mesh = this.itemTemplates[item.kind].clone();
      if (index) {
        // Small, stable offsets keep a stack readable while it rotates as one entity.
        mesh.position.set((random(id * 7 + index) - .5) * .11, (random(id * 11 + index) - .5) * .09, (index % 2 ? 1 : -1) * (.045 + index * .015));
      }
      item.model.add(mesh);
    }
  }

  getDropPositions() {
    this.dropPositions.clear();
    for (const [id, item] of this.items) {
      if (item.collectingAt === null && item.mergingAt === null) this.dropPositions.set(id, item.position);
    }
    return this.dropPositions;
  }

  mergeDrops(events, now, reducedMotion = false) {
    for (const event of events) {
      const source = this.items.get(event.sourceId);
      const target = this.items.get(event.targetId);
      if (!source || !target || source === target) continue;
      this.syncDropStack(event.targetId, event.totalCount);
      if (reducedMotion) {
        this.removeDrop(event.sourceId);
        continue;
      }
      source.mergingAt = now;
      source.mergeOrigin = source.model.position.clone();
      source.mergeTarget = target.model;
      source.shadow.visible = false;
    }
  }

  burst(plot, now) {
    const group = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const geometry = this.own(new THREE.PlaneGeometry(.12, .12));
      const uv = geometry.attributes.uv, u = random(i + now), v = random(i + now + 9);
      for (let j = 0; j < uv.count; j++) uv.setXY(j, u * .75 + uv.getX(j) * .25, v * .75 + uv.getY(j) * .25);
      const chip = new THREE.Mesh(geometry, this.cropMaterials[7]);
      chip.position.set(plot.x + .5, .35, plot.z + .5);
      chip.userData.velocity = new THREE.Vector3((random(i + now + 11) - .5) * 2, .8 + random(i + 99), (random(i + now + 33) - .5) * 2);
      chip.userData.origin = chip.position.clone();
      chip.quaternion.copy(this.camera.quaternion);
      group.add(chip);
    }
    this.scene.add(group); this.bursts.push({ group, born: now });
  }

  startCollection(ids, now) {
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item || item.collectingAt !== null) continue;
      item.collectingAt = now;
      item.pickupOrigin = item.model.position.clone();
      item.pickupTarget = this.pickupTarget.clone();
      // Entity pickup moves the origin while retaining the item's rendered hover offset.
      item.pickupTarget.y += item.model.position.y - item.position.y;
      item.shadow.visible = false;
    }
  }

  removeDrops(ids) {
    for (const id of ids) this.removeDrop(id);
  }

  removeDrop(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.model, item.shadow);
    this.items.delete(id);
    this.dropPositions.delete(id);
  }

  release(resource) { resource.dispose(); this.resources.delete(resource); }

  groundAt(x, z) { return this.scenery.groundAt(x, z); }

  animateItems(now, reducedMotion) {
    for (const item of this.items.values()) {
      if (item.mergingAt !== null) {
        const t = Math.min(1, Math.max(0, (now - item.mergingAt) / MERGE_ANIMATION_MS));
        if (t === 1 || reducedMotion) {
          this.removeDrop(item.id);
          continue;
        }
        item.model.position.lerpVectors(item.mergeOrigin, item.mergeTarget.position, t * t * (3 - 2 * t));
        continue;
      }
      if (item.collectingAt !== null) {
        const t = THREE.MathUtils.clamp((now - item.collectingAt) / PICKUP_DURATION_MS, 0, 1);
        item.model.position.lerpVectors(item.pickupOrigin, item.pickupTarget, t * t);
        continue;
      }
      if (now - item.steppedAt > 2000) {
        item.position.y = this.groundAt(item.position.x, item.position.z);
        item.previous.copy(item.position); item.velocity.set(0, 0, 0); item.steppedAt = now;
      }
      // Fixed 20 Hz entity physics; display frames interpolate between ticks.
      while (now - item.steppedAt >= 50) {
        item.previous.copy(item.position);
        item.velocity.y -= .04;
        item.position.add(item.velocity);
        item.velocity.multiplyScalar(.98);
        const bounds = this.scenery.bounds;
        item.position.x = THREE.MathUtils.clamp(item.position.x, bounds.minX + .04, bounds.maxX - .04);
        item.position.z = THREE.MathUtils.clamp(item.position.z, bounds.minZ + .04, bounds.maxZ - .04);
        const ground = this.groundAt(item.position.x, item.position.z);
        if (item.position.y < ground) {
          item.position.y = ground;
          item.velocity.y *= -.5;
          item.velocity.x *= .6; item.velocity.z *= .6;
          if (Math.abs(item.velocity.y) < .025) item.velocity.y = 0;
        }
        item.steppedAt += 50;
      }
      const elapsed = (now - item.born) / 1000;
      item.model.position.lerpVectors(item.previous, item.position, Math.min(1, (now - item.steppedAt) / 50));
      if (reducedMotion) {
        item.model.position.set(item.position.x, this.groundAt(item.position.x, item.position.z) + .38, item.position.z);
        item.model.rotation.y = item.phase;
      } else {
        item.model.position.y += .25 + Math.sin(elapsed * 2 + item.phase) * .1 + .1;
        item.model.rotation.y = elapsed + item.phase;
      }
      item.shadow.position.set(item.model.position.x, this.groundAt(item.model.position.x, item.model.position.z) + .006, item.model.position.z);
    }
    this.bursts = this.bursts.filter(burst => {
      const age = (now - burst.born) / 1000;
      if (age > .55 || reducedMotion) {
        this.scene.remove(burst.group);
        burst.group.children.forEach(chip => this.release(chip.geometry));
        return false;
      }
      burst.group.children.forEach(chip => {
        chip.position.copy(chip.userData.origin).addScaledVector(chip.userData.velocity, age);
        chip.position.y -= 2.8 * age * age;
      });
      return true;
    });
  }

  pickPoint(clientX, clientY) {
    if (!this.ready) return null;
    const bounds = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    // The clear pond surface must not hide the fish's underwater hit box.
    const hit = hits.find(candidate => !candidate.object.userData.water);
    const id = hit?.object.userData.plotId;
    const actionId = hit?.object.userData.actionId;
    const point = actionId === 'winter:ice' ? hit.point.clone().addScaledVector(this.raycaster.ray.direction, .001) : hit?.point;
    return id == null && actionId == null ? null : { id, actionId, center: { x: point.x, z: point.z } };
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const halfHeight = this.season.halfHeight;
    this.camera.left = -halfHeight * width / height;
    this.camera.right = halfHeight * width / height;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render(now, reducedMotion = false) {
    if (!this.ready || this.disposed) return;
    this.scenery.tick(now, reducedMotion);
    this.animateItems(now, reducedMotion);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resources.forEach(resource => resource.dispose());
    this.resources.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.clear();
  }
}
