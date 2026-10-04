const AMBIENT_TICK_SECONDS = .05;
const AMBIENT_LOOKAHEAD_SECONDS = .2;
const AMBIENT_TIMER_MS = 50;
const MAX_RAIN_VOICES = 24;
const MAX_CAMPFIRE_VOICES = 8;
const MAX_WATER_VOICES = 8;
const WIDGET_CAMPFIRE_VOLUME = .95;
const WIND_INTENSITY = .92;
const ELYTRA_EVENT_VOLUME = .6;
const WIDGET_WIND_VOLUME = .58;

export function createAudioAssets(assetBase = new URL(/* @vite-ignore */ './assets/', import.meta.url)) {
  const soundURL = path => new URL(`sounds/${path}.ogg`, assetBase).href;
  const variants = (prefix, count) => Array.from({ length: count }, (_, index) => soundURL(`${prefix}${index + 1}`));
  return {
    break: {
      crop: variants('block/bamboo/sapling_place', 6),
      grass: variants('dig/grass', 4),
      wood: variants('dig/wood', 4),
      glass: variants('random/glass', 3),
    },
    pickup: [soundURL('random/pop')],
    campfire: {
      ignite: [soundURL('fire/ignite')],
      extinguish: [soundURL('random/fizz')],
    },
    ambient: {
      spring: { mode: 'water', urls: [soundURL('liquid/water')], volume: .6 },
      summer: { mode: 'rain', urls: variants('ambient/weather/rain', 8), volume: .07 },
      // Keep the wind at a steady flight speed.
      autumn: { urls: [soundURL('item/elytra/elytra_loop')], volume: WIND_INTENSITY * ELYTRA_EVENT_VOLUME * WIDGET_WIND_VOLUME, pitch: 1 + Math.max(WIND_INTENSITY - .8, 0) },
      winter: { mode: 'campfire', urls: variants('block/campfire/crackle', 6), volume: WIDGET_CAMPFIRE_VOLUME },
    },
  };
}

export const FARM_AUDIO_ASSETS = createAudioAssets();

const defaultContextFactory = () => {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Context ? new Context() : null;
};
const pools = new WeakMap();
const clock = () => globalThis.performance?.now() ?? Date.now();
const defaultTimers = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle),
};

function loadBuffer(pool, url, fetcher) {
  if (!pool.buffers.has(url)) {
    const buffer = Promise.resolve().then(() => fetcher(url)).then(response => {
      if (!response.ok) throw new Error('Sound unavailable');
      return response.arrayBuffer();
    }).then(bytes => pool.context.decodeAudioData(bytes)).catch(() => {
      if (pool.buffers.get(url) === buffer) pool.buffers.delete(url);
      return null;
    });
    pool.buffers.set(url, buffer);
  }
  return pool.buffers.get(url);
}

export class FarmAudio {
  constructor({ season, assetBase, assets = assetBase ? createAudioAssets(assetBase) : FARM_AUDIO_ASSETS, contextFactory = defaultContextFactory, fetcher = globalThis.fetch, random = Math.random, now = clock, timers = defaultTimers } = {}) {
    this.season = season;
    this.assets = assets;
    this.contextFactory = contextFactory;
    this.fetcher = fetcher;
    this.random = random;
    this.now = now;
    this.timers = timers;
    this.active = true;
    this.disposed = false;
    this.generation = 0;
    this.ambientGeneration = 0;
    this.campfireLit = true;
    this.sources = new Set();
    this.lastEffects = new Map();
    this.pool = pools.get(contextFactory) ?? null;
    this.master = null;
    this.ambient = null;
    this.ambientRequest = null;
    this.unlockPromise = null;
    if (this.pool?.unlocked && this.pool.context.state === 'running') void this.syncAmbient();
  }

  unlock() {
    if (this.disposed) return Promise.resolve(false);
    try {
      let pool = pools.get(this.contextFactory);
      if (!pool || pool.context.state === 'closed') {
        const context = this.contextFactory();
        if (!context) return Promise.resolve(false);
        pool = { context, buffers: new Map(), unlocked: false };
        pools.set(this.contextFactory, pool);
      }
      if (this.pool !== pool && this.master) {
        this.invalidate();
        for (const entry of [...this.sources]) this.stop(entry);
        this.master.disconnect();
        this.master = null;
      }
      this.pool = pool;
      this.attach();
      // Creating/resuming the context must happen synchronously inside the user gesture.
      const resume = pool.context.state === 'running' ? undefined : pool.context.resume();
      this.unlockPromise = Promise.resolve(resume).then(() => {
        pool.unlocked = pool.context.state === 'running';
        if (this.disposed || !pool.unlocked) return false;
        void this.syncAmbient();
        return true;
      }).catch(() => false);
      return this.unlockPromise;
    } catch { return Promise.resolve(false); }
  }

