import { createFarmState, interactWithPatch, recordInteraction, beginCollection, finishCollection, growNaturally, addSceneDrops, MATURE_STAGE, COLLECTION_IDLE_MS } from './farm-state.mjs';
import { mergeNearbyDrops, MERGE_ANIMATION_MS } from './drop-stacks.mjs';
import { FarmRenderer } from './farm-renderer.mjs';
import { FarmAudio } from './farm-audio.mjs';
import { SEASONS } from './season-scenes.mjs';

const style = `
  :host { display: block; width: 340px; min-width: 0; max-width: 100%; aspect-ratio: 34 / 28; }
  * { box-sizing: border-box; }
  .world { position: relative; width: 100%; height: 100%; }
  canvas { display: block; width: 100%; height: 100%; background: transparent; outline: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .error { position: absolute; inset: 0; display: grid; place-content: center; color: #777; font: 12px system-ui, sans-serif; }
  .error[hidden] { display: none; }
`;

export class MinecraftWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = createFarmState(0, []);
    this.selectedId = null;
    this.selectedCenter = undefined;
    this.keyboardPlotSelected = false;
    this.lastMergeAt = 0;
    this.visible = true;
    this.generation = 0;
    this.shadowRoot.innerHTML = `<style>${style}</style><div class="world">
      <canvas tabindex="0" role="application" aria-label="小天地"></canvas>
      <ol class="sr-only plots" aria-label="麦田生长状态"></ol>
      <span class="sr-only status" role="status" aria-live="polite" aria-atomic="true"></span>
      <div class="sr-only scene-actions"><button class="scene-action primary-action" type="button" hidden></button></div>
      <span class="error" hidden>场景加载失败，请刷新重试。</span>
    </div>`;
    this.canvas = this.shadowRoot.querySelector('canvas');
    this.status = this.shadowRoot.querySelector('.status');
    this.plotElements = new Map();
  }

  async connectedCallback() {
    const generation = ++this.generation;
    if (this.initializedState) {
      const canvas = this.canvas.cloneNode(false);
      this.canvas.replaceWith(canvas);
      this.canvas = canvas;
    }
    if (!this.initializedState) {
      const requestedSeason = this.getAttribute('season');
      this.seasonId = Object.hasOwn(SEASONS, requestedSeason) ? requestedSeason : 'spring';
      this.season = SEASONS[this.seasonId];
      this.state = createFarmState(performance.now(), this.season.plots);
      const list = this.shadowRoot.querySelector('.plots');
      list.replaceChildren();
      list.hidden = this.state.plots.length === 0;
      this.plotElements = new Map(this.state.plots.map(plot => {
        const element = document.createElement('li');
        element.dataset.plotId = plot.id;
        list.append(element);
        return [plot.id, element];
      }));
      this.canvas.setAttribute('aria-label', `${this.season.label}季 Minecraft 小天地。${this.season.actionLabel}。点击场景中的物件或按回车操作。${this.season.autoGrowMs ? '小麦会自动生长，方向键选择麦田，回车收获。' : ''}掉落物停止操作三秒后自动收集。`);
      const sceneAction = this.shadowRoot.querySelector('.primary-action');
      sceneAction.hidden = false;
      sceneAction.textContent = this.season.actionLabel;
      sceneAction.dataset.actionId = this.season.actionId;
      for (const action of this.season.actions ?? []) {
        const button = document.createElement('button');
        button.className = 'scene-action';
        button.type = 'button';
        button.dataset.actionId = action.id;
        button.textContent = action.label;
        this.shadowRoot.querySelector('.scene-actions').append(button);
      }
      this.initializedState = true;
    }
    this.controller = new AbortController();
    const { signal } = this.controller;
    const assetBase = new URL(this.getAttribute('asset-base') || './assets/', import.meta.url).href;
    this.audio = new FarmAudio({ season: this.seasonId, assetBase });
    this.audio.setActive(false);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motion.matches;
    this.motion.addEventListener('change', event => { this.reducedMotion = event.matches; this.schedule(); }, { signal });
    document.addEventListener('visibilitychange', () => this.schedule(), { signal });
    this.canvas.addEventListener('pointermove', event => {
      this.keyboardPlotSelected = false;
      const hit = this.view?.pickPoint(event.clientX, event.clientY);
      this.select(hit?.id, hit?.center);
      this.canvas.style.cursor = hit?.id || hit?.actionId ? 'pointer' : 'default';
    }, { signal });
    this.canvas.addEventListener('pointerleave', () => {
      this.canvas.style.cursor = 'default';
      if (!this.canvas.matches(':focus-visible')) this.select(null);
    }, { signal });
    this.canvas.addEventListener('pointerdown', event => {
      this.audio?.unlock();
      this.keyboardPlotSelected = false;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    }, { signal });
    this.canvas.addEventListener('click', event => {
      if (event.button !== 0 || !this.view?.ready) return;
      if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 10) return;
      const hit = this.view.pickPoint(event.clientX, event.clientY);
      recordInteraction(this.state, performance.now());
      if (hit?.actionId) this.interactScene(hit.actionId, hit.center);
      else if (hit?.id) this.interact(hit.id, hit.center);
      else this.schedule();
    }, { signal });
    for (const button of this.shadowRoot.querySelectorAll('.scene-action')) {
      button.addEventListener('click', () => {
        this.audio?.unlock();
        this.interactScene(button.dataset.actionId);
      }, { signal });
    }
    this.canvas.addEventListener('keydown', event => this.keydown(event), { signal });
    this.canvas.addEventListener('blur', () => { this.keyboardPlotSelected = false; this.select(null); }, { signal });
    this.intersection = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.schedule(); });
    this.intersection.observe(this);
    this.resizeObserver = new ResizeObserver(() => { this.view?.resize(); this.schedule(); });
    this.resizeObserver.observe(this);
    this.shadowRoot.querySelector('.error').hidden = true;
    try {
      const view = new FarmRenderer(this.canvas, this.seasonId, assetBase);
      this.view = view;
      await view.initialize(this.state);
      if (generation !== this.generation || !this.isConnected) { view.dispose(); return; }
      view.spawnDrops(this.state.drops, performance.now());
      this.update();
      this.schedule();
    } catch (error) {
      if (generation !== this.generation) return;
      this.view?.dispose();
      this.audio?.setActive(false);
      this.shadowRoot.querySelector('.error').hidden = false;
      console.error('Minecraft widget failed to load', error);
    }
  }

  disconnectedCallback() {
    ++this.generation;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.wakeTimer);
    this.frame = null;
    this.controller?.abort();
    this.intersection?.disconnect();
    this.resizeObserver?.disconnect();
    this.audio?.dispose();
    this.audio = null;
    this.view?.dispose();
    this.view = null;
  }

  select(id, center) {
    this.selectedId = id ?? null;
    this.selectedCenter = center;
  }

  keydown(event) {
    this.audio?.unlock();
    if (!this.view?.ready) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta) {
      event.preventDefault();
      recordInteraction(this.state, performance.now());
      const selected = this.state.plots.find(p => p.id === this.selectedId) ?? this.state.plots[0];
      if (!selected) return;
      this.keyboardPlotSelected = true;
      const next = this.state.plots.find(p => p.x === selected.x + delta[0] && p.z === selected.z + delta[1]);
      this.select(next?.id ?? selected.id);
      this.schedule();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        const id = !this.keyboardPlotSelected ? null : this.selectedId ?? this.state.plots[0]?.id;
        if (id) this.interact(id, this.selectedCenter);
        else this.interactScene(this.season?.actionId);
      }
    } else if (event.key === 'Escape') { this.keyboardPlotSelected = false; this.select(null); }
  }

  interact(id, center) {
    if (!this.view?.ready) return;
    const now = performance.now();
    const patch = interactWithPatch(this.state, id, now, Math.random, center);
    if (patch.type === 'noop') return;
    for (const action of patch.actions) {
      this.view.updatePlot(action.plot);
      if (action.type === 'harvest' && !this.reducedMotion) this.view.burst(action.plot, now);
    }
    this.select(id, center);
    if (patch.drops.length) {
      this.audio?.playBreak('crop');
      this.view.spawnDrops(patch.drops, now);
      this.status.textContent = `收获范围内 ${patch.actions.filter(action => action.type === 'harvest').length} 块成熟小麦。同类掉落物会自动合并，停止操作三秒后收集。`;
    } else this.status.textContent = `附近 ${patch.actions.length} 块小麦长大了，点击成熟的小麦即可收获。`;
    this.update();
    this.schedule();
    this.dispatchEvent(new CustomEvent('minecraft-interact', { detail: { type: patch.drops.length ? 'harvest' : 'grow', plotId: id, stage: patch.plot.stage, affectedPlotIds: patch.affectedPlotIds }, bubbles: true, composed: true }));
  }

  interactScene(actionId, center) {
    if (!this.view?.ready || !actionId) return;
    if (actionId === 'spring:wheat') {
      const ripe = this.state.plots.find(plot => plot.stage === MATURE_STAGE);
      if (ripe) this.interact(ripe.id);
      else this.status.textContent = '小麦正在自然生长。';
      return;
    }
    const now = performance.now();
    const result = this.view.scenery?.interact(actionId, now, center, this.reducedMotion);
    if (!result) return;
    if (result.type === 'ice') this.audio?.playBreak('glass');
    else if (result.type === 'campfire') {
      this.audio?.setCampfireLit(result.lit);
      this.audio?.playCampfireToggle(result.lit);
    }
    else if (result.type === 'melon') this.audio?.playBreak('wood');
    else if ((result.type === 'cane' || result.type === 'mushroom') && result.drops?.length) this.audio?.playBreak('grass');
    recordInteraction(this.state, now);
    const specs = result.drops ?? (result.type === 'melon'
      ? Array.from({ length: 3 }, () => ({ kind: 'melon', count: 1, x: result.x, z: result.z }))
      : []);
    if (specs.length) {
      const drops = addSceneDrops(this.state, specs, now);
      this.view.spawnDrops(drops, now);
    }
    this.status.textContent = result.message;
    this.update();
    this.schedule();
    this.dispatchEvent(new CustomEvent('minecraft-scene-interact', { detail: { season: this.seasonId, type: result.type }, bubbles: true, composed: true }));
  }

  update() {
    for (const plot of this.state.plots) {
      const element = this.plotElements.get(plot.id);
      element.dataset.stage = plot.stage;
      element.textContent = `第 ${plot.z + 1} 排第 ${plot.x} 块：${plot.stage === MATURE_STAGE ? '已成熟' : `生长阶段 ${plot.stage + 1}/8`}`;
    }
    this.dataset.pendingItems = this.state.drops.reduce((count, drop) => count + drop.count, 0);
    this.dataset.pendingStacks = this.state.drops.length;
    this.dataset.collected = this.state.collectedCount;
    this.dataset.seeds = this.state.collectedSeeds;
    this.dataset.melons = this.state.collectedItems.melon ?? 0;
    this.dataset.sugarCane = this.state.collectedItems.sugar_cane ?? 0;
    this.dataset.redMushrooms = this.state.collectedItems.red_mushroom ?? 0;
    this.dataset.brownMushrooms = this.state.collectedItems.brown_mushroom ?? 0;
  }

  tick(now) {
    this.frame = null;
    if (!this.isConnected || !this.visible || document.hidden || !this.view?.ready) return;
    const growth = growNaturally(this.state, now, this.season?.autoGrowMs);
    if (growth.type === 'grow') {
      for (const action of growth.actions) this.view.updatePlot(action.plot);
      this.update();
    }
    if (now - this.lastMergeAt >= 100 && now - this.state.lastInteractionAt < COLLECTION_IDLE_MS - MERGE_ANIMATION_MS) {
      this.lastMergeAt = now;
      const merges = mergeNearbyDrops(this.state, this.view.getDropPositions(), now);
      if (merges.length) {
        this.view.mergeDrops(merges, now, this.reducedMotion);
        this.update();
        this.dispatchEvent(new CustomEvent('minecraft-merge', { detail: { mergedEntities: merges.length, pendingStacks: this.state.drops.length }, bubbles: true, composed: true }));
      }
    }
    const batch = beginCollection(this.state, now);
    if (batch.type === 'collect-start') {
      this.view.startCollection(batch.dropIds, now);
      this.audio?.playPickup();
    }
    const result = finishCollection(this.state, this.state.drops.map(drop => drop.id), now);
    if (result.type === 'collect') {
      this.view.removeDrops(result.drops.map(drop => drop.id));
      this.update();
      const names = { wheat: '小麦', seeds: '种子', melon: '西瓜片', sugar_cane: '甘蔗', red_mushroom: '红蘑菇', brown_mushroom: '棕蘑菇' };
      this.status.textContent = `已收集${Object.entries(this.state.collectedItems).map(([kind, count]) => `${count} 份${names[kind] ?? kind}`).join('、')}。`;
      this.dispatchEvent(new CustomEvent('minecraft-collect', { detail: { collectedCount: this.state.collectedCount, collectedSeeds: this.state.collectedSeeds, collectedItems: { ...this.state.collectedItems } }, bubbles: true, composed: true }));
    }
    this.draw(now);
    if (!this.reducedMotion || this.state.drops.length) {
      if (this.frame == null) this.frame = requestAnimationFrame(time => this.tick(time));
    } else if (this.frame == null) {
      const cropWakeAt = this.season?.autoGrowMs && this.state.plots.some(plot => plot.stage < MATURE_STAGE)
        ? this.state.lastGrowthAt + this.season.autoGrowMs : Infinity;
      const sceneryWakeAt = this.view.scenery?.nextWakeAt;
      const nextWakeAt = Math.min(cropWakeAt, Number.isFinite(sceneryWakeAt) ? sceneryWakeAt : Infinity);
      if (Number.isFinite(nextWakeAt)) this.wakeTimer = setTimeout(() => this.schedule(), Math.max(1, nextWakeAt - now));
    }
  }

  schedule() {
    clearTimeout(this.wakeTimer);
    this.audio?.setActive(this.isConnected && this.visible && !document.hidden && this.view?.ready);
    if (!this.isConnected || !this.visible || document.hidden || !this.view?.ready) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      return;
    }
    // Coalesce pointer, resize, and crop changes into the next display frame.
    if (this.frame == null) this.frame = requestAnimationFrame(now => this.tick(now));
  }

  draw(now = performance.now()) { this.view?.render(now, this.reducedMotion); }
}

if (!customElements.get('minecraft-widget')) customElements.define('minecraft-widget', MinecraftWidget);
