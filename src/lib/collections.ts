export interface Profile {
  name: string;
  bio: string;
  avatar?: string;
  favicon?: string;
  contactUrl?: string;
}

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
  host: string;
  description?: string;
  avatar?: string;
}

export interface Work {
  id?: string;
  title: string;
  url: string;
  description?: string;
  image?: string;
  width: number;
  height: number;
}

// Note filenames, photo IDs and work IDs all become URLs.
export const SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

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
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return undefined;
  return text(value, label);
}

function slug(value: unknown, label: string): string {
  const id = text(value, label);
  if (!SLUG_PATTERN.test(id)) throw new Error(`${label} must contain only letters, numbers, hyphens or underscores.`);
  return id;
}

function httpsUrl(value: unknown, label: string): string {
  const source = text(value, label);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error(`${label} must be a full HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must be a full HTTPS URL without credentials.`);
  return source;
}

function optionalHttpsUrl(value: unknown, label: string): string | undefined {
  return optionalText(value, label) && httpsUrl(value, label);
}

function imageSource(value: unknown, label: string): string {
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

function optionalImage(value: unknown, label: string): string | undefined {
  return optionalText(value, label) && imageSource(value, label);
}

// CMS image fields come in pairs: an upload, and an HTTPS link that takes priority over it.
function preferredImage(entry: Record<string, unknown>, linkKey: string, uploadKey: string, label: string): string | undefined {
  return optionalHttpsUrl(entry[linkKey], `${label}.${linkKey}`) ?? optionalImage(entry[uploadKey], `${label}.${uploadKey}`);
}

function dimension(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive image dimension.`);
  return value;
}

export function parseProfile(value: unknown): Profile {
  const profile = record(value, 'Profile');
  return {
    name: text(profile.name, 'Profile.name'),
    bio: text(profile.bio, 'Profile.bio'),
    avatar: preferredImage(profile, 'avatarUrl', 'avatar', 'Profile'),
    favicon: optionalImage(profile.favicon, 'Profile.favicon'),
    contactUrl: optionalHttpsUrl(profile.contactUrl, 'Profile.contactUrl'),
  };
}

export function parsePhotos(value: unknown): Photo[] {
  const ids = new Set<string>();
  return entries(value, 'Photos').map(({ item, index }) => {
    const label = `Photo ${index + 1}`;
    const photo = record(item, label);
    const id = slug(photo.id, `${label}.id`);
    if (ids.has(id)) throw new Error(`Duplicate photo id: ${id}`);
    ids.add(id);
    const date = text(photo.date, `${label}.date`);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`${label}.date must be a valid date in YYYY-MM-DD format.`);
    }
    return {
      id, date,
      title: text(photo.title, `${label}.title`),
      description: optionalText(photo.description, `${label}.description`),
      src: preferredImage(photo, 'externalSrc', 'src', label) ?? imageSource(photo.src, `${label}.src`),
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
    const url = httpsUrl(friend.url, `${label}.url`);
    return {
      name: text(friend.name, `${label}.name`),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
      description: optionalText(friend.description, `${label}.description`),
      avatar: preferredImage(friend, 'avatarUrl', 'avatar', label),
    };
  });
}

export function parseWorks(value: unknown): Work[] {
  const ids = new Set<string>();
  return entries(value, 'Works').map(({ item, index }) => {
    const label = `Work ${index + 1}`;
    const work = record(item, label);
    const id = optionalText(work.id, `${label}.id`) && slug(work.id, `${label}.id`);
    if (id) {
      if (ids.has(id)) throw new Error(`Duplicate work id: ${id}`);
      ids.add(id);
    }
    const url = text(work.url, `${label}.url`);
    if (url.startsWith('/')) {
      let decoded: string;
      try { decoded = decodeURIComponent(url); } catch { throw new Error(`${label}.url has an invalid path.`); }
      if (decoded.startsWith('//') || /[\\\u0000- ]/.test(decoded)) {
        throw new Error(`${label}.url must be a site path or a full HTTPS URL.`);
      }
    } else {
      httpsUrl(url, `${label}.url`);
    }
    // The CMS uploads to `icon`. Older entries may still carry a cover in `image` or `imageUrl`, which replaces it.
    const cover = preferredImage(work, 'imageUrl', 'image', label);
    const icon = optionalImage(work.icon, `${label}.icon`);
    return {
      id,
      title: text(work.title, `${label}.title`),
      url,
      description: optionalText(work.description, `${label}.description`),
      image: cover ?? icon,
      width: dimension(work.width, `${label}.width`, 1),
      height: dimension(work.height, `${label}.height`, 1),
    };
  });
}

export const photoUrl = (id: string): string => `/photos/${encodeURIComponent(id)}/`;