  attach() {
    if (this.master) return;
    this.master = this.pool.context.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.pool.context.destination);
  }

  setSeason(season) {
    if (this.disposed || this.season === season) return Promise.resolve(false);
    this.season = season;
    this.invalidate();
    for (const entry of [...this.sources]) this.stop(entry, entry.ambient && entry.owner?.mode !== 'campfire' ? .08 : 0);
    return this.syncAmbient();
  }

  setActive(active) {
    if (this.disposed || this.active === Boolean(active)) return Promise.resolve(false);
    this.active = Boolean(active);
    if (!this.active) {
      this.invalidate();
      for (const entry of [...this.sources]) this.stop(entry);
      return Promise.resolve(false);
    }
    return this.syncAmbient();
  }

  setCampfireLit(lit) {
    if (this.disposed || this.campfireLit === Boolean(lit)) return Promise.resolve(false);
    this.campfireLit = Boolean(lit);
    if (this.season !== 'winter') return Promise.resolve(false);
    this.invalidateAmbient();
    for (const entry of [...this.sources]) if (entry.owner?.mode === 'campfire') this.stop(entry);
    return this.campfireLit ? this.syncAmbient() : Promise.resolve(false);
  }

  invalidateAmbient() {
    if (this.ambient?.voices) {
      this.ambient.stopped = true;
      if (this.ambient.timer !== null) this.timers.clearTimeout(this.ambient.timer);
      this.ambient.timer = null;
      if (!this.ambient.voices.size) this.ambient.bus.disconnect();
    }
    this.ambientGeneration++;
    this.ambient = null;
    this.ambientRequest = null;
  }

  invalidate() {
    this.generation++;
    this.invalidateAmbient();
  }

  ready() {
    return !this.disposed && this.active && this.pool?.unlocked && this.pool.context.state === 'running';
  }

  choose(urls) { return urls[Math.min(urls.length - 1, Math.floor(this.random() * urls.length))]; }

  async syncAmbient() {
    const ambient = this.assets.ambient?.[this.season];
    if (!this.ready() || !ambient?.urls?.length) return false;
    if (this.season === 'winter') {
      for (const urls of Object.values(this.assets.campfire ?? {})) {
        for (const url of urls) void loadBuffer(this.pool, url, this.fetcher);
      }
    }
    if (ambient.mode === 'campfire' && (this.season !== 'winter' || !this.campfireLit)) return false;
    if (this.ambient) {
      if (this.ambient.mode === 'rain' && this.ambient.timer === null) this.pumpRain(this.ambient);
      if (this.ambient.mode === 'campfire' && this.ambient.timer === null) this.pumpCampfire(this.ambient);
      if (this.ambient.mode === 'water' && this.ambient.timer === null) this.pumpWater(this.ambient);
      return false;
    }
    if (this.ambientRequest) return false;
    const generation = this.generation;
    const ambientGeneration = this.ambientGeneration;
    const request = {};
    this.ambientRequest = request;
    try {
      this.attach();
      const urls = ['rain', 'campfire', 'water'].includes(ambient.mode) ? ambient.urls : [this.choose(ambient.urls)];
      const buffers = (await Promise.all(urls.map(url => loadBuffer(this.pool, url, this.fetcher)))).filter(Boolean);
      if (!buffers.length || generation !== this.generation || ambientGeneration !== this.ambientGeneration || !this.ready()) return false;
      if (ambient.mode === 'rain') {
        this.startRain(buffers, ambient.volume, generation);
        return true;
      }
      if (ambient.mode === 'campfire') {
        if (this.season !== 'winter' || !this.campfireLit) return false;
        this.startCampfire(buffers, ambient.volume, generation, ambientGeneration);
        return true;
      }
      if (ambient.mode === 'water') {
        this.startWater(buffers[0], ambient.volume, generation, ambientGeneration);
        return true;
      }
      const entry = this.start(buffers[0], { volume: ambient.volume, pitch: ambient.pitch ?? 1, ambient: true });
      this.ambient = entry;
      return Boolean(entry);
    } catch { return false; }
    finally { if (this.ambientRequest === request) this.ambientRequest = null; }
  }

  startRain(buffers, volume, generation) {
    const context = this.pool.context;
    const bus = context.createGain();
    bus.connect(this.master);
    bus.gain.setValueAtTime(0, context.currentTime);
    bus.gain.linearRampToValueAtTime(volume, context.currentTime + .22);
    const manager = {
      mode: 'rain', buffers, bus, generation, ambientGeneration: this.ambientGeneration,
      voices: new Set(), timer: null,
      stopped: false, nextTick: context.currentTime + AMBIENT_TICK_SECONDS, soundTime: 0,
    };
    this.ambient = manager;
    this.pumpRain(manager);
  }

  pumpAmbientTicks(manager, scheduleTick, pump) {
    if (manager.timer !== null) this.timers.clearTimeout(manager.timer);
    manager.timer = null;
    if (manager.stopped || manager !== this.ambient || manager.generation !== this.generation
      || manager.ambientGeneration !== this.ambientGeneration || !this.ready()) return;
    const now = this.pool.context.currentTime;
    for (const voice of [...manager.voices]) if (voice.endAt <= now) this.finish(voice);
    // A delayed timer skips elapsed ticks instead of replaying a backlog of sounds.
    if (manager.nextTick < now) {
      manager.nextTick = now + AMBIENT_TICK_SECONDS;
      manager.soundTime = 0;
    }
    while (manager.nextTick <= now + AMBIENT_LOOKAHEAD_SECONDS + 1e-8) {
      scheduleTick(manager.nextTick);
      manager.nextTick += AMBIENT_TICK_SECONDS;
    }
    manager.timer = this.timers.setTimeout(pump, AMBIENT_TIMER_MS);
  }

  pumpRain(manager) {
    this.pumpAmbientTicks(manager, when => {
      // WeatherEffectRenderer: nextInt(3) < rainSoundTime++, then reset after a rain sound.
      if (Math.floor(this.random() * 3) < manager.soundTime++) {
        manager.soundTime = 0;
        if (manager.voices.size < MAX_RAIN_VOICES) {
          this.start(this.choose(manager.buffers), {
            volume: 1, ambient: true, loop: false, fadeIn: 0,
            when, destination: manager.bus, owner: manager,
          });
        }
      }
    }, () => this.pumpRain(manager));
  }

  startCampfire(buffers, volume, generation, ambientGeneration) {
    const context = this.pool.context;
    const bus = context.createGain();
    bus.connect(this.master);
    bus.gain.setValueAtTime(volume, context.currentTime);
    const manager = {
      mode: 'campfire', buffers, bus, generation, ambientGeneration,
      voices: new Set(), timer: null, stopped: false,
      nextTick: context.currentTime, nextPlayAt: context.currentTime, previousBuffer: null,
    };
    this.ambient = manager;
    this.pumpCampfire(manager);
  }

  pumpCampfire(manager) {
    this.pumpAmbientTicks(manager, when => {
      if (when + 1e-8 < manager.nextPlayAt) return;
      if (manager.voices.size < MAX_CAMPFIRE_VOICES) {
        const candidates = manager.buffers.length > 1
          ? manager.buffers.filter(buffer => buffer !== manager.previousBuffer) : manager.buffers;
        const buffer = this.choose(candidates);
        this.start(buffer, {
          volume: 1, pitch: .92 + .16 * this.random(),
          ambient: true, loop: false, fadeIn: 0, when,
          destination: manager.bus, owner: manager,
        });
        manager.previousBuffer = buffer;
      }
      // Overlap the original recordings' quiet heads and tails for a steady close campfire.
      manager.nextPlayAt = when + .8 + .3 * this.random();
    }, () => this.pumpCampfire(manager));
  }

  startWater(buffer, volume, generation, ambientGeneration) {
    const context = this.pool.context;
    const bus = context.createGain();
    bus.connect(this.master);
    bus.gain.setValueAtTime(volume, context.currentTime);
    const manager = {
      mode: 'water', buffer, bus, generation, ambientGeneration,
      voices: new Set(), timer: null, stopped: false,
      nextTick: context.currentTime + AMBIENT_TICK_SECONDS, nextPlayAt: context.currentTime,
    };
    this.ambient = manager;
    this.pumpWater(manager);
  }

  pumpWater(manager) {
    this.pumpAmbientTicks(manager, when => {
      if (when + 1e-8 < manager.nextPlayAt) return;
      if (manager.voices.size < MAX_WATER_VOICES) {
        this.start(manager.buffer, {
          volume: .75 + this.random() * .25, pitch: .5 + this.random(),
          ambient: true, loop: false, fadeIn: 0, when,
          destination: manager.bus, owner: manager,
        });
      }
      // Overlap the vanilla water sample's quiet ends for a continuous small stream.
      manager.nextPlayAt = when + .65 + this.random() * .35;
    }, () => this.pumpWater(manager));
  }

  playBreak(kind) {
    return this.playEffect(`break:${kind}`, this.assets.break?.[kind], kind === 'glass' ? .19 : kind === 'crop' ? .2 : .18, .92 + this.random() * .16);
  }

  playPickup() {
    return this.playEffect('pickup', this.assets.pickup, .18, 1.8 + this.random() * .4);
  }

  playCampfireToggle(lit) {
    const action = lit ? 'ignite' : 'extinguish';
    return this.playEffect(`campfire:${action}`, this.assets.campfire?.[action], .35, lit ? .8 + .4 * this.random() : 1);
  }

  async playEffect(key, urls, volume, pitch) {
    if (this.disposed || !this.active || !this.pool || !urls?.length) return false;
    const requestedAt = this.now();
    const last = this.lastEffects.get(key) ?? -Infinity;
    if (requestedAt - last < (key === 'pickup' ? 100 : 65)) return false;
    this.lastEffects.set(key, requestedAt);
    const generation = this.generation;
    try {
      if (this.unlockPromise) await this.unlockPromise;
      if (!this.ready() || generation !== this.generation) return false;
      this.attach();
      const buffer = await loadBuffer(this.pool, this.choose(urls), this.fetcher);
      if (!buffer || !this.ready() || generation !== this.generation || this.now() - requestedAt > 600) return false;
      const effects = [...this.sources].filter(entry => !entry.ambient);
      if (effects.length >= 6) this.stop(effects[0]);
      return Boolean(this.start(buffer, { volume, pitch }));
    } catch { return false; }
  }

  start(buffer, { volume, pitch = 1, ambient = false, loop = ambient, fadeIn = ambient ? .22 : 0, when = this.pool.context.currentTime, destination = this.master, owner = null }) {
    const context = this.pool.context;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const entry = { source, gain, ambient, owner, endAt: loop ? Infinity : when + buffer.duration / pitch };
    this.sources.add(entry);
    owner?.voices.add(entry);
    try {
      source.buffer = buffer;
      source.loop = loop;
      source.playbackRate.value = pitch;
      source.connect(gain);
      gain.connect(destination);
      gain.gain.setValueAtTime(fadeIn ? 0 : volume, when);
      if (fadeIn) gain.gain.linearRampToValueAtTime(volume, when + fadeIn);
      source.onended = () => this.finish(entry);
      source.start(when);
      return entry;
    } catch {
      this.stop(entry);
      return null;
    }
  }

  finish(entry) {
    this.sources.delete(entry);
    if (entry.owner) {
      entry.owner.voices.delete(entry);
      if (entry.owner.stopped && !entry.owner.voices.size) entry.owner.bus.disconnect();
    }
    if (this.ambient === entry) this.ambient = null;
    entry.source.onended = null;
    try { entry.source.disconnect(); } catch { /* Already detached. */ }
    try { entry.gain.disconnect(); } catch { /* Already detached. */ }
  }

  stop(entry, fade = 0) {
    if (fade) {
      try {
        const time = this.pool.context.currentTime;
        entry.gain.gain.cancelScheduledValues(time);
        entry.gain.gain.setValueAtTime(entry.gain.gain.value, time);
        entry.gain.gain.linearRampToValueAtTime(0, time + fade);
        entry.source.stop(time + fade);
        return;
      } catch { /* Stop immediately if a scheduled source already ended. */ }
    }
    try { entry.source.stop(); } catch { /* A source may already have ended. */ }
    this.finish(entry);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.invalidate();
    for (const entry of [...this.sources]) this.stop(entry);
    try { this.master?.disconnect(); } catch { /* Already detached. */ }
    this.master = null;
  }
}
