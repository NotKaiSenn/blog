import photoData from '../data/photos.json';
import friendData from '../data/friends.json';

export interface Photo {
  id: string;
  title: string;
  date: string;
  description?: string;
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface Friend {
  name: string;
  url: string;
  description?: string;
  avatar?: string;
}

export interface Work {
  id?: string;
  title: string;
  url: string;
  description?: string;
  icon?: string;
  image?: string;
  width: number;
  height: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function entries(value: unknown, label: string): Array<{ item: unknown; index: number }> {
  const items = record(value, label).items;
  if (!Array.isArray(items)) throw new Error(`${label}.items must be a list.`);
  // CMS repeaters can save untouched rows as empty objects. Keep original row numbers for errors.
  return items.flatMap((item, index) => {
    const blank = item !== null && typeof item === 'object' && !Array.isArray(item)
      && Object.values(item).every(field => field == null || (typeof field === 'string' && !field.trim()));
    return blank ? [] : [{ item, index }];
  });
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty.`);
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, label);
}

function httpsUrl(value: unknown, label: string): string {
  const source = text(value, label);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error(`${label} must be a full HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must be a full HTTPS URL without credentials.`);
  return source;
}

export function imageSource(value: unknown, label = 'Image'): string {
  const source = text(value, label);
  if (source.startsWith('/uploads/')) {
    let path: string;
    try { path = decodeURIComponent(source); } catch { throw new Error(`${label} has an invalid image path.`); }
    if (path.includes('\\') || path.split('/').some(segment => segment === '.' || segment === '..')
      || /[?#\u0000-\u001f]/.test(path) || path.endsWith('/')) {
      throw new Error(`${label} must point to a file within /uploads/.`);
    }
    return source;
  }
  return httpsUrl(source, label);
}

function dimension(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive image dimension.`);
  return value;
}

export function parsePhotos(value: unknown): Photo[] {
  const ids = new Set<string>();
  return entries(value, 'Photos').map(({ item, index }) => {
    const label = `Photo ${index + 1}`;
    const photo = record(item, label);
    const id = text(photo.id, `${label}.id`);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(id)) throw new Error(`${label}.id must contain only letters, numbers, hyphens or underscores.`);
    if (ids.has(id)) throw new Error(`Duplicate photo id: ${id}`);
    ids.add(id);
    const date = text(photo.date, `${label}.date`);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`${label}.date must be a valid date in YYYY-MM-DD format.`);
    }
    const externalSrc = optionalText(photo.externalSrc, `${label}.externalSrc`);
    return {
      id, date,
      title: text(photo.title, `${label}.title`),
      description: optionalText(photo.description, `${label}.description`),
      src: externalSrc ? httpsUrl(externalSrc, `${label}.externalSrc`) : imageSource(photo.src, `${label}.src`),
      alt: text(photo.alt, `${label}.alt`),
      width: dimension(photo.width, `${label}.width`, 4),
      height: dimension(photo.height, `${label}.height`, 3),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function parseFriends(value: unknown): Friend[] {
  return entries(value, 'Friends').map(({ item, index }) => {
    const label = `Friend ${index + 1}`;
    const friend = record(item, label);
    const avatar = optionalText(friend.avatar, `${label}.avatar`);
    const avatarUrl = optionalText(friend.avatarUrl, `${label}.avatarUrl`);
    return {
      name: text(friend.name, `${label}.name`),
      url: httpsUrl(friend.url, `${label}.url`),
      description: optionalText(friend.description, `${label}.description`),
      avatar: avatarUrl ? httpsUrl(avatarUrl, `${label}.avatarUrl`) : avatar ? imageSource(avatar, `${label}.avatar`) : undefined,
    };
  });
}

export function parseWorks(value: unknown): Work[] {
  const ids = new Set<string>();
  return entries(value, 'Works').map(({ item, index }) => {
    const label = `Work ${index + 1}`;
    const work = record(item, label);
    const id = optionalText(work.id, `${label}.id`);
    if (id) {
      if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(id)) throw new Error(`${label}.id must contain only letters, numbers, hyphens or underscores.`);
      if (ids.has(id)) throw new Error(`Duplicate work id: ${id}`);
      ids.add(id);
    }
    const url = text(work.url, `${label}.url`);
    if (url.startsWith('/')) {
      let decoded: string;
      try { decoded = decodeURIComponent(url); } catch { throw new Error(`${label}.url has an invalid path.`); }
      if (decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) {
        throw new Error(`${label}.url must be a site path or a full HTTPS URL.`);
      }
    } else {
      httpsUrl(url, `${label}.url`);
    }
    const icon = optionalText(work.icon, `${label}.icon`);
    const image = optionalText(work.image, `${label}.image`);
    const imageUrl = optionalText(work.imageUrl, `${label}.imageUrl`);
    return {
      id,
      title: text(work.title, `${label}.title`),
      url,
      description: optionalText(work.description, `${label}.description`),
      icon: icon ? imageSource(icon, `${label}.icon`) : undefined,
      image: imageUrl ? httpsUrl(imageUrl, `${label}.imageUrl`) : image ? imageSource(image, `${label}.image`) : undefined,
      width: dimension(work.width, `${label}.width`, 1),
      height: dimension(work.height, `${label}.height`, 1),
    };
  });
}

export const photos = parsePhotos(photoData);
export const friends = parseFriends(friendData);
export const photoUrl = (photo: Pick<Photo, 'id'>): string => `/photos/${encodeURIComponent(photo.id)}/`;
