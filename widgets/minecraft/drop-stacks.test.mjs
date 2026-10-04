import test from 'node:test';
import assert from 'node:assert/strict';
import { createFarmState, interactWithPatch, beginCollection, finishCollection, COLLECTION_IDLE_MS, PICKUP_DURATION_MS } from './farm-state.mjs';
import { mergeNearbyDrops, MAX_STACK_SIZE, MERGE_DELAY_MS } from './drop-stacks.mjs';

function dropped(id, kind, count = 1, createdAt = 0) {
  return { id, kind, count, createdAt, collectingAt: null };
}

test('nearby same-kind items become counted stacks without losing or mixing items', () => {
  const state = createFarmState(10);
  state.drops = [dropped(1, 'wheat'), dropped(2, 'seeds'), dropped(3, 'wheat', 2), dropped(4, 'seeds')];
  const positions = new Map(state.drops.map(drop => [drop.id, { x: drop.id * .1, y: 0, z: 0 }]));
  const events = mergeNearbyDrops(state, positions, 500);
  assert.equal(events.length, 2);
  assert.equal(state.drops.length, 2);
  assert.deepEqual(state.drops.map(drop => [drop.kind, drop.count]).sort(), [['seeds', 2], ['wheat', 3]]);
  assert.equal(state.drops.find(drop => drop.kind === 'wheat').id, 3);
  assert.equal(state.lastInteractionAt, 10);
  assert.equal(state.collectedCount, 0);
  assert.equal(mergeNearbyDrops(state, positions, 700).length, 0);
});

test('merges respect actual distance, initial toss time, pickup state and stack capacity', () => {
  const state = createFarmState();
  state.drops = [dropped(1, 'wheat', 63), dropped(2, 'wheat', 2), dropped(3, 'wheat'), dropped(4, 'wheat', 1, 450), dropped(5, 'wheat'), dropped(6, 'wheat')];
  state.drops[4].collectingAt = 500;
  const positions = new Map(state.drops.map(drop => [drop.id, { x: drop.id === 6 ? 5 : 0, y: 0, z: 0 }]));
  assert.deepEqual(mergeNearbyDrops(state, positions, MERGE_DELAY_MS - 1), []);
  const events = mergeNearbyDrops(state, positions, 500);
  assert.deepEqual(events, [{ sourceId: 3, targetId: 1, count: 1, totalCount: MAX_STACK_SIZE }]);
  assert.deepEqual(state.drops.map(drop => drop.id), [1, 2, 4, 5, 6]);
  assert.equal(state.drops.reduce((total, drop) => total + drop.count, 0), 69);
});

test('a whole-patch harvest merges then collects every harvested unit exactly once', () => {
  const state = createFarmState();
  state.plots.forEach(plot => { plot.stage = 7; });
  const harvest = interactWithPatch(state, '2:0', 100, () => .5);
  assert.equal(harvest.actions.length, 4);
  assert.equal(harvest.drops.length, 8);
  const positions = new Map(state.drops.map(drop => [drop.id, { x: .01 * drop.id, y: 0, z: 0 }]));
  const events = mergeNearbyDrops(state, positions, 600);
  assert.equal(events.length, 6);
  assert.equal(new Set(events.map(event => event.targetId)).size, 2);
  assert.equal(state.drops.length, 2);
  assert.ok(state.drops.every(drop => drop.count === 4));
  const start = 100 + COLLECTION_IDLE_MS;
  const batch = beginCollection(state, start);
  assert.deepEqual(mergeNearbyDrops(state, positions, start), []);
  assert.equal(finishCollection(state, batch.dropIds, start + PICKUP_DURATION_MS - 1).type, 'noop');
  assert.equal(finishCollection(state, batch.dropIds, start + PICKUP_DURATION_MS).type, 'collect');
  assert.equal(state.collectedCount, 4);
  assert.equal(state.collectedSeeds, 4);
  assert.equal(finishCollection(state, harvest.drops.map(drop => drop.id), start + PICKUP_DURATION_MS).type, 'noop');
});
