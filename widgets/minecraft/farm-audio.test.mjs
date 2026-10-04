import test from 'node:test';
import assert from 'node:assert/strict';
import { FarmAudio, FARM_AUDIO_ASSETS } from './farm-audio.mjs';

const assets = {
  break: { crop: ['crop'], grass: ['grass'], wood: ['wood'], glass: ['glass'] },
  pickup: ['pickup'],
  ambient: { summer: { urls: ['rain'], volume: .1 }, autumn: { urls: ['elytra'], volume: .045 } },
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

class Param {
  value = 1;
  events = [];
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}

class Context {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  sources = [];
  resumeCalls = 0;
  decodes = 0;
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  async decodeAudioData(bytes) { this.decodes++; return { bytes, duration: .5 }; }
  createGain() { return { gain: new Param(), connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; } }; }
  createBufferSource() {
    const source = {
      playbackRate: new Param(), started: false, stopped: false, connected: false,
      connect() { this.connected = true; }, disconnect() { this.connected = false; },
      start(time) { this.started = true; this.startTime = time; },
      stop(time) { this.stopped = true; this.stopTime = time; if (time === undefined) this.onended?.(); },
    };
    this.sources.push(source);
    return source;
  }
}

function fixture(season = 'spring', overrides = {}) {
  const context = new Context();
  let creations = 0, time = 0;
  const contextFactory = () => { creations++; return context; };
  const fetches = [];
  const fetcher = async url => { fetches.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  const options = { season, assets, contextFactory, fetcher, random: () => .5, now: () => time, ...overrides };
  const audio = new FarmAudio(options);
  return { audio, context, fetches, options, creations: () => creations, advance(ms) { time += ms; context.currentTime = time / 1000; } };
}

test('user gesture unlocks synchronously even while inactive, then starts one faded ambient loop when visible', async () => {
  const { audio, context, creations, fetches } = fixture('summer');
  assert.equal(creations(), 0);
  assert.equal(await audio.playBreak('grass'), false);
  audio.setActive(false);
  const unlocked = audio.unlock();
  assert.equal(creations(), 1);
  assert.equal(context.resumeCalls, 1);
  assert.equal(await unlocked, true);
  assert.deepEqual(fetches, []);
  assert.equal(context.sources.length, 0);
  await audio.setActive(true);
  assert.deepEqual(fetches, ['rain']);
  assert.equal(context.sources.length, 1);
  const ambient = [...audio.sources][0];
  assert.equal(ambient.source.loop, true);
  assert.deepEqual(ambient.gain.gain.events, [['set', 0, 0], ['ramp', .1, .22]]);
  await audio.unlock();
  await audio.setActive(true);
  assert.equal(context.sources.length, 1);
  audio.dispose();
  assert.equal(ambient.source.stopped, true);
  assert.equal(ambient.source.connected, false);
});

test('a sound requested in the unlock gesture waits for resume, and decoded buffers survive season component replacement', async () => {
  const f = fixture();
  const resume = deferred();
  f.context.resume = () => { f.context.resumeCalls++; return resume.promise.then(() => { f.context.state = 'running'; }); };
  const unlock = f.audio.unlock();
  const sound = f.audio.playBreak('grass');
  await flush();
  assert.equal(f.context.sources.length, 0);
  resume.resolve();
  assert.equal(await unlock, true);
  assert.equal(await sound, true);
  f.audio.dispose();
  const next = new FarmAudio(f.options);
  await next.unlock();
  assert.equal(await next.playBreak('grass'), true);
  assert.equal(f.creations(), 1);
  assert.equal(f.context.decodes, 1);
  assert.deepEqual(f.fetches, ['grass']);
  next.dispose();
});

test('slow decoding cannot play stale ambience or effects after a season change, hide, or disposal', async () => {
  for (const change of ['season', 'hide', 'dispose']) {
    const f = fixture('summer');
    const decoding = deferred();
    f.context.decodeAudioData = () => decoding.promise;
    await f.audio.unlock();
    const effect = f.audio.playBreak('grass');
    await flush();
    if (change === 'season') await f.audio.setSeason('winter');
    else if (change === 'hide') await f.audio.setActive(false);
    else f.audio.dispose();
    decoding.resolve({ duration: .5 });
    await effect;
    await flush();
    assert.equal(f.context.sources.length, 0, `${change} must invalidate both pending sound types`);
    f.audio.dispose();
  }
});

test('hidden widgets stop all sound, rapid effects are throttled and capped, and returning reuses ambient buffers', async () => {
  const f = fixture('summer');
  await f.audio.unlock();
  await flush();
  assert.equal(await f.audio.playBreak('grass'), true);
  assert.equal(await f.audio.playBreak('grass'), false);
  for (let index = 0; index < 9; index++) { f.advance(70); assert.equal(await f.audio.playBreak('grass'), true); }
  assert.equal([...f.audio.sources].filter(entry => !entry.ambient).length, 6);
  assert.equal([...f.audio.sources].filter(entry => entry.ambient).length, 1);
  await f.audio.playPickup();
  assert.equal(await f.audio.playPickup(), false);
  const playing = [...f.audio.sources];
  await f.audio.setActive(false);
  assert.equal(f.audio.sources.size, 0);
  assert.ok(playing.every(entry => entry.source.stopped && !entry.source.connected));
  assert.equal(await f.audio.playPickup(), false);
  await f.audio.setActive(true);
  assert.equal(f.fetches.filter(url => url === 'rain').length, 1);
  assert.equal([...f.audio.sources].filter(entry => entry.ambient).length, 1);
  f.audio.dispose();
});

test('autoplay, network and decoding failures remain silent without rejecting caller promises', async () => {
  const autoplay = fixture('summer');
  autoplay.context.resume = () => Promise.reject(new Error('NotAllowedError'));
  assert.equal(await autoplay.audio.unlock(), false);
  assert.equal(await autoplay.audio.playPickup(), false);
  autoplay.audio.dispose();
  for (const failure of ['fetch', 'decode']) {
    const f = fixture();
    if (failure === 'fetch') f.audio.fetcher = () => Promise.reject(new Error('offline'));
    else f.context.decodeAudioData = () => Promise.reject(new Error('invalid audio'));
    await f.audio.unlock();
    assert.equal(await f.audio.playBreak('wood'), false);
    assert.equal(f.context.sources.length, 0);
    f.audio.dispose();
  }
});

test('a transient load or decode failure is retried on the next interaction', async () => {
  for (const failure of ['fetch', 'decode']) {
    const f = fixture();
    let attempts = 0;
    if (failure === 'fetch') {
      const fetcher = f.audio.fetcher;
      f.audio.fetcher = url => ++attempts === 1 ? Promise.reject(new Error('offline')) : fetcher(url);
    } else {
      f.context.decodeAudioData = async () => {
        if (++attempts === 1) throw new Error('temporary decoder failure');
        return { duration: .5 };
      };
    }
    await f.audio.unlock();
    assert.equal(await f.audio.playBreak('wood'), false);
    f.advance(70);
    assert.equal(await f.audio.playBreak('wood'), true);
    assert.equal(attempts, 2);
    assert.equal(f.context.sources.length, 1);
    f.audio.dispose();
  }
});

function rainFixture(random = () => .5) {
  const pending = new Map();
  let timerId = 0;
  const timers = {
    setTimeout(callback, delay) { const id = ++timerId; pending.set(id, { callback, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  const rain = { mode: 'rain', urls: Array.from({ length: 8 }, (_, index) => `rain${index + 1}`), volume: .07 };
  const f = fixture('summer', { assets: { ...assets, ambient: { ...assets.ambient, summer: rain } }, random, timers });
  f.context.decodeAudioData = async bytes => { f.context.decodes++; return { bytes, duration: 2.01 }; };
  return {
    ...f, pending,
    pump(milliseconds = 50) {
      f.advance(milliseconds);
      assert.equal(pending.size, 1);
      const [id, timer] = [...pending][0];
      assert.equal(timer.delay, 50);
      pending.delete(id);
      timer.callback();
    },
  };
}

test('rain follows two, three, or four 20 Hz ticks, overlapping original samples without individual fade-in', async () => {
  for (const [random, expectedInterval] of [[0, .1], [.5, .15], [.99, .2]]) {
    const f = rainFixture(() => random);
    await f.audio.unlock();
    await flush();
    assert.equal(f.context.decodes, 8);
    assert.equal(f.fetches.length, 8);
    for (let tick = 0; tick < 120; tick++) {
      f.pump();
      assert.ok(f.audio.sources.size <= 24, 'scheduled and playing rain voices must stay bounded');
    }
    assert.ok(f.audio.sources.size > 1);
    assert.ok(f.context.sources.every(source => source.loop === false));
    for (let index = 1; index < f.context.sources.length; index++) {
      const previous = f.context.sources[index - 1];
      const current = f.context.sources[index];
      assert.ok(Math.abs(current.startTime - previous.startTime - expectedInterval) < 1e-8);
      assert.ok(current.startTime < previous.startTime + previous.buffer.duration, 'rain samples must overlap rather than leave gaps');
    }
    const manager = f.audio.ambient;
    assert.deepEqual(manager.bus.gain.events, [['set', 0, 0], ['ramp', .07, .22]]);
    for (const entry of manager.voices) assert.deepEqual(entry.gain.gain.events, [['set', 1, entry.source.startTime]]);
    f.audio.dispose();
    assert.equal(f.pending.size, 0);
  }
});

test('a delayed rain timer discards missed ticks instead of playing a backlog', async () => {
  const f = rainFixture(() => 0);
  await f.audio.unlock();
  await flush();
  const before = f.context.sources.length;
  f.pump(10000);
  const added = f.context.sources.slice(before);
  assert.ok(added.length <= 2, 'only the next 200 ms may be scheduled after a stall');
  assert.ok(added.every(source => source.startTime >= 10 && source.startTime <= 10.2 + 1e-8));
  assert.ok(f.audio.sources.size <= 2, 'expired voices should be removed even if ended callbacks were delayed');
  f.audio.dispose();
});

test('hiding, changing seasons and disposal cancel rain timers and already scheduled voices', async () => {
  for (const change of ['hide', 'season', 'dispose']) {
    const f = rainFixture(() => 0);
    await f.audio.unlock();
    await flush();
    const staleCallback = [...f.pending.values()][0].callback;
    const manager = f.audio.ambient;
    const voices = [...manager.voices];
    const total = f.context.sources.length;
    if (change === 'hide') await f.audio.setActive(false);
    else if (change === 'season') await f.audio.setSeason('winter');
    else f.audio.dispose();
    assert.equal(f.pending.size, 0);
    assert.ok(voices.every(entry => entry.source.stopped));
    staleCallback();
    assert.equal(f.context.sources.length, total, 'cancelled callbacks cannot revive an old season');
    if (change === 'hide') {
      assert.equal(manager.bus.connected, false);
      await f.audio.setActive(true);
      assert.equal(f.pending.size, 1);
      assert.equal(f.context.decodes, 8, 'returning should reuse all decoded rain variants');
    }
    f.audio.dispose();
    assert.equal(f.pending.size, 0);
  }
});

test('wind uses the established elytra intensity gain and pitch without a silent takeoff delay', async () => {
  const f = fixture('autumn', { assets: FARM_AUDIO_ASSETS });
  await f.audio.unlock();
  await flush();
  assert.equal(f.context.sources.length, 1);
  const entry = [...f.audio.sources][0];
  assert.equal(entry.source.loop, true);
  assert.equal(entry.source.startTime, 0);
  assert.ok(Math.abs(entry.source.playbackRate.value - 1.12) < 1e-8);
  assert.deepEqual(entry.gain.gain.events, [['set', 0, 0], ['ramp', .92 * .6 * .58, .22]]);
  f.audio.dispose();
});

function campfireFixture(random = () => .5) {
  const pending = new Map();
  let timerId = 0;
  const timers = {
    setTimeout(callback, delay) { const id = ++timerId; pending.set(id, { callback, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  const winter = { mode: 'campfire', urls: Array.from({ length: 6 }, (_, index) => `crackle${index + 1}`), volume: .6 };
  const campfire = { ignite: ['ignite'], extinguish: ['fizz'] };
  const f = fixture('winter', { assets: { ...assets, campfire, ambient: { ...assets.ambient, winter } }, random, timers });
  f.context.decodeAudioData = async bytes => { f.context.decodes++; return { bytes, duration: 3.9 }; };
  return {
    ...f, pending,
    pump(milliseconds = 50) {
      assert.equal(pending.size, 1);
      const [id, timer] = [...pending][0];
      assert.equal(timer.delay, 50);
      f.advance(milliseconds);
      pending.delete(id);
      timer.callback();
    },
  };
}

test('a lit campfire starts immediately after decoding and repeated gestures retain one schedule', async () => {
  const f = campfireFixture(() => 0);
  await f.audio.unlock();
  await flush();
  assert.equal(f.context.decodes, 8);
  assert.ok(f.fetches.includes('ignite') && f.fetches.includes('fizz'));
  assert.equal(f.context.sources.length, 1, 'decoding the crackles starts one ambient sample immediately');
  assert.equal(f.context.sources[0].startTime, 0);
  const manager = f.audio.ambient;
  assert.deepEqual(manager.bus.gain.events, [['set', .6, 0]], 'the configured campfire bus gain passes through without a fade');
  for (let tick = 0; tick < 120; tick++) {
    const timer = [...f.pending.keys()][0];
    const total = f.context.sources.length;
    await f.audio.unlock();
    await f.audio.setActive(true);
    await f.audio.setCampfireLit(true);
    await flush();
    assert.equal(f.audio.ambient, manager);
    assert.deepEqual([...f.pending.keys()], [timer], 'repeated gestures cannot duplicate or restart the scheduler');
    assert.equal(f.context.sources.length, total, 'repeated gestures do not retrigger the immediate sample');
    f.pump();
  }
  assert.equal(f.context.decodes, 8);
  f.audio.dispose();
  assert.equal(f.pending.size, 0);
});

test('campfire crackles stay continuous for thirty seconds without repeating the previous sample or fading each voice', async () => {
  for (const random of [0, .5, .999]) {
    const f = campfireFixture(() => random);
    await f.audio.unlock();
    await flush();
    const manager = f.audio.ambient;
    for (let tick = 0; tick < 600; tick++) {
      f.pump();
      assert.ok(manager.voices.size <= 8);
      assert.ok([...manager.voices].some(entry => entry.source.startTime <= f.context.currentTime + 1e-8 && entry.endAt > f.context.currentTime), 'the fire has no silent scheduling gaps');
      for (const entry of manager.voices) {
        assert.equal(entry.source.loop, false);
        assert.ok(Math.abs(entry.source.playbackRate.value - (.92 + .16 * random)) < 1e-8);
        assert.deepEqual(entry.gain.gain.events, [['set', 1, entry.source.startTime]], 'only the bus scales volume; individual crackles start at full event gain');
      }
    }
    assert.ok(f.context.sources.length >= 27, 'crackles keep arriving throughout the thirty-second sample');
    for (let index = 1; index < f.context.sources.length; index++) {
      const previous = f.context.sources[index - 1], current = f.context.sources[index];
      const interval = current.startTime - previous.startTime;
      assert.ok(interval >= .8 - 1e-8 && interval <= 1.1 + 1e-8, 'the next crackle arrives within the continuous cadence');
      assert.notEqual(current.buffer, previous.buffer, 'even a repeated random value cannot replay the previous variant');
      assert.ok(current.startTime < previous.startTime + previous.buffer.duration / previous.playbackRate.value, 'original sample tails overlap naturally');
    }
    assert.equal(manager.bus.gain.value, .6);
    f.audio.dispose();
    assert.equal(f.pending.size, 0);
  }
});

test('campfire voice limits hold for long samples and a delayed timer schedules no backlog', async () => {
  const f = campfireFixture(() => 0);
  f.context.decodeAudioData = async bytes => { f.context.decodes++; return { bytes, duration: 30 }; };
  await f.audio.unlock();
  await flush();
  for (let tick = 0; tick < 400; tick++) {
    f.pump();
    assert.ok(f.audio.ambient.voices.size <= 8);
  }
  assert.equal(f.audio.ambient.voices.size, 8, 'unexpectedly long samples still obey the voice cap');
  const before = f.context.sources.length;
  f.pump(40000);
  const added = f.context.sources.slice(before);
  assert.equal(added.length, 1, 'a stalled timer schedules one upcoming crackle rather than replaying elapsed intervals');
  assert.ok(added[0].startTime >= 60 && added[0].startTime <= 60.2 + 1e-8);
  assert.equal(f.audio.ambient.voices.size, 1, 'expired voices are removed even when ended callbacks arrive late');
  assert.equal(f.pending.size, 1);
  f.audio.dispose();
});

test('extinguishing the fire cancels only crackles while playing and decoding interaction sounds survive', async () => {
  const f = campfireFixture(() => .99);
  const glass = deferred();
  f.audio.fetcher = async url => ({ ok: true, arrayBuffer: async () => { const bytes = new ArrayBuffer(4); bytes.url = url; return bytes; } });
  f.context.decodeAudioData = bytes => bytes.url === 'glass' ? glass.promise : Promise.resolve({ duration: 3.9 });
  await f.audio.unlock();
  await flush();
  const fire = [...f.audio.ambient.voices][0];
  const staleCallback = [...f.pending.values()][0].callback;
  assert.equal(await f.audio.playPickup(), true);
  const pickup = [...f.audio.sources].find(entry => !entry.ambient);
  const breakSound = f.audio.playBreak('glass');
  await flush();
  await f.audio.setCampfireLit(false);
  assert.equal(await f.audio.playCampfireToggle(false), true, 'extinguishing feedback must survive the ambient invalidation');
  assert.equal(f.pending.size, 0);
  assert.equal(fire.source.stopped, true);
  assert.equal(pickup.source.stopped, false);
  staleCallback();
  glass.resolve({ duration: .5 });
  assert.equal(await breakSound, true);
  assert.equal([...f.audio.sources].filter(entry => !entry.ambient).length, 3);
  assert.equal([...f.audio.sources].filter(entry => entry.ambient).length, 0);
  f.audio.dispose();
});

test('extinguishing and relighting during decode cannot start stale or duplicate campfire schedules', async () => {
  const f = campfireFixture(() => .99);
  const decoding = deferred();
  f.context.decodeAudioData = () => decoding.promise;
  await f.audio.unlock();
  await flush();
  await f.audio.setCampfireLit(false);
  const relighting = f.audio.setCampfireLit(true);
  decoding.resolve({ duration: 3.9 });
  assert.equal(await relighting, true);
  await flush();
  assert.equal(f.context.sources.length, 1, 'only the current relight request may start the immediate crackle');
  assert.equal(f.context.sources[0].startTime, 0);
  assert.equal(f.pending.size, 1);
  f.audio.dispose();
});

test('campfire lifecycle cancellation is immediate and visibility or season changes preserve its lit state', async () => {
  for (const change of ['hide', 'season', 'dispose']) {
    const f = campfireFixture(() => .99);
    await f.audio.unlock();
    await flush();
    const manager = f.audio.ambient;
    const voice = [...manager.voices][0];
    const staleCallback = [...f.pending.values()][0].callback;
    const total = f.context.sources.length;
    if (change === 'hide') await f.audio.setActive(false);
    else if (change === 'season') await f.audio.setSeason('spring');
    else f.audio.dispose();
    assert.equal(f.pending.size, 0);
    assert.equal(voice.source.stopped, true);
    assert.equal(voice.source.stopTime, undefined, 'fire must stop immediately instead of fading after leaving');
    assert.equal(manager.bus.connected, false);
    staleCallback();
    assert.equal(f.context.sources.length, total);
    if (change !== 'dispose') {
      await f.audio.setCampfireLit(false);
      if (change === 'hide') await f.audio.setActive(true);
      else await f.audio.setSeason('winter');
      assert.equal(f.pending.size, 0);
      assert.equal(f.context.sources.length, total);
      await f.audio.setCampfireLit(true);
      assert.equal(f.pending.size, 1);
      assert.equal(f.context.decodes, 8, 'relighting reuses decoded crackles and feedback');
    }
    f.audio.dispose();
  }
});

test('campfire state changes never replay toggle effects and explicit feedback does not wait for crackles', async () => {
  const f = campfireFixture(() => 0);
  const crackles = deferred();
  f.audio.fetcher = async url => ({ ok: true, arrayBuffer: async () => { const bytes = new ArrayBuffer(4); bytes.url = url; return bytes; } });
  f.context.decodeAudioData = bytes => bytes.url.startsWith('crackle') ? crackles.promise : Promise.resolve({ bytes, duration: .5 });
  await f.audio.unlock();
  await flush();
  await f.audio.setCampfireLit(false);
  assert.equal(f.context.sources.length, 0, 'setting the initial or restored state must never create a toggle effect');
  assert.equal(await f.audio.playCampfireToggle(false), true);
  const relighting = f.audio.setCampfireLit(true);
  assert.equal(await f.audio.playCampfireToggle(true), true, 'ignition must not wait for the ambient decode');
  const effects = [...f.audio.sources];
  assert.deepEqual(effects.map(entry => entry.source.buffer.bytes.url), ['fizz', 'ignite']);
  assert.deepEqual(effects.map(entry => entry.source.playbackRate.value), [1, .8]);
  for (const entry of effects) {
    assert.equal(entry.ambient, false);
    assert.equal(entry.source.loop, false);
    assert.deepEqual(entry.gain.gain.events, [['set', .35, 0]]);
  }
  crackles.resolve({ duration: 3.9 });
  await relighting;
  await flush();
  assert.equal(f.context.sources.length, 3, 'decode completion adds only the immediate ambient crackle');
  assert.deepEqual([...f.audio.sources].filter(entry => !entry.ambient), effects, 'neither toggle effect is replayed after crackle decoding');
  assert.equal([...f.audio.sources].filter(entry => entry.ambient).length, 1);
  f.audio.dispose();
});

function waterFixture(random = () => .5) {
  const pending = new Map();
  let timerId = 0;
  const timers = {
    setTimeout(callback, delay) { const id = ++timerId; pending.set(id, { callback, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  const f = fixture('spring', { assets: { ...assets, ambient: { spring: FARM_AUDIO_ASSETS.ambient.spring } }, random, timers });
  f.context.decodeAudioData = async bytes => { f.context.decodes++; return { bytes, duration: 2.578 }; };
  return {
    ...f, pending,
    pump(milliseconds = 50) {
      assert.equal(pending.size, 1);
      const [id, timer] = [...pending][0];
      assert.equal(timer.delay, 50);
      f.advance(milliseconds);
      pending.delete(id);
      timer.callback();
    },
  };
}

test('spring water overlaps one cached original sample without extra fades or duplicate schedules', async () => {
  for (const random of [0, .5, .999]) {
    const f = waterFixture(() => random);
    await f.audio.unlock();
    await flush();
    const manager = f.audio.ambient;
    assert.equal(manager.mode, 'water');
    assert.equal(f.fetches.length, 1);
    assert.ok(f.fetches[0].endsWith('/assets/sounds/liquid/water.ogg'));
    for (let tick = 0; tick < 240; tick++) {
      if (tick % 30 === 0) {
        const timer = [...f.pending.keys()][0], total = f.context.sources.length;
        await f.audio.unlock();
        assert.equal(f.audio.ambient, manager);
        assert.deepEqual([...f.pending.keys()], [timer]);
        assert.equal(f.context.sources.length, total, 'repeated gestures must not add another water source or scheduler');
      }
      f.pump();
      assert.ok(manager.voices.size <= 8);
      for (const entry of manager.voices) {
        assert.equal(entry.source.loop, false);
        assert.equal(entry.source.playbackRate.value, .5 + random);
        assert.deepEqual(entry.gain.gain.events, [['set', .75 + random * .25, entry.source.startTime]]);
      }
    }
    assert.equal(f.context.decodes, 1);
    assert.ok(manager.voices.size > 1, 'water sample ends must overlap for continuity');
    assert.deepEqual(manager.bus.gain.events, [['set', FARM_AUDIO_ASSETS.ambient.spring.volume, 0]]);
    for (let index = 1; index < f.context.sources.length; index++) {
      const previous = f.context.sources[index - 1], current = f.context.sources[index];
      assert.equal(current.buffer, previous.buffer);
      assert.ok(current.startTime < previous.startTime + previous.buffer.duration / previous.playbackRate.value);
    }
    f.audio.dispose();
  }
});

test('spring water cancels across lifecycle changes and delayed decoding or timers cannot leak or catch up', async () => {
  for (const slowDecode of [false, true]) {
    for (const change of ['hide', 'season', 'dispose']) {
      const f = waterFixture();
      const decoding = deferred();
      if (slowDecode) f.context.decodeAudioData = bytes => {
        f.context.decodes++;
        return decoding.promise.then(() => ({ bytes, duration: 2.578 }));
      };
      await f.audio.unlock();
      await flush();
      const manager = f.audio.ambient;
      const voices = [...(manager?.voices ?? [])];
      const staleCallback = [...f.pending.values()][0]?.callback;
      if (change === 'hide') await f.audio.setActive(false);
      else if (change === 'season') await f.audio.setSeason('winter');
      else f.audio.dispose();
      assert.equal(f.pending.size, 0);
      for (const entry of voices) {
        assert.equal(entry.source.stopped, true);
        assert.equal(entry.source.stopTime, change === 'season' ? .08 : undefined);
        if (change === 'season') entry.source.onended?.();
      }
      if (manager) assert.equal(manager.bus.connected, false);
      staleCallback?.();
      decoding.resolve();
      await flush();
      assert.equal(f.context.sources.length, slowDecode ? 0 : 1);
      assert.equal(f.pending.size, 0, 'stale callbacks and decodes cannot resurrect spring water');
      if (change !== 'dispose') {
        if (change === 'hide') await f.audio.setActive(true);
        else await f.audio.setSeason('spring');
        assert.equal(f.pending.size, 1);
        assert.equal(f.context.decodes, 1, 'returning should reuse the decoded water sample');
        assert.equal(f.fetches.length, 1);
      }
      f.audio.dispose();
    }
  }
  const f = waterFixture();
  await f.audio.unlock();
  await flush();
  const before = f.context.sources.length;
  f.pump(30000);
  const added = f.context.sources.slice(before);
  assert.equal(added.length, 1, 'a long timer stall may schedule one upcoming water sound, never missed samples');
  assert.ok(added[0].startTime >= 30 && added[0].startTime <= 30.2);
  assert.equal(f.audio.ambient.voices.size, 1);
  f.audio.dispose();
});
