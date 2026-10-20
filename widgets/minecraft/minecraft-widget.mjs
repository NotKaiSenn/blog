import { createFarmState, interactWithPatch, recordInteraction, beginCollection, finishCollection, growNaturally, addSceneDrops, MATURE_STAGE, COLLECTION_IDLE_MS } from './farm-state.mjs';
import { mergeNearbyDrops, MERGE_ANIMATION_MS } from './drop-stacks.mjs';
import { FarmRenderer, createRenderer } from './farm-renderer.mjs';
import { FarmAudio } from './farm-audio.mjs';
import { SEASONS, seasonIdFor } from './seasons.mjs';
import { resolveAssetBase } from './asset-cache.mjs';

const style = `
  :host { display: block; width: 340px; min-width: 0; max-width: 100%; aspect-ratio: 34 / 28; }
  :host([aria-busy="true"]) { cursor: progress; }
  * { box-sizing: border-box; }
  .world { position: relative; width: 100%; height: 100%; }
  .poster { position: absolute; inset: 0; pointer-events: none; transition: opacity .25s ease-out; }
  .poster ::slotted(*) { display: block; width: 100%; height: 100%; }
  .live .poster { opacity: 0; }
  canvas { position: relative; display: block; width: 100%; height: 100%; background: transparent; outline: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .error { position: absolute; top: calc(100% + 8px); right: 0; left: 0; color: #777; font: 12px system-ui, sans-serif; text-align: center; }
  .error[hidden] { display: none; }
`;

export class MinecraftWidget extends HTMLElement {
  static observedAttributes = ['season'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.selectedId = null;
    this.keyboardPlotSelected = false;
    this.lastMergeAt = 0;
    this.visible = true;
    this.generation = 0;
    // A slotted poster image shows the scene until it can draw itself.
    this.shadowRoot.innerHTML = `<style>${style}</style><div class="world" lang="en">
      <div class="poster"><slot name="poster"></slot></div>
      <canvas tabindex="0" role="application" aria-label="Minecraft scene" aria-describedby="controls"></canvas>
      <span class="sr-only" id="controls"></span>
      <span class="sr-only status" role="status" aria-live="polite" aria-atomic="true"></span>
      <div class="sr-only scene-actions"></div>
      <span class="error" hidden>Scene unavailable. Refresh to retry.</span>
    </div>`;
    this.canvas = this.shadowRoot.querySelector('canvas');
    this.status = this.shadowRoot.querySelector('.status');
    this.world = this.shadowRoot.querySelector('.world');
  }

