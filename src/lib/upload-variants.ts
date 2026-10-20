// Smaller WebP copies of CMS uploads, generated during the build. Each URL names its
// source and width, so the build renders exactly the copies that pages reference.
export const VARIANT_WIDTHS = [480, 720, 960, 1440, 1920] as const;
const MAX_VARIANT_WIDTH = VARIANT_WIDTHS.at(-1)!;
export const VARIANT_PREFIX = '/_uploads/';
const UPLOADS_PREFIX = '/uploads/';

// srcset separates candidates with commas and spaces, so every path segment is fully encoded.
function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
}

export function variantPath(src: string, width: number): string {
  return `${VARIANT_PREFIX}${width}/${encodePath(src.slice(UPLOADS_PREFIX.length))}.webp`;
}

// Remote images and images smaller than every variant keep a plain src.
function uploadSrcset(src: string | undefined, width: number | undefined): string | undefined {
  if (!src?.startsWith(UPLOADS_PREFIX) || !width) return undefined;
  const widths = VARIANT_WIDTHS.filter(candidate => candidate < width);
  if (!widths.length) return undefined;
  try {
    // The largest candidate keeps the original's full width, so no screen receives less detail than before.
    // Within the variant range, a full-size WebP replaces PNG and JPEG originals, which are often much larger.
    const full = width <= MAX_VARIANT_WIDTH && !/\.webp$/i.test(src) ? variantPath(src, width) : encodePath(src);
    return [...widths.map(candidate => `${variantPath(src, candidate)} ${candidate}w`), `${full} ${width}w`].join(', ');
  } catch {
    return undefined;
  }
}

/** srcset and sizes attributes for an image, or neither when it has no variants. */
export function responsiveImage(src: string | undefined, width: number | undefined, sizes: string): { srcset?: string; sizes?: string } {
  const srcset = uploadSrcset(src, width);
  return srcset ? { srcset, sizes } : {};
}

/** The upload path (relative to /uploads/) and width named by a variant URL, or undefined. */
export function parseVariantPath(pathname: string): { file: string; width: number } | undefined {
  const match = pathname.match(/^\/_uploads\/([1-9]\d*)\/(.+)\.webp$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  if (width > MAX_VARIANT_WIDTH) return undefined;
  let segments: string[];
  try { segments = match[2].split('/').map(decodeURIComponent); } catch { return undefined; }
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\/\u0000-\u001f]/.test(segment))) return undefined;
  return { file: segments.join('/'), width };
}
