const clamp = value => Math.min(1, Math.max(0, value));

export function grassColormapCoordinates(temperature, downfall) {
  const warmth = clamp(temperature);
  const humidity = clamp(downfall) * warmth;
  return { x: Math.floor((1 - warmth) * 255), y: Math.floor((1 - humidity) * 255) };
}

function canvasFor(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  return canvas;
}

export function sampleGrassTint(image, { temperature = .8, downfall = .4 } = {}) {
  const canvas = canvasFor(image);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { x, y } = grassColormapCoordinates(temperature, downfall);
  const color = context.getImageData(x, y, 1, 1).data;
  return `#${Array.from(color.subarray(0, 3), channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function tintGrassTexture(image, color) {
  const canvas = canvasFor(image);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(image, 0, 0);
  return canvas;
}

export function createGrassCanvases(textures, climate) {
  const tint = sampleGrassTint(textures['colormap/grass'].image, climate);
  const top = tintGrassTexture(textures['block/grass_block_top'].image, tint);
  const side = canvasFor(textures['block/grass_block_side'].image);
  const context = side.getContext('2d');
  // Vanilla applies tintindex only to the top and transparent grass-side overlay.
  context.drawImage(textures['block/grass_block_side'].image, 0, 0);
  context.drawImage(tintGrassTexture(textures['block/grass_block_side_overlay'].image, tint), 0, 0);
  return { tint, top, side };
}
