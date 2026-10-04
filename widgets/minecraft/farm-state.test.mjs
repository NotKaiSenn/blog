import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_IDLE_MS,
  MATURE_STAGE,
  PATCH_RADIUS,
  PICKUP_DURATION_MS,
  beginCollection,
  addSceneDrops,
  collectDrop,
  createFarmState,
  finishCollection,
  getPatchPlots,
  growNaturally,
  interactWithPatch,
  interactWithPlot,
  recordInteraction,
  resetFarmState,
} from './farm-state.mjs';

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('six independent plots occupy the small two-row field', () => {
  const state = createFarmState();
  assert.equal(state.plots.length, 6);
  assert.equal(new Set(state.plots.map((plot) => plot.id)).size, 6);
  assert.ok(state.plots.every(({ x, z }) => x >= 1 && x <= 3 && (z === 0 || z === 1)));
  assert.ok(state.plots.some(({ stage }) => stage === 0));
  assert.ok(state.plots.some(({ stage }) => stage === MATURE_STAGE));
  interactWithPlot(state, 0, 10);
  assert.equal(createFarmState().plots[0].stage, 0);
});

test('season layouts remain independent and reset to their own original crops', () => {
  const layout = [{ x: 0, z: 2, stage: 3 }, { x: 3, z: 1, stage: 7 }];
  const state = createFarmState(0, layout);
  const initial = structuredClone(state.plots);
  interactWithPatch(state, '3:1', 100);
  assert.equal(state.drops.length, 2);
  const nextDropId = state.nextDropId;
  resetFarmState(state, 500);
  assert.deepEqual(state.plots, initial);
  assert.deepEqual(layout, [{ x: 0, z: 2, stage: 3 }, { x: 3, z: 1, stage: 7 }]);
  assert.equal(state.nextDropId, nextDropId);
  assert.deepEqual(state.drops, []);
});

test('seasonal fruit stacks collect once without being credited as wheat or seeds', () => {
  const state = createFarmState(100);
  state.drops.push({ id: state.nextDropId++, kind: 'melon', count: 3, x: 0, z: 0, createdAt: 100, collectingAt: null });
  const batch = beginCollection(state, 100 + COLLECTION_IDLE_MS);
  const end = 100 + COLLECTION_IDLE_MS + PICKUP_DURATION_MS;
  assert.equal(finishCollection(state, batch.dropIds, end).type, 'collect');
  assert.equal(finishCollection(state, batch.dropIds, end + 50).type, 'noop');
  assert.deepEqual(state.collectedItems, { melon: 3 });
  assert.equal(state.collectedCount, 0);
  assert.equal(state.collectedSeeds, 0);
});

test('optional natural growth varies by one or two stages and leaves mature crops for harvest', () => {
  const state = createFarmState(0, [{ x: 2, z: 1, stage: 1 }, { x: 2, z: 2, stage: 6 }]);
  const initial = structuredClone(state);
  assert.equal(growNaturally(state, 5000, undefined).type, 'noop');
  assert.deepEqual(state, initial);
  assert.equal(growNaturally(state, 2399, 2400).type, 'noop');
  let randomCalls = 0;
  const result = growNaturally(state, 2400, 2400, () => randomCalls++ ? .99 : 0);
  assert.deepEqual(result.actions.map(({ previousStage, plot }) => [previousStage, plot.stage]), [[1, 2], [6, 7]]);
  for (let now = 4800; now <= 12000; now += 2400) growNaturally(state, now, 2400, () => .99);
  assert.ok(state.plots.every(plot => plot.stage === MATURE_STAGE));
  assert.equal(state.totalHarvested, 0);
  assert.deepEqual(state.drops, []);
  assert.equal(state.lastInteractionAt, 0);
  const harvest = interactWithPatch(state, '2:1', 13000);
  assert.equal(harvest.drops.length, 4);
  assert.equal(state.totalHarvested, 2);
});

test('natural crop growth does not postpone collection or restart an in-flight pickup', () => {
  const state = createFarmState(0, [{ x: 2, z: 1, stage: 0 }]);
  const drops = addSceneDrops(state, [{ kind: 'sugar_cane', count: 2, x: 1, z: 1 }], 0);
  growNaturally(state, 2400, 2400, () => 0);
  const batch = beginCollection(state, COLLECTION_IDLE_MS);
  assert.deepEqual(batch.dropIds, drops.map(drop => drop.id));
  growNaturally(state, COLLECTION_IDLE_MS + 100, 600, () => .99);
  assert.equal(state.lastInteractionAt, 0);
  assert.equal(drops[0].collectingAt, COLLECTION_IDLE_MS);
  finishCollection(state, batch.dropIds, COLLECTION_IDLE_MS + PICKUP_DURATION_MS);
  assert.deepEqual(state.collectedItems, { sugar_cane: 2 });
});

