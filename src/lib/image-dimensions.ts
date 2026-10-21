import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageMetadata } from 'astro/assets/utils';

interface Dimensions { width: number; height: number; }

export function localImageDimensions(publicDir: URL) {
  const uploadsDir = resolve(fileURLToPath(publicDir), 'uploads');
  const dimensions = new Map<string, Promise<Dimensions>>();

  return async (src: string, kind: 'photo' | 'work' | 'note image'): Promise<Dimensions | undefined> => {
    if (!src.startsWith('/uploads/')) return undefined;
    const imagePath = resolve(uploadsDir, decodeURIComponent(src.slice('/uploads/'.length)));
    const relativePath = relative(uploadsDir, imagePath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Local ${kind} must point to a file within /uploads/.`);
    }
    let metadata = dimensions.get(imagePath);
    if (!metadata) {
      metadata = readFile(imagePath).then(data => imageMetadata(data, src));
      dimensions.set(imagePath, metadata);
    }
    try {
      const { width, height } = await metadata;
      return { width, height };
    } catch (cause) {
      throw new Error(`Unable to read local ${kind} ${src}.`, { cause });
    }
  };
}

/** Gives each item the real size of its uploaded image. Remote images keep the size entered in the CMS. */
export async function withImageDimensions<T extends Dimensions>(items: readonly T[], publicDir: URL, kind: 'photo' | 'work', source: (item: T) => string | undefined): Promise<T[]> {
  const readDimensions = localImageDimensions(publicDir);
  return Promise.all(items.map(async item => {
    const src = source(item);
    const dimensions = src && await readDimensions(src, kind);
    return dimensions ? { ...item, ...dimensions } : item;
  }));
}
