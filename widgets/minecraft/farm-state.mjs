export const MATURE_STAGE = 7;
export const COLLECTION_IDLE_MS = 3000;
export const PICKUP_DURATION_MS = 150;
export const PATCH_RADIUS = 1.05;

const INITIAL_STAGES = [0, 4, 7, 6, 7, 3];

export function createFarmState(now = 0, layout) {
  const plots = layout ? layout.map(plot => ({ ...plot, id: `${plot.x}:${plot.z}` })) : [0, 1].flatMap((z, row) =>
    Array.from({ length: 3 }, (_, column) => {
      const x = column + 1;
      return { id: `${x}:${z}`, x, z, stage: INITIAL_STAGES[row * 3 + column] };
    }),
  );

  return {
    plots,
    initialPlots: plots.map(plot => ({ ...plot })),
    drops: [],
    collectedCount: 0,
    collectedSeeds: 0,
    collectedItems: {},
    totalHarvested: 0,
    nextDropId: 1,
    lastInteractionAt: now,
    lastGrowthAt: now,
    collectingAt: null,
  };
}

export function recordInteraction(state, now = 0) {
  state.lastInteractionAt = Math.max(state.lastInteractionAt, now);
}

export function growNaturally(state, now, intervalMs, random = Math.random) {
  if (!(intervalMs > 0) || now - state.lastGrowthAt < intervalMs) return { type: 'noop' };
  state.lastGrowthAt = now;
  const actions = state.plots.filter(plot => plot.stage < MATURE_STAGE).map(plot => {
    const previousStage = plot.stage;
    plot.stage = Math.min(MATURE_STAGE, plot.stage + 1 + Math.floor(random() * 2));
    return { type: 'grow', plot, previousStage };
  });
  return actions.length ? { type: 'grow', actions } : { type: 'noop' };
}

export function addSceneDrops(state, specs, now = 0) {
  const drops = specs.map(spec => ({
    id: state.nextDropId++,
    kind: spec.kind,
    count: spec.count ?? 1,
    plotId: null,
    x: spec.x,
    z: spec.z,
    ...(spec.y === undefined ? {} : { y: spec.y }),
    createdAt: now,
    collectingAt: null,
  }));
  state.drops.push(...drops);
  return drops;
}

function findPlot(state, plotIdOrIndex) {
  return typeof plotIdOrIndex === 'string'
    ? state.plots.find((candidate) => candidate.id === plotIdOrIndex)
    : Number.isInteger(plotIdOrIndex) && plotIdOrIndex >= 0
      ? state.plots[plotIdOrIndex]
      : undefined;
}

function advancePlot(state, plot, now, growth) {
  if (plot.stage < MATURE_STAGE) {
    const previousStage = plot.stage;
    plot.stage = Math.min(MATURE_STAGE, plot.stage + growth);
    return { type: 'grow', plot, previousStage };
  }

  plot.stage = 0;
  const drops = ['wheat', 'seeds'].map((kind) => ({
    id: state.nextDropId++,
    kind,
    count: 1,
    plotId: plot.id,
    x: plot.x,
    z: plot.z,
    createdAt: now,
    collectingAt: null,
  }));
  state.drops.push(...drops);
  state.totalHarvested += 1;
  return { type: 'harvest', plot, drops, drop: drops[0] };
}

export function interactWithPlot(state, plotIdOrIndex, now = 0) {
  const plot = findPlot(state, plotIdOrIndex);
  if (!plot) return { type: 'noop' };
  recordInteraction(state, now);
  return advancePlot(state, plot, now, 1);
}

export function getPatchPlots(state, plotIdOrIndex, center) {
  const plot = findPlot(state, plotIdOrIndex);
  if (!plot) return [];
  const origin = center ?? { x: plot.x + 0.5, z: plot.z + 0.5 };
  return [plot, ...state.plots.filter((candidate) => {
    if (candidate === plot) return false;
    const distanceSquared = (candidate.x + 0.5 - origin.x) ** 2
      + (candidate.z + 0.5 - origin.z) ** 2;
    return distanceSquared <= PATCH_RADIUS ** 2;
  })];
}

export function interactWithPatch(state, plotIdOrIndex, now = 0, random = Math.random, center) {
  const targets = getPatchPlots(state, plotIdOrIndex, center);
  if (!targets.length) return { type: 'noop' };
  const plot = targets[0];

  recordInteraction(state, now);
  const actions = targets.map((target) => {
    const growth = target.stage < MATURE_STAGE ? 2 + Math.floor(random() * 3) : 0;
    return advancePlot(state, target, now, growth);
  });
  return {
    type: 'patch',
    plot,
    actions,
    affectedPlotIds: actions.map((action) => action.plot.id),
    drops: actions.flatMap((action) => action.drops ?? []),
  };
}

export function beginCollection(state, now) {
  if (!(now - state.lastInteractionAt >= COLLECTION_IDLE_MS)) return { type: 'noop' };

  const drops = state.drops.filter((drop) => drop.collectingAt === null);
  if (!drops.length) return { type: 'noop' };

  for (const drop of drops) drop.collectingAt = now;
  state.collectingAt ??= now;
  return { type: 'collect-start', drops, dropIds: drops.map((drop) => drop.id), startedAt: now };
}

export function collectDrop(state, dropId, now) {
  const index = state.drops.findIndex((drop) => drop.id === dropId);
  if (index === -1) return { type: 'noop' };
  const pending = state.drops[index];
  if (pending.collectingAt === null || !(now - pending.collectingAt >= PICKUP_DURATION_MS)) {
    return { type: 'noop' };
  }

  const [drop] = state.drops.splice(index, 1);
  const count = drop.count ?? 1;
  state.collectedItems[drop.kind] = (state.collectedItems[drop.kind] ?? 0) + count;
  if (drop.kind === 'wheat') state.collectedCount += count;
  else if (drop.kind === 'seeds') state.collectedSeeds += count;
  state.collectingAt = state.drops.reduce((earliest, candidate) => {
    if (candidate.collectingAt === null) return earliest;
    return earliest === null ? candidate.collectingAt : Math.min(earliest, candidate.collectingAt);
  }, null);
  return {
    type: 'collect',
    drop,
    collectedCount: state.collectedCount,
    collectedSeeds: state.collectedSeeds,
  };
}

export function finishCollection(state, dropIds, now) {
  const drops = [];
  for (const id of dropIds) {
    const result = collectDrop(state, id, now);
    if (result.type === 'collect') drops.push(result.drop);
  }
  return drops.length ? { type: 'collect', drops } : { type: 'noop' };
}

export function resetFarmState(state, now = 0) {
  // Keep IDs monotonic so an old animation cannot collect a new harvest after reset.
  const nextDropId = state.nextDropId;
  Object.assign(state, createFarmState(now, state.initialPlots), { nextDropId });
  return state;
}