test('scene drops preserve source height and stack counts through collection', () => {
  const state = createFarmState(0, []);
  const specs = [
    { kind: 'sugar_cane', count: 3, x: 1, z: 2, y: 2 },
    { kind: 'red_mushroom', count: 2, x: 2, z: 1 },
    { kind: 'brown_mushroom', x: 3, z: 1 },
  ];
  const drops = addSceneDrops(state, specs, 500);
  recordInteraction(state, 500);
  assert.equal(drops[0].y, 2);
  assert.equal(drops[2].count, 1);
  assert.equal(new Set(drops.map(drop => drop.id)).size, 3);
  assert.ok(drops.every(drop => drop.createdAt === 500 && drop.collectingAt === null && drop.plotId === null));
  const batch = beginCollection(state, 500 + COLLECTION_IDLE_MS);
  finishCollection(state, batch.dropIds, 500 + COLLECTION_IDLE_MS + PICKUP_DURATION_MS);
  assert.deepEqual(state.collectedItems, { sugar_cane: 3, red_mushroom: 2, brown_mushroom: 1 });
  assert.equal(state.collectedCount, 0);
  assert.equal(state.collectedSeeds, 0);
  assert.deepEqual(specs[0], { kind: 'sugar_cane', count: 3, x: 1, z: 2, y: 2 });
});

test('clicks advance all eight wheat stages before releasing wheat and seeds', () => {
  const state = createFarmState();
  const plot = state.plots[0];

  for (let stage = 1; stage <= MATURE_STAGE; stage += 1) {
    const result = interactWithPlot(state, plot.id, stage * 100);
    assert.equal(result.type, 'grow');
    assert.equal(result.previousStage, stage - 1);
    assert.equal(plot.stage, stage);
    assert.equal(state.totalHarvested, 0);
    assert.equal(state.lastInteractionAt, stage * 100);
  }

  const result = interactWithPlot(state, 0, 800);
  assert.equal(result.type, 'harvest');
  assert.equal(plot.stage, 0);
  assert.deepEqual(result.drops.map(({ kind }) => kind), ['wheat', 'seeds']);
  assert.ok(result.drops.every((drop) => drop.plotId === plot.id && drop.x === plot.x && drop.z === plot.z));
  assert.ok(result.drops.every((drop) => drop.count === 1 && drop.createdAt === 800 && drop.collectingAt === null));
  assert.equal(state.totalHarvested, 1);
  assert.equal(state.collectedCount, 0);
  assert.equal(interactWithPlot(state, plot.id, 900).type, 'grow');
  assert.equal(plot.stage, 1);
});

test('one click grows the cursor patch by random amounts while leaving distant crops alone', () => {
  const growthSteps = new Set();

  for (let seed = 1; seed <= 40; seed += 1) {
    const state = createFarmState();
    for (const plot of state.plots) plot.stage = 0;
    const center = state.plots[1];
    const result = interactWithPatch(state, center.id, 100, seededRandom(seed));

    assert.equal(result.type, 'patch');
    assert.equal(result.plot, center);
    assert.deepEqual(result.affectedPlotIds, ['2:0', '1:0', '3:0', '2:1']);
    assert.deepEqual(result.drops, []);
    for (const plot of state.plots) {
      if (result.affectedPlotIds.includes(plot.id)) {
        assert.ok(Math.hypot(plot.x - center.x, plot.z - center.z) <= PATCH_RADIUS);
        assert.ok(plot.stage >= 2 && plot.stage <= 4);
        growthSteps.add(plot.stage);
      } else {
        assert.equal(plot.stage, 0);
      }
    }
    assert.equal(state.lastInteractionAt, 100);
  }

  assert.deepEqual([...growthSteps].sort(), [2, 3, 4]);
});

test('cursor position controls patch boundaries with the directly clicked plot always included', () => {
  const state = createFarmState();
  const before = structuredClone(state);
  const idsAt = (x, z) => getPatchPlots(state, '2:0', { x, z }).map(({ id }) => id);

  assert.deepEqual(idsAt(2.05, 0.5), ['2:0', '1:0']);
  assert.deepEqual(idsAt(2, 1), ['2:0', '1:0', '1:1', '2:1']);
  assert.ok(!idsAt(2.44, 0.5).includes('3:0'));
  assert.ok(idsAt(2.46, 0.5).includes('3:0'));
  assert.deepEqual(getPatchPlots(state, '1:0', { x: 1.01, z: 0.01 }).map(({ id }) => id), ['1:0']);
  assert.deepEqual(getPatchPlots(state, '1:0', { x: 100, z: 100 }).map(({ id }) => id), ['1:0']);
  assert.deepEqual(state, before);
});

