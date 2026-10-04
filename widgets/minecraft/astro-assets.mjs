import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = new URL('./assets/', import.meta.url);
const notices = ['LICENSE', 'NOTICE'];
const contentTypes = {
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.mcmeta': 'application/json',
};

function isInside(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export default function minecraftAssets() {
  return {
    name: 'minecraft-widget-assets',
    hooks: {
      'astro:config:setup'({ config, updateConfig }) {
        const base = `${(config.base || '/').replace(/\/$/, '')}/minecraft-widget/`;
        updateConfig({ vite: { plugins: [{
          name: 'minecraft-widget-assets',
          configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
              if (!['GET', 'HEAD'].includes(request.method)) return next();
              const pathname = request.url?.split('?')[0];
              if (!pathname?.startsWith(base)) return next();
              try {
                const name = decodeURIComponent(pathname.slice(base.length));
                if (!name || name.includes('\\') || name.includes('\0')) return next();
                const notice = notices.includes(name);
                if (!notice && !name.startsWith('assets/')) return next();
                const root = await realpath(fileURLToPath(notice ? new URL('./', import.meta.url) : assets));
                const candidate = resolve(root, notice ? name : name.slice('assets/'.length));
                if (!isInside(root, candidate)) return next();
                const file = await realpath(candidate);
                const contentType = notice ? 'text/plain; charset=utf-8' : contentTypes[extname(file)];
                if (!isInside(root, file) || !contentType || !(await stat(file)).isFile()) return next();
                const content = await readFile(file);
                response.setHeader('Content-Type', contentType);
                response.setHeader('Content-Length', content.length);
                response.end(request.method === 'HEAD' ? undefined : content);
              } catch (error) {
                if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof URIError) return next();
                next(error);
              }
            });
          },
        }] } });
      },
      async 'astro:build:done'({ dir }) {
        const destination = new URL('minecraft-widget/', dir);
        await mkdir(destination, { recursive: true });
        await Promise.all(notices.map(name => copyFile(new URL(name, import.meta.url), new URL(name, destination))));
        const root = await realpath(fileURLToPath(assets));
        const manifest = JSON.parse(await readFile(new URL('sources.json', assets), 'utf8'));
        const assetDirectory = new URL('assets/', destination);
        await Promise.all(manifest.files.map(async ({ path, sha256 }) => {
          const source = resolve(root, path);
          if (!isInside(root, source)) throw new Error(`Invalid Minecraft asset path: ${path}`);
          const file = await realpath(source);
          if (!isInside(root, file)) throw new Error(`Invalid Minecraft asset path: ${path}`);
          const content = await readFile(file);
          if (createHash('sha256').update(content).digest('hex') !== sha256) {
            throw new Error(`Minecraft asset checksum mismatch: ${path}`);
          }
          const target = resolve(fileURLToPath(assetDirectory), path);
          await mkdir(resolve(target, '..'), { recursive: true });
          await writeFile(target, content);
        }));
        await copyFile(new URL('sources.json', assets), new URL('sources.json', assetDirectory));
      },
    },
  };
}
