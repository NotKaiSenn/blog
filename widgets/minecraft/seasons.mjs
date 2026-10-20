// Scene configuration without three.js, so pages can fetch a season's assets before the renderer loads.

export const SEASON_PARTICLE_TEXTURES = {
  spring: Array.from({ length: 12 }, (_, index) => `particle/cherry_${index}`),
  summer: ['environment/rain'],
  autumn: Array.from({ length: 12 }, (_, index) => `particle/leaf_${index}`),
  winter: ['environment/snow'],
};

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
    label: 'Autumn', grassClimate: { temperature: .8, downfall: .4 },
    actionId: 'autumn:pumpkin', actionLabel: 'Toggle pumpkin light',
    actions: [{ id: 'autumn:mushroom', label: 'Pick mushroom' }],
    cameraTarget: [1.9, .3, 1.4], halfHeight: 2.7,
    plots: [],
    textures: [...SEASON_PARTICLE_TEXTURES.autumn, 'colormap/dry_foliage', 'block/leaf_litter', 'block/coarse_dirt', 'block/oak_log', 'block/oak_log_top', 'block/pumpkin_side', 'block/pumpkin_top', 'block/carved_pumpkin', 'block/jack_o_lantern', 'block/fern', 'block/mossy_cobblestone', 'block/brown_mushroom', 'block/red_mushroom'],
  },
  winter: {
    label: 'Winter', waterTint: '#286be9',
    actionId: 'winter:campfire', actionLabel: 'Toggle campfire',
    actions: [{ id: 'winter:ice', label: 'Break ice' }],
    cameraTarget: [2.15, .38, 1.15], halfHeight: 3.05,
    plots: [],
    textures: [...commonTextures, ...SEASON_PARTICLE_TEXTURES.winter, 'block/spruce_log', 'block/spruce_log_top', 'block/spruce_leaves', 'block/spruce_sapling', 'block/snow', 'block/grass_block_snow', 'block/ice', 'block/coarse_dirt', 'block/campfire_log', 'block/campfire_log_lit', 'block/campfire_fire'],
  },
};

export const seasonIdFor = value => Object.hasOwn(SEASONS, value) ? value : 'spring';

// Textures and block models one season's scene loads.
export function seasonAssets(seasonId) {
  seasonId = seasonIdFor(seasonId);
  const hasCrops = SEASONS[seasonId].plots.length > 0;
  const textures = [...new Set([
    'block/dirt', ...SEASONS[seasonId].textures,
    ...(seasonId === 'winter' ? [] : ['block/grass_block_top', 'block/grass_block_side', 'block/grass_block_side_overlay', 'colormap/grass']),
    ...(seasonId === 'autumn' ? [] : ['block/water_still']),
    ...(hasCrops ? ['block/farmland_moist', 'item/wheat', 'item/wheat_seeds', ...Array.from({ length: 8 }, (_, i) => `block/wheat_stage${i}`)] : []),
  ])];
  const models = [
    ...(hasCrops ? ['crop'] : []),
    ...(seasonId === 'winter' ? ['campfire', 'campfire_off', 'template_campfire'] : []),
    ...(seasonId === 'autumn' ? ['template_leaf_litter_1', 'template_leaf_litter_2', 'template_leaf_litter_3', 'template_leaf_litter_4'] : []),
  ];
  return { textures, models };
}
