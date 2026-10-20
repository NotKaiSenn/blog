import { seasonAssets } from './seasons.mjs';

// Shared by every widget on the page, so a season change reuses the images and models already loaded.
const images = new Map();
const models = new Map();

export const resolveAssetBase = value => new URL(value || './assets/', import.meta.url).href;
export const textureURL = (assetBase, path) => new URL(`${path}.png`, assetBase).href;
export const modelURL = (assetBase, name) => new URL(`models/block/${name}.json`, assetBase).href;

function cached(cache, url, load) {
  if (!cache.has(url)) {
    const request = load(url);
    cache.set(url, request);
    // The next caller retries a failed request.
    request.catch(() => { if (cache.get(url) === request) cache.delete(url); });
  }
  return cache.get(url);
}

export function loadImage(url) {
  return cached(images, url, () => new Promise((resolve, reject) => {
    const image = new Image();
    // Same request mode as three.js loaders, so WebGL may read the pixels.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Texture unavailable: ${url}`));
    image.src = url;
  }));
}

export function loadModel(url) {
  return cached(models, url, async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Block model unavailable: ${url}`);
    return response.json();
  });
}

// Starts loading a season's files; the scene reports any failure when it loads them itself.
export function prefetchSeason(seasonId, assetBase) {
  const { textures, models: names } = seasonAssets(seasonId);
  for (const path of textures) loadImage(textureURL(assetBase, path)).catch(() => {});
  for (const name of names) loadModel(modelURL(assetBase, name)).catch(() => {});
}