test('edge patches grow to maturity then harvest every mature crop in the same range', () => {
  const state = createFarmState();
  for (const plot of state.plots) plot.stage = MATURE_STAGE - 1;
  const center = state.plots[0];
  const grown = interactWithPatch(state, center.id, 100, seededRandom(8));

  assert.equal(grown.actions.length, 3);
  assert.ok(grown.actions.every(({ type, plot, previousStage }) =>
    type === 'grow' && previousStage === 6 && plot.stage === MATURE_STAGE));
  assert.ok(grown.actions.every(({ plot }) => Math.hypot(plot.x - center.x, plot.z - center.z) <= PATCH_RADIUS));
  assert.equal(state.totalHarvested, 0);
  assert.deepEqual(state.drops, []);

  const harvest = interactWithPatch(state, center.id, 200, seededRandom(9));
  assert.deepEqual(harvest.affectedPlotIds, grown.affectedPlotIds);
  assert.ok(harvest.actions.every(({ type }) => type === 'harvest'));
  assert.equal(center.stage, 0);
  assert.equal(state.totalHarvested, 3);
  assert.equal(harvest.drops.length, 6);
  assert.equal(harvest.drops.filter(({ kind }) => kind === 'wheat').length, 3);
  assert.equal(harvest.drops.filter(({ kind }) => kind === 'seeds').length, 3);
  assert.ok(harvest.drops.every(({ plotId, createdAt }) => grown.affectedPlotIds.includes(plotId) && createdAt === 200));
  assert.ok(state.plots.filter(({ id }) => !grown.affectedPlotIds.includes(id)).every(({ stage }) => stage === 6));
});

test('a shifted patch harvests ripe crops and grows immature neighbors without harvesting newly ripe crops', () => {
  const state = createFarmState();
  const before = state.plots.map(({ stage }) => stage);
  const center = { x: 2, z: 1 };
  const expected = getPatchPlots(state, '2:0', center).map(({ id }) => id);
  const result = interactWithPatch(state, '2:0', 100, () => 0.99, center);

  assert.deepEqual(result.affectedPlotIds, expected);
  assert.deepEqual(result.actions.map(({ type }) => type), ['grow', 'grow', 'grow', 'harvest']);
  assert.deepEqual(state.plots.map(({ stage }) => stage), [4, 7, before[2], 7, 0, before[5]]);
  assert.equal(state.totalHarvested, 1);
  assert.equal(result.drops.length, 2);
  assert.ok(result.drops.every(({ plotId }) => plotId === '2:1'));
});

test('patch growth resets the shared three-second collection delay', () => {
  const state = createFarmState();
  for (const plot of state.plots) plot.stage = 0;
  const maturePlot = state.plots[2];
  maturePlot.stage = MATURE_STAGE;
  const harvest = interactWithPatch(state, maturePlot.id, 100, seededRandom(2));
  assert.equal(harvest.drops.length, 2);

  interactWithPatch(state, 0, 2800, seededRandom(3));
  assert.equal(beginCollection(state, 5799).type, 'noop');
  const batch = beginCollection(state, 5800);
  assert.deepEqual(batch.dropIds, harvest.drops.map(({ id }) => id));
  assert.equal(finishCollection(state, batch.dropIds, 5800 + PICKUP_DURATION_MS - 1).type, 'noop');
  assert.equal(finishCollection(state, batch.dropIds, 5800 + PICKUP_DURATION_MS).type, 'collect');
});

test('growth, harvesting, and other interaction restart one global idle timer', () => {
  const state = createFarmState();
  const maturePlots = state.plots.filter(({ stage }) => stage === MATURE_STAGE);
  interactWithPlot(state, maturePlots[0].id, 100);
  assert.equal(beginCollection(state, 3099).type, 'noop');

  interactWithPlot(state, 0, 3000);
  assert.equal(beginCollection(state, 5999).type, 'noop');
  interactWithPlot(state, maturePlots[1].id, 5000);
  assert.equal(beginCollection(state, 7999).type, 'noop');
  recordInteraction(state, 7000);
  assert.equal(beginCollection(state, 9999).type, 'noop');

  const batch = beginCollection(state, 7000 + COLLECTION_IDLE_MS);
  assert.equal(batch.type, 'collect-start');
  assert.equal(batch.drops.length, 4);
  assert.equal(new Set(batch.dropIds).size, 4);
  assert.ok(batch.drops.every((drop) => drop.collectingAt === 10000));
});

