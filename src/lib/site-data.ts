import { publicDir } from 'astro:config/server';
import profileData from '../data/site.json';
import photoData from '../data/photos.json';
import friendData from '../data/friends.json';
import workData from '../data/works.json';
import { parseFriends, parsePhotos, parseProfile, parseWorks } from './collections';
import { withImageDimensions } from './image-dimensions';

// Everything the CMS manages outside of notes, validated once for the whole build.
const root = new URL(publicDir);
export const profile = parseProfile(profileData);
export const friends = parseFriends(friendData);
export const photos = await withImageDimensions(parsePhotos(photoData), root, 'photo', photo => photo.src);
export const works = await withImageDimensions(parseWorks(workData), root, 'work', work => work.image);
