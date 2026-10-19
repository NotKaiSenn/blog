import { mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import sharp, { type Sharp } from 'sharp';
import { parseVariantPath } from '../lib/upload-variants.ts';

// Follow links before checking, so a variant URL can only read files inside /uploads/.
async function uploadFile(uploadsDir: string, file: string): Promise<string> {
  const root = await realpath(uploadsDir);
  const path = await realpath(resolve(root, file));
  const inside = relative(root, path);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Image variant source must be within /uploads/: ${file}`);
  return path;
}

function variant(image: Sharp, width: number): Sharp {
  return image.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 80 });
}

function source(path: string): Sharp {
  // rotate() applies EXIF orientation, matching the dimensions Astro reports for the original.
  // Phone photos are often Display P3; keeping the profile preserves their colors.
  return sharp(path, { animated: true }).rotate().keepIccProfile();
}

export default function uploadImages(): AstroIntegration {
  let uploadsDir = '';
  return {
    name: 'upload-images',
    hooks: {
      'astro:config:setup'({ config, updateConfig }) {
        uploadsDir = fileURLToPath(new URL('uploads/', config.publicDir));
        updateConfig({ vite: { plugins: [{
          name: 'upload-images',
          configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
              const requested = ['GET', 'HEAD'].includes(request.method ?? '') ? parseVariantPath(request.url?.split('?')[0] ?? '') : undefined;
              if (!requested) return next();
              try {
                const content = await variant(source(await uploadFile(uploadsDir, requested.file)), requested.width).toBuffer();
                response.setHeader('Content-Type', 'image/webp');
                response.setHeader('Content-Length', content.length);
                response.end(request.method === 'HEAD' ? undefined : content);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return next();
                next(error);
              }
            });
          },
        }] } });
      },
      async 'astro:build:done'({ dir, logger }) {
        const outDir = fileURLToPath(dir);
        const requested = new Map<string, Set<number>>();
        for (const name of await readdir(outDir, { recursive: true })) {
          if (!name.endsWith('.html')) continue;
          const html = await readFile(join(outDir, name), 'utf8');
          for (const [, value] of html.matchAll(/\ssrc(?:set)?="([^"]*)"/g)) {
            for (const candidate of value.split(',')) {
              const found = parseVariantPath(candidate.trim().split(/\s+/)[0]);
              if (found) requested.set(found.file, (requested.get(found.file) ?? new Set()).add(found.width));
            }
          }
        }
        let count = 0;
        // One source at a time: full-size photos are large once decoded.
        for (const [file, widths] of requested) {
          const image = source(await uploadFile(uploadsDir, file));
          await Promise.all([...widths].map(async width => {
            const target = join(outDir, '_uploads', String(width), `${file}.webp`);
            await mkdir(dirname(target), { recursive: true });
            await variant(image, width).toFile(target);
            count++;
          }));
        }
        if (count) logger.info(`Generated ${count} image variants from ${requested.size} uploads.`);
      },
    },
  };
}
