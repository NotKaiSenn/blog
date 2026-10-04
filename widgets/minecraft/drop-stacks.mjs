export const MAX_STACK_SIZE = 64;
export const MERGE_RADIUS = 1.15;
export const MERGE_DELAY_MS = 400;
export const MERGE_ANIMATION_MS = 120;

export function mergeNearbyDrops(state, positions, now) {
  const eligible = state.drops.filter(drop =>
    drop.collectingAt === null &&
    now - drop.createdAt >= MERGE_DELAY_MS &&
    (drop.mergedAt === undefined || now - drop.mergedAt >= MERGE_ANIMATION_MS) &&
    positions.has(drop.id));
  // Keep larger/older piles as recipients so a batch has stable destinations.
  eligible.sort((a, b) => b.count - a.count || a.createdAt - b.createdAt || a.id - b.id);
  const removed = new Set();
  const events = [];
  for (let i = 0; i < eligible.length; i++) {
    const target = eligible[i];
    if (removed.has(target.id)) continue;
    const a = positions.get(target.id);
    for (let j = i + 1; j < eligible.length; j++) {
      const source = eligible[j];
      if (removed.has(source.id) || source.kind !== target.kind || target.count + source.count > MAX_STACK_SIZE) continue;
      const b = positions.get(source.id);
      const distanceSquared = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (!(distanceSquared <= MERGE_RADIUS ** 2)) continue;
      target.count += source.count;
      target.mergedAt = now;
      removed.add(source.id);
      events.push({ sourceId: source.id, targetId: target.id, count: source.count, totalCount: target.count });
    }
  }
  if (removed.size) state.drops = state.drops.filter(drop => !removed.has(drop.id));
  return events;
}