test('a batch waits for its pickup animation and collects each entity exactly once', () => {
  const state = createFarmState();
  const maturePlot = state.plots.find(({ stage }) => stage === MATURE_STAGE);
  const harvest = interactWithPlot(state, maturePlot.id, 100);
  assert.equal(collectDrop(state, harvest.drop.id, 5000).type, 'noop');

  const start = 100 + COLLECTION_IDLE_MS;
  const batch = beginCollection(state, start);
  assert.equal(beginCollection(state, start).type, 'noop');
  assert.equal(finishCollection(state, batch.dropIds, start + PICKUP_DURATION_MS - 1).type, 'noop');
  assert.equal(state.drops.length, 2);
  assert.equal(state.collectedCount, 0);

  const result = finishCollection(state, [...batch.dropIds, ...batch.dropIds], start + PICKUP_DURATION_MS);
  assert.equal(result.drops.length, 2);
  assert.equal(state.collectedCount, 1);
  assert.equal(state.collectedSeeds, 1);
  assert.equal(state.collectingAt, null);
  assert.deepEqual(state.drops, []);
  assert.equal(finishCollection(state, batch.dropIds, start + 1000).type, 'noop');
});

test('a new harvest during pickup stays out of the existing batch', () => {
  const state = createFarmState();
  const maturePlots = state.plots.filter(({ stage }) => stage === MATURE_STAGE);
  interactWithPlot(state, maturePlots[0].id, 100);
  const firstBatch = beginCollection(state, 3100);
  const secondHarvest = interactWithPlot(state, maturePlots[1].id, 3200);
  finishCollection(state, firstBatch.dropIds, 3100 + PICKUP_DURATION_MS);

  assert.deepEqual(state.drops, secondHarvest.drops);
  assert.ok(state.drops.every((drop) => drop.collectingAt === null));
  assert.equal(state.collectedCount, 1);
  assert.equal(beginCollection(state, 6199).type, 'noop');
  const secondBatch = beginCollection(state, 6200);
  assert.deepEqual(secondBatch.dropIds, secondHarvest.drops.map(({ id }) => id));
  finishCollection(state, secondBatch.dropIds, 6200 + PICKUP_DURATION_MS);
  assert.equal(state.collectedCount, 2);
  assert.equal(state.collectedSeeds, 2);
});

test('collecting merged entities credits their full item counts once', () => {
  const state = createFarmState();
  const harvest = interactWithPlot(state, '3:0', 100);
  harvest.drops[0].count = 5;
  harvest.drops[1].count = 12;
  const batch = beginCollection(state, 3100);

  assert.equal(finishCollection(state, batch.dropIds, 3100 + PICKUP_DURATION_MS - 1).type, 'noop');
  assert.equal(finishCollection(state, batch.dropIds, 3100 + PICKUP_DURATION_MS).type, 'collect');
  assert.equal(state.collectedCount, 5);
  assert.equal(state.collectedSeeds, 12);
  assert.equal(finishCollection(state, batch.dropIds, 3100 + PICKUP_DURATION_MS).type, 'noop');
  assert.equal(state.collectedCount, 5);
  assert.equal(state.collectedSeeds, 12);
});

test('invalid plot and entity identifiers leave the complete farm unchanged', () => {
  const state = createFarmState();
  const before = structuredClone(state);
  for (const value of [-1, 6, 1.5, NaN, Infinity, 'missing', '0', null, undefined, {}, []]) {
    assert.equal(interactWithPlot(state, value, 500).type, 'noop');
    assert.equal(interactWithPatch(state, value, 500, seededRandom(1)).type, 'noop');
    assert.deepEqual(getPatchPlots(state, value), []);
    assert.equal(collectDrop(state, value, 500).type, 'noop');
  }
  assert.equal(beginCollection(state, 5000).type, 'noop');
  assert.deepEqual(state, before);
});

test('reset clears timing and counters while stale callbacks cannot collect new entities', () => {
  const state = createFarmState();
  const maturePlotId = state.plots.find(({ stage }) => stage === MATURE_STAGE).id;
  interactWithPlot(state, maturePlotId, 100);
  const oldBatch = beginCollection(state, 3100);

  assert.equal(resetFarmState(state, 3200), state);
  assert.deepEqual(state.plots, createFarmState().plots);
  assert.deepEqual(state.drops, []);
  assert.equal(state.collectedCount, 0);
  assert.equal(state.collectedSeeds, 0);
  assert.equal(state.totalHarvested, 0);
  assert.equal(state.lastInteractionAt, 3200);
  assert.equal(state.collectingAt, null);

  const newHarvest = interactWithPlot(state, maturePlotId, 3300);
  const newBatch = beginCollection(state, 6300);
  assert.ok(newHarvest.drops.every(({ id }) => !oldBatch.dropIds.includes(id)));
  assert.equal(finishCollection(state, oldBatch.dropIds, 6300 + PICKUP_DURATION_MS).type, 'noop');
  assert.equal(state.collectedCount, 0);
  assert.equal(finishCollection(state, newBatch.dropIds, 6300 + PICKUP_DURATION_MS).type, 'collect');
  assert.equal(state.collectedCount, 1);
  assert.equal(state.collectedSeeds, 1);
});
