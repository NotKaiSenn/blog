import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageMetadata } from 'astro/assets/utils';
import type { Region } from 'sharp';
import { thingCrop } from './thing-crop.ts';

interface Dimensions { width: number; height: number; crop?: Region; }

export function localImageDimensions(publicDir: URL) {
  const uploadsDir = resolve(fileURLToPath(publicDir), 'uploads');
  const dimensions = new Map<string, Promise<Dimensions>>();

  return async (src: string, kind: 'photo' | 'work' | 'thing' | 'note image'): Promise<Dimensions | undefined> => {
    if (!src.startsWith('/uploads/')) return undefined;
    const imagePath = resolve(uploadsDir, decodeURIComponent(src.slice('/uploads/'.length)));
    const relativePath = relative(uploadsDir, imagePath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Local ${kind} must point to a file within /uploads/.`);
    }
    const key = kind === 'thing' ? `thing:${imagePath}` : imagePath;
    let metadata = dimensions.get(key);
    if (!metadata) {
      metadata = readFile(imagePath).then(async data => {
        if (kind === 'thing') {
          const crop = await thingCrop(data);
          if (crop) return { width: crop.width, height: crop.height, crop };
        }
        const { width, height } = await imageMetadata(data, src);
        return { width, height };
      });
      dimensions.set(key, metadata);
    }
    try {
      return await metadata;
    } catch (cause) {
      throw new Error(`Unable to read local ${kind} ${src}.`, { cause });
    }
  };
}

/** Gives each item the real size of its uploaded image. Remote images keep the size entered in the CMS. */
export async function withImageDimensions<T extends Dimensions>(items: readonly T[], publicDir: URL, kind: 'photo' | 'work' | 'thing', source: (item: T) => string | undefined): Promise<(T & Dimensions)[]> {
  const readDimensions = localImageDimensions(publicDir);
  const measure = async (item: T) => {
    const src = source(item);
    const dimensions = src && await readDimensions(src, kind);
    return dimensions ? { ...item, ...dimensions } : item;
  };
  if (kind === 'thing') {
    // Only hold one decoded product image in memory while looking for its borders.
    const measured = [];
    for (const item of items) measured.push(await measure(item));
    return measured;
  }
  return Promise.all(items.map(measure));
}