  async connectedCallback() {
    const generation = ++this.generation;
    const seasonId = seasonIdFor(this.getAttribute('season'));
    if (this.initializedState) {
      // The previous WebGL context was released on disconnect.
      const canvas = this.canvas.cloneNode(false);
      this.canvas.replaceWith(canvas);
      this.canvas = canvas;
    }
    if (!this.initializedState || seasonId !== this.seasonId) {
      this.applySeason(seasonId, createFarmState(performance.now(), SEASONS[seasonId].plots));
      this.initializedState = true;
    }
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.assetBase = resolveAssetBase(this.getAttribute('asset-base'));
    this.audio = new FarmAudio({ season: this.seasonId, assetBase: this.assetBase });
    this.audio.setActive(false);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motion.matches;
    this.motion.addEventListener('change', event => { this.reducedMotion = event.matches; this.schedule(); }, { signal });
    document.addEventListener('visibilitychange', () => this.schedule(), { signal });
    this.canvas.addEventListener('pointermove', event => {
      this.keyboardPlotSelected = false;
      const hit = this.view?.pickPoint(event.clientX, event.clientY);
      this.select(hit?.id);
      this.canvas.style.cursor = hit?.id || hit?.actionId ? 'pointer' : '';
    }, { signal });
    this.canvas.addEventListener('pointerleave', () => {
      this.canvas.style.cursor = '';
      if (!this.canvas.matches(':focus-visible')) this.select(null);
    }, { signal });
    this.canvas.addEventListener('pointerdown', event => {
      this.audio?.unlock();
      this.keyboardPlotSelected = false;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    }, { signal });
    this.canvas.addEventListener('click', event => {
      // Touch input only allows audio once the finger lifts, after pointerdown.
      this.audio?.unlock();
      if (event.button !== 0 || !this.view?.ready) return;
      if (this.pointerStart && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 10) return;
      const hit = this.view.pickPoint(event.clientX, event.clientY);
      recordInteraction(this.state, performance.now());
      if (hit?.actionId) this.interactScene(hit.actionId, hit.center);
      else if (hit?.id) this.interact(hit.id, hit.center);
      else this.schedule();
    }, { signal });
    this.shadowRoot.querySelector('.scene-actions').addEventListener('click', event => {
      const button = event.target.closest('.scene-action');
      if (!button) return;
      this.audio?.unlock();
      this.interactScene(button.dataset.actionId);
    }, { signal });
    this.canvas.addEventListener('keydown', event => this.keydown(event), { signal });
    this.canvas.addEventListener('blur', () => { this.keyboardPlotSelected = false; this.select(null); }, { signal });
    this.intersection = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.schedule(); });
    this.intersection.observe(this);
    this.resizeObserver = new ResizeObserver(() => { this.view?.resize(); this.schedule(); });
    this.resizeObserver.observe(this);
    this.shadowRoot.querySelector('.error').hidden = true;
    this.setAttribute('aria-busy', 'true');
    try {
      this.renderer = createRenderer(this.canvas);
    } catch (error) {
      this.fail(error);
      return;
    }
    await this.showSeason(this.seasonId, this.state, generation);
  }

  attributeChangedCallback(name, previous, value) {
    // Until connected, connectedCallback reads the season itself.
    if (name !== 'season' || previous === value || !this.isConnected || !this.initializedState) return;
    const seasonId = seasonIdFor(value);
    const generation = ++this.generation;
    const state = createFarmState(performance.now(), SEASONS[seasonId].plots);
    // The poster only matches the season the page started with.
    this.world.classList.add('live');
    if (this.renderer) {
      this.setAttribute('aria-busy', 'true');
      void this.showSeason(seasonId, state, generation);
    } else this.applySeason(seasonId, state);
  }

  // Builds the scene on the shared renderer while the current one keeps running, then swaps them in one step.
  async showSeason(seasonId, state, generation) {
    let view;
    try {
      view = new FarmRenderer(this.renderer, seasonId, this.assetBase);
      await view.initialize(state);
    } catch (error) {
      view?.dispose();
      if (generation === this.generation) this.fail(error);
      return;
    }
    if (generation !== this.generation) { view.dispose(); return; }
    this.view?.dispose();
    this.view = view;
    if (state !== this.state) {
      this.applySeason(seasonId, state);
      this.audio?.setSeason(seasonId);
      // Every new winter scene starts with its campfire lit.
      this.audio?.setCampfireLit(true);
    }
    this.shadowRoot.querySelector('.error').hidden = true;
    view.spawnDrops(state.drops, performance.now());
    // Draw now, so the poster fades out over the live scene instead of an empty canvas.
    this.draw();
    this.world.classList.add('live');
    this.removeAttribute('aria-busy');
    this.audio?.preload();
    this.schedule();
    this.dispatchEvent(new CustomEvent('minecraft-ready', { detail: { season: seasonId }, bubbles: true, composed: true }));
  }

  applySeason(seasonId, state) {
    this.seasonId = seasonId;
    this.season = SEASONS[seasonId];
    this.state = state;
    this.selectedId = null;
    this.keyboardPlotSelected = false;
    this.lastMergeAt = 0;
    this.status.textContent = '';
    this.canvas.setAttribute('aria-label', `${this.season.label} Minecraft scene`);
    this.shadowRoot.querySelector('#controls').textContent = `Enter to ${this.season.actionLabel.toLowerCase()}.${state.plots.length ? ' Arrow keys select wheat.' : ''}${this.season.actions?.length ? ' Tab for more actions.' : ''}`;
    const actions = [{ id: this.season.actionId, label: this.season.actionLabel }, ...(this.season.actions ?? [])];
    this.shadowRoot.querySelector('.scene-actions').replaceChildren(...actions.map(action => {
      const button = document.createElement('button');
      button.className = 'scene-action';
      button.type = 'button';
      button.dataset.actionId = action.id;
      button.textContent = action.label;
      return button;
    }));
  }

  fail(error) {
    this.view?.dispose();
    this.view = null;
    this.renderer?.clear();
    this.audio?.setActive(false);
    this.removeAttribute('aria-busy');
    this.shadowRoot.querySelector('.error').hidden = false;
    console.error('Minecraft widget failed to load', error);
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
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }

  select(id) {
    this.selectedId = id ?? null;
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
      const plot = next ?? selected;
      this.select(plot.id);
      this.status.textContent = `Wheat ${this.state.plots.indexOf(plot) + 1}: ${plot.stage === MATURE_STAGE ? 'ready to harvest' : 'growing'}.`;
      this.schedule();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        const id = !this.keyboardPlotSelected ? null : this.selectedId ?? this.state.plots[0]?.id;
        if (id) this.interact(id);
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
    this.select(id);
    if (patch.drops.length) {
      this.audio?.playBreak('crop');
      this.view.spawnDrops(patch.drops, now);
      this.status.textContent = 'Wheat harvested.';
    } else this.status.textContent = patch.plot.stage === MATURE_STAGE ? 'Wheat ready to harvest.' : 'Wheat growing.';
    this.schedule();
    this.dispatchEvent(new CustomEvent('minecraft-interact', { detail: { type: patch.drops.length ? 'harvest' : 'grow', plotId: id, stage: patch.plot.stage, affectedPlotIds: patch.affectedPlotIds }, bubbles: true, composed: true }));
  }

  interactScene(actionId, center) {
    if (!this.view?.ready || !actionId) return;
    if (actionId === 'spring:wheat') {
      const ripe = this.state.plots.find(plot => plot.stage === MATURE_STAGE);
      if (ripe) this.interact(ripe.id);
      else this.status.textContent = 'Wheat growing.';
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
    this.schedule();
    this.dispatchEvent(new CustomEvent('minecraft-scene-interact', { detail: { season: this.seasonId, type: result.type }, bubbles: true, composed: true }));
  }

  tick(now) {
    this.frame = null;
    if (!this.isConnected || !this.visible || document.hidden || !this.view?.ready) return;
    const growth = growNaturally(this.state, now, this.season?.autoGrowMs);
    if (growth.type === 'grow') {
      for (const action of growth.actions) this.view.updatePlot(action.plot);
      if (this.keyboardPlotSelected && growth.actions.some(({ plot }) => plot.id === this.selectedId && plot.stage === MATURE_STAGE)) {
        this.status.textContent = 'Selected wheat ready to harvest.';
      }
    }
    if (now - this.lastMergeAt >= 100 && now - this.state.lastInteractionAt < COLLECTION_IDLE_MS - MERGE_ANIMATION_MS) {
      this.lastMergeAt = now;
      const merges = mergeNearbyDrops(this.state, this.view.getDropPositions(), now);
      if (merges.length) {
        this.view.mergeDrops(merges, now, this.reducedMotion);
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
      this.status.textContent = 'Items collected.';
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
