import type { Element, Root, RootContent } from 'hast';
import { localImageDimensions } from './image-dimensions.ts';
import { responsiveImage } from './upload-variants.ts';

// Note images span the reading column at most (see .site-shell).
export const PROSE_IMAGE_SIZES = '(max-width: 687px) 100vw, 640px';

function images(node: Root | RootContent): Element[] {
  const own = node.type === 'element' && node.tagName === 'img' ? [node] : [];
  return 'children' in node ? own.concat(node.children.flatMap(images)) : own;
}

/** Gives uploaded note images their real size, so text no longer jumps as they load, and smaller variants. */
export function rehypeUploadImages({ publicDir }: { publicDir: URL }) {
  const readDimensions = localImageDimensions(publicDir);
  return async (tree: Root) => {
    await Promise.all(images(tree).map(async (image, index) => {
      const { src, width, height } = image.properties;
      if (typeof src !== 'string') return;
      let dimensions;
      try {
        dimensions = await readDimensions(src, 'note image');
      } catch {
        // Leave the reference untouched; the built-site reference check reports missing files.
        return;
      }
      if (!dimensions) return;
      if (width === undefined && height === undefined) Object.assign(image.properties, dimensions);
      const { srcset, sizes } = responsiveImage(src, dimensions.width, PROSE_IMAGE_SIZES);
      if (srcset) Object.assign(image.properties, { srcSet: srcset, sizes });
      // The first image may be the largest thing on screen, so only later ones wait for scrolling.
      if (index > 0) image.properties.loading ??= 'lazy';
      image.properties.decoding ??= 'async';
    }));
  };
}
