import sharp, { type Region } from 'sharp';

// Keep every visible alpha value, including faint shadows. For an opaque product shot,
// only treat pure white as padding when all four corners agree on the background.
export async function thingCrop(input: Buffer): Promise<Region | undefined> {
  const image = sharp(input);
  const { format, pages, hasAlpha } = await image.metadata();
  if (!['jpeg', 'png', 'webp', 'avif', 'heif'].includes(format) || (pages ?? 1) > 1) return;
  const { data, info: { width, height } } = await image.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const white = (i: number) => data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
  const whiteBorder = [0, width - 1, width * (height - 1), width * height - 1].every(pixel => white(pixel * 4));
  if (!hasAlpha && !whiteBorder) return;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0 || (whiteBorder && white(i))) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = y;
    }
  }
  if (right < left || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
