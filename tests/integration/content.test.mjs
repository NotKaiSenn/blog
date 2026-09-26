import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { htmlToHast } from 'satteri';
import { writeTinyPng, writeTransparentPng } from '../helpers/image-fixture.mjs';
import { galleryBrowser } from '../helpers/gallery-browser.mjs';

const root = resolve(import.meta.dirname, '../..');

function elements(node, match) {
  return [...(node.type === 'element' && match(node) ? [node] : []), ...(node.children ?? []).flatMap(child => elements(child, match))];
}

function assertNoContentScripts(html) {
  const withoutRouter = html.replace(/<script\b[^>]*src="\/_astro\/ClientRouter\.[^"]+\.js"[^>]*><\/script>/g, '');
  assert.doesNotMatch(withoutRouter, /<script\b/);
}

test('CMS-shaped Markdown builds stable, paginated, draft-safe static pages', async (t) => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'kaisenn-blog-test-')));
  t.after(() => {
    if (process.env.KEEP_BLOG_FIXTURE === '1') console.log(`Browser fixture: ${fixture}`);
    else rmSync(fixture, { recursive: true, force: true });
  });
  for (const file of ['src', 'public', 'astro.config.mjs', 'tsconfig.json', 'package.json']) {
    cpSync(join(root, file), join(fixture, file), { recursive: true });
  }
  cpSync(join(fixture, 'astro.config.mjs'), join(fixture, 'astro.project.config.mjs'));
  // Keep linked Astro component URLs inside the fixture's Vite compilation root.
  writeFileSync(join(fixture, 'astro.config.mjs'), `import projectConfig from './astro.project.config.mjs';\nexport default { ...projectConfig, cacheDir: './.astro-test-cache/', vite: { ...projectConfig.vite, resolve: { ...projectConfig.vite?.resolve, preserveSymlinks: true } } };\n`);
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  const content = join(fixture, 'src/content/posts');
  rmSync(content, { recursive: true, force: true });
  mkdirSync(content, { recursive: true });
  mkdirSync(join(fixture, 'public/uploads'), { recursive: true });
  writeTinyPng(join(fixture, 'public/uploads/photo.png'));
  writeTinyPng(join(fixture, 'public/uploads/avatar.png'));
  writeTinyPng(join(fixture, 'public/uploads/work.png'));
  writeTransparentPng(join(fixture, 'public/uploads/work-icon.png'));
  writeTransparentPng(join(fixture, 'public/uploads/work-portrait.png'), 3, 12);
  const photosPath = join(fixture, 'src/data/photos.json');
  const fixturePhotos = [
    { id: 'photo-window', title: '测试照片：窗边', date: '2026-09-20', description: '本地照片的测试说明。', src: '/uploads/photo.png', alt: '测试上传的图片' },
    { id: 'photo-external', title: '测试照片：外链', date: '2026-09-19', src: '/uploads/photo.png', externalSrc: 'https://images.example.com/fixture-photo.webp', alt: '外链优先的测试图片', width: 1600, height: 1200 },
    ...[6, 2, 5, 1, 4, 3].map(index => ({ id: `photo-old-${index}`, title: `更早的照片 ${index}`, date: `2026-09-${10 + index}`, src: '/uploads/photo.png', alt: `容量测试照片 ${index}` })),
  ];
  writeFileSync(photosPath, JSON.stringify({ items: fixturePhotos }));
  const friendsPath = join(fixture, 'src/data/friends.json');
  const fixtureFriends = [
    { name: '测试邻居', url: 'https://friend.example.com/hello/', description: '测试用的友链简介。', avatar: '/uploads/avatar.png' },
    { name: '外链头像测试友链', url: 'https://another.example.com/', avatar: '/uploads/avatar.png', avatarUrl: 'https://avatars.example.com/friend.webp' },
    ...Array.from({ length: 6 }, (_, index) => ({ name: `其他友链 ${index + 3}`, url: `https://friend-${index + 3}.example.com/` })),
  ];
  writeFileSync(friendsPath, JSON.stringify({ items: fixtureFriends }));
  const worksPath = join(fixture, 'src/data/works.json');
  const fixtureWorks = Array.from({ length: 8 }, (_, index) => ({
    title: `作品 ${index + 1}`, url: `https://example.com/work-${index + 1}/`, description: `作品说明 ${index + 1}`,
    ...(index > 0 ? { id: `work-${index + 1}` } : { icon: '/uploads/work-icon.png' }),
    ...(index !== 0 && index !== 2 ? { image: '/uploads/work.png', icon: '/uploads/work-icon.png' } : {}),
    ...(index === 1 ? { imageUrl: 'https://images.example.com/work.webp' } : {}),
    ...(index === 5 ? { image: '/uploads/work-portrait.png' } : {}),
  }));
  writeFileSync(worksPath, JSON.stringify({ items: fixtureWorks }));
  const profilePath = join(fixture, 'src/data/site.json');
  const fixtureProfile = {
    ...JSON.parse(readFileSync(profilePath, 'utf8')),
    name: '后台测试名字', bio: '后台保存的个人简介。', avatar: '/uploads/avatar.png', avatarUrl: '', favicon: '/uploads/avatar.png', contactUrl: 'https://contact.example.com/',
  };
  writeFileSync(profilePath, JSON.stringify(fixtureProfile));
  const cms = parse(readFileSync(join(root, '.pages.yml'), 'utf8'));
  const fields = cms.content.find((entry) => entry.name === 'posts').fields;
  const draftDefault = fields.find((field) => field.name === 'draft').default;
  const articleBody = `第一段中文正文，用来检查自然阅读与摘要。\n\n## 一个小标题\n\n[回到首页](/) 与 **重要的文字**。\n\n> 一段引用。\n\n- 第一项\n- 第二项\n\n![笔记图片](/uploads/photo.png)\n\n\`\`\`js\nconst longLine = '${'long-value-'.repeat(28)}';\n\`\`\`\n\n| 名称 | 说明 |\n| --- | --- |\n| 一项 | 具体内容 |\n`;
  function writePost(id, metadata, body = articleBody) {
    writeFileSync(join(content, `${id}.md`), `---\n${stringify(metadata)}---\n\n${body}`);
  }
  for (let i = 1; i <= 13; i++) {
    const year = i <= 2 ? 2024 : i <= 8 ? 2025 : 2026;
    writePost(`note-${String(i).padStart(2, '0')}`, {
      title: `笔记 ${i}`, description: `摘要 ${i}`, pubDate: `${year}-08-${String(i).padStart(2, '0')}`, draft: false,
    });
  }
  writePost('中文文章', { title: '中文标题与固定网址', description: '', pubDate: '2026-09-01', draft: false });
  writePost('same-day', { title: `同一天的笔记：${'一个很长的中文标题'.repeat(6)}LongUnbrokenTitleForResponsiveReading`, pubDate: '2026-09-01', draft: false });
  writePost('hidden-draft', { title: 'PRIVATE_DRAFT_SENTINEL', pubDate: '2026-10-01', draft: draftDefault });
  writePost('default-draft', { title: 'DEFAULT_DRAFT_SENTINEL', pubDate: '2026-10-01' }, '');
  const read = (path) => readFileSync(join(fixture, 'dist', path), 'utf8');
  const runAstro = (command) => execFileSync(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), command, '--root', fixture], {
    cwd: fixture, encoding: 'utf8', timeout: 120_000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const build = () => runAstro('build');
  build();

  await t.test('homepage previews 6 latest articles; year-grouped archive has 12 then 3', () => {
    assert.equal((read('index.html').match(/data-kind="note"/g) ?? []).length, 6);
    assert.equal((read('posts/index.html').match(/class="post-link"/g) ?? []).length, 12);
    assert.equal((read('posts/page/2/index.html').match(/class="post-link"/g) ?? []).length, 3);
    assert.ok(read('posts/index.html').indexOf('同一天的笔记') < read('posts/index.html').indexOf('中文标题与固定网址'));
    for (const [path, expected] of [
      ['posts/index.html', [[2026, 7], [2025, 5]]],
      ['posts/page/2/index.html', [[2025, 1], [2024, 2]]],
    ]) {
      const groups = [...read(path).matchAll(/<section\b[^>]*aria-labelledby="notes-year-(\d+)"[^>]*>([\s\S]*?)<\/section>/g)];
      assert.deepEqual(groups.map(([, year, html]) => [Number(year), (html.match(/class="post-link"/g) ?? []).length]), expected);
      for (const [, year, html] of groups) {
        assert.match(html, new RegExp(`<h2[^>]*id="notes-year-${year}"`));
        const dates = [...html.matchAll(/<time[^>]*datetime="([^"]+)"/g)].map(([, date]) => date);
        assert.ok(dates.every(date => date.startsWith(`${year}-`)), `Incorrect article in ${year} section`);
        assert.deepEqual(dates, dates.toSorted().reverse());
      }
    }
    assert.doesNotMatch(read('index.html'), /class="paper-notes"/);
    assert.match(read('posts/page/2/index.html'), /rel="prev" href="\/posts\/"/);
    assert.ok(!existsSync(join(fixture, 'dist/posts/page/3')));
  });

  await t.test('all folders cap previews at 6 while preserving order, totals and complete archives', () => {
    const home = read('index.html');
    const tree = htmlToHast(home);
    const expected = {
      posts: { total: 15, unit: '篇', hrefs: ['same-day', '中文文章', 'note-13', 'note-12', 'note-11', 'note-10'].map(id => `/posts/${encodeURIComponent(id)}/`) },
      works: { total: 8, unit: '项', hrefs: fixtureWorks.slice(0, 6).map(work => work.url) },
      photos: { total: 8, unit: '张', hrefs: ['photo-window', 'photo-external', 'photo-old-6', 'photo-old-5', 'photo-old-4', 'photo-old-3'].map(id => `/photos/${id}/`) },
      friends: { total: 8, unit: '位', hrefs: fixtureFriends.slice(0, 6).map(friend => friend.url) },
    };
    for (const [category, { total, unit, hrefs }] of Object.entries(expected)) {
      const folder = elements(tree, node => node.properties.dataFolder === category)[0];
      assert.ok(folder, `${category} folder is rendered`);
      assert.deepEqual(elements(folder, node => node.tagName === 'li' && node.properties.dataHref).map(node => node.properties.dataHref), hrefs);
      assert.match(home, new RegExp(`aria-label="[^"]+，${total} ${unit}"`));
      const dialog = home.match(new RegExp(`<dialog id="${category}-gallery"[\\s\\S]*?<\\/dialog>`))?.[0];
      assert.ok(dialog, `${category} gallery is rendered`);
      assert.match(dialog, new RegExp(`href="/${category}/">全部 ${total} ${unit}`));
    }
    assert.equal((read('works/index.html').match(/class="work-print"/g) ?? []).length, 8);
    assert.equal((read('photos/index.html').match(/class="photo-entry"/g) ?? []).length, 8);
    assert.equal((read('friends/index.html').match(/class="friend-card"/g) ?? []).length, 8);
    for (const photo of fixturePhotos) assert.ok(existsSync(join(fixture, 'dist/photos', photo.id, 'index.html')));
  });

  await t.test('portrait artwork keeps its original ratio within the folder when resting, fanned and selected', () => {
    const tree = htmlToHast(read('index.html'));
    const folder = elements(tree, node => node.properties.dataFolder === 'works')[0];
    const entries = elements(folder, node => node.tagName === 'li' && node.properties.dataHref);
    const browser = galleryBrowser({ count: entries.length, reducedMotion: true });
    browser.leavePage();
    const wrap = browser.home.parentNode;
    wrap.offsetWidth = wrap.clientWidth = 306;
    wrap.offsetHeight = 260.1;
    entries.forEach((entry, index) => {
      const card = browser.cards[index];
      card.dataset.layout = 'photo';
      card.dataset.kind = 'photo';
      card.dataset.cardWidth = String(entry.properties.dataCardWidth);
      card.style.cssText = String(entry.properties.style);
      card.offsetWidth = wrap.clientWidth * Number(entry.properties.dataCardWidth) / 100;
      card.offsetHeight = card.offsetWidth / Number(entry.properties.dataRatio);
      card.offsetTop = wrap.offsetHeight * parseFloat(card.style.getPropertyValue('--top')) / 100;
    });
    browser.returnToPage();
    const portrait = browser.cards.at(-1);
    assert.equal(Number(entries.at(-1).properties.dataRatio), 1 / 4, 'Layout retains the uploaded 3×12 image ratio');
    assert.ok(portrait.offsetHeight <= wrap.offsetHeight * .78, 'The whole portrait fits into the preview instead of extending below its folder');

    function verticalBounds(card) {
      const transform = card.style.transform.match(/^translate\([^,]+,([^p]+)px\) rotate\(([^d]+)deg\) scale\(([^)]+)\)$/);
      assert.ok(transform, 'The real gallery script supplies the card pose');
      const [, y, degrees, scale] = transform.map(Number);
      const radians = degrees * Math.PI / 180;
      const halfHeight = (card.offsetWidth * Math.abs(Math.sin(radians)) + card.offsetHeight * Math.abs(Math.cos(radians))) * scale / 2;
      const center = card.offsetTop + card.offsetHeight / 2 + y;
      return { top: center - halfHeight, bottom: center + halfHeight, scale };
    }
    function assertInside(phase) {
      for (const card of browser.cards) {
        const bounds = verticalBounds(card);
        assert.ok(bounds.top >= 0 && bounds.bottom <= wrap.offsetHeight, `${phase}: artwork stays within both vertical folder edges`);
      }
    }
    browser.opener.emit('pointerleave');
    assertInside('resting');
    browser.opener.emit('pointerenter');
    assertInside('fanned');
    browser.opener.emit('pointermove', { clientX: 326, clientY: 130 });
    assert.ok(verticalBounds(portrait).scale > 1, 'The portrait is enlarged by actual hover selection');
    assertInside('selected');
    browser.opener.emit('pointerleave');
    assertInside('restored');
    browser.leavePage();
  });

  await t.test('drafts are absent from every public listing, feed, sitemap and route', () => {
    for (const file of ['index.html', 'posts/index.html', 'posts/page/2/index.html', 'rss.xml', 'sitemap-0.xml']) {
      assert.doesNotMatch(read(file), /PRIVATE_DRAFT_SENTINEL|DEFAULT_DRAFT_SENTINEL|hidden-draft|default-draft/);
    }
    assert.ok(!existsSync(join(fixture, 'dist/posts/hidden-draft')));
    assert.ok(!existsSync(join(fixture, 'dist/posts/default-draft')));
    assert.equal((read('rss.xml').match(/<item>/g) ?? []).length, 15);
  });

  await t.test('Chinese filenames, Markdown features, image URLs and metadata survive rendering', () => {
    const chinesePath = existsSync(join(fixture, 'dist/posts/中文文章/index.html'))
      ? 'posts/中文文章/index.html' : `posts/${encodeURIComponent('中文文章')}/index.html`;
    const html = read(chinesePath);
    for (const pattern of [/<h2\b/, /<blockquote>/, /<ul>/, /<pre\b/, /<table>/, /src="\/uploads\/photo.png"/, /第一段中文正文/]) assert.match(html, pattern);
    assertNoContentScripts(html);
    assert.ok(html.includes('name="description" content="第一段中文正文，用来检查自然阅读与摘要。"'));
    assert.ok(html.includes(`https://kaisenn.net/posts/${encodeURIComponent('中文文章')}/`));
    assert.match(html, /article:published_time/);
  });

  await t.test('CMS images, photos, friends and works generate complete static routes and folder cards', () => {
    const home = read('index.html');
    const photo = read('photos/photo-window/index.html');
    const external = read('photos/photo-external/index.html');
    for (const image of ['photo.png', 'avatar.png', 'work.png', 'work-icon.png']) {
      assert.ok(existsSync(join(fixture, 'dist/uploads', image)), `${image} is published at its CMS URL`);
    }
    assert.match(photo, /<img[^>]*src="\/uploads\/photo.png"[^>]*alt="测试上传的图片"[^>]*width="1"[^>]*height="1"/);
    assert.match(photo, /<link rel="canonical" href="https:\/\/kaisenn.net\/photos\/photo-window\/"/);
    assert.match(photo, /name="description" content="本地照片的测试说明。"/);
    assert.match(photo, /datetime="2026-09-20"/);
    assert.match(photo, /href="\/photos\/"/);
    assert.match(external, /src="https:\/\/images.example.com\/fixture-photo.webp"/);
    assert.doesNotMatch(external, /src="\/uploads\/photo.png"/);
    assert.match(home, /data-href="\/photos\/photo-window\/"/);
    assert.match(home, /data-href="https:\/\/friend.example.com\/hello\/"/);
    assert.match(home, /<img[^>]*src="\/uploads\/avatar.png"[^>]*data-avatar-image/);
    assert.match(home, /后台测试名字/);
    assert.match(home, /后台保存的个人简介。/);
    assert.match(home, /href="https:\/\/contact.example.com\/"/);
    assert.match(home, /<link rel="icon" href="\/uploads\/avatar.png"/);
    const photoList = read('photos/index.html');
    assert.ok(photoList.indexOf('href="/photos/photo-window/"') < photoList.indexOf('href="/photos/photo-external/"'));
    const friends = read('friends/index.html');
    assert.match(friends, /href="https:\/\/friend.example.com\/hello\/"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/);
    assert.match(friends, /测试用的友链简介。/);
    assert.match(friends, /href="https:\/\/another.example.com\/"/);
    assert.match(friends, /src="https:\/\/avatars.example.com\/friend.webp"/);
    const works = read('works/index.html');
    for (const work of fixtureWorks) assert.ok(works.includes(`href="${work.url}"`), `${work.title} links to its configured destination`);
    assert.match(works, /src="\/uploads\/work.png"/);
    assert.match(works, /src="https:\/\/images.example.com\/work.webp"/);
    assert.doesNotMatch(works, /作品说明 \d/);
    assert.deepEqual(readFileSync(join(fixture, 'dist/uploads/work-icon.png')), readFileSync(join(fixture, 'public/uploads/work-icon.png')), 'The transparent uploaded PNG is published unchanged');
    for (const html of [home, works]) {
      const iconWork = html.match(/<a\b[^>]*href="https:\/\/example.com\/work-1\/"[^>]*aria-label="作品 1"[\s\S]*?<\/a>/)?.[0];
      assert.ok(iconWork, 'The work link retains its accessible name without visible text');
      const icon = iconWork.match(/<img\b[^>]*src="\/uploads\/work-icon.png"[^>]*>/)?.[0];
      assert.ok(icon, 'The uploaded image appears in both the folder and complete works list');
      assert.match(icon, /width="12"[^>]*height="7"/);
      assert.equal((iconWork.match(/<img\b/g) ?? []).length, 1);
      assert.doesNotMatch(iconWork, /<h[1-6]\b|<p\b|class="work-(?:overlay|icon|cover)(?:\s|")|作品说明 1/);
      assert.doesNotMatch(iconWork, /src="\/uploads\/work.png"/);
      const coverWork = html.match(/<a\b[^>]*href="https:\/\/example.com\/work-2\/"[^>]*aria-label="作品 2"[\s\S]*?<\/a>/)?.[0];
      assert.ok(coverWork);
      assert.match(coverWork, /src="https:\/\/images.example.com\/work.webp"/);
      assert.equal((coverWork.match(/<img\b/g) ?? []).length, 1, 'A legacy cover replaces the icon instead of overlaying it');
      assert.doesNotMatch(coverWork, /src="\/uploads\/work-icon.png"|src="\/uploads\/work.png"/);
    }
    const imagelessWork = works.match(/<a\b[^>]*aria-label="作品 3"[\s\S]*?<\/a>/)?.[0];
    assert.ok(imagelessWork, 'A work can be published before a cover is uploaded');
    assert.doesNotMatch(imagelessWork, /<img\b/);
    assert.match(imagelessWork, /<svg\b/);
    for (const html of [photo, external, photoList, friends, works]) assertNoContentScripts(html);
    assert.match(read('sitemap-0.xml'), /https:\/\/kaisenn.net\/photos\/photo-window\//);
  });

  await t.test('omitting the optional avatar URL preserves the uploaded avatar', () => {
    const profile = { ...fixtureProfile };
    delete profile.avatarUrl;
    try {
      writeFileSync(profilePath, JSON.stringify(profile));
      runAstro('check');
      build();
      const home = read('index.html');
      assert.match(home, /data-avatar-placeholder/);
      assert.match(home, /<img[^>]*src="\/uploads\/avatar.png"[^>]*data-avatar-image/);
      assert.match(home, /<link rel="icon" href="\/uploads\/avatar.png"/);
      assert.match(home, /href="https:\/\/contact.example.com\/"/);
    } finally {
      writeFileSync(profilePath, JSON.stringify(fixtureProfile));
    }
  });

  await t.test('omitting all optional profile fields preserves the default appearance', () => {
    const profile = { ...fixtureProfile };
    for (const field of ['avatar', 'avatarUrl', 'favicon', 'contactUrl']) delete profile[field];
    try {
      writeFileSync(profilePath, JSON.stringify(profile));
      runAstro('check');
      build();
      const home = read('index.html');
      assert.match(home, /data-avatar-placeholder/);
      assert.doesNotMatch(home, /<img\b[^>]*data-avatar-image/);
      assert.match(home, /<link rel="icon" href="\/favicon.svg"/);
      assert.doesNotMatch(home, /contact\.example\.com/);
    } finally {
      writeFileSync(profilePath, JSON.stringify(fixtureProfile));
    }
  });

  await t.test('editing a title keeps its URL; moving a published post to draft removes output', () => {
    writePost('note-13', { title: '修改过的标题', description: '', pubDate: '2026-08-13', draft: false });
    writePost('note-01', { title: '改回草稿', pubDate: '2026-08-01', draft: true });
    fixturePhotos[0].title = '修改过标题的测试照片';
    writeFileSync(photosPath, JSON.stringify({ items: fixturePhotos }));
    fixtureProfile.avatarUrl = 'https://avatars.example.com/live-avatar.webp';
    writeFileSync(profilePath, JSON.stringify(fixtureProfile));
    build();
    assert.match(read('posts/note-13/index.html'), /修改过的标题/);
    assert.ok(!existsSync(join(fixture, 'dist/posts/note-01')));
    assert.doesNotMatch(read('rss.xml') + read('sitemap-0.xml'), /note-01/);
    assert.match(read('photos/photo-window/index.html'), /修改过标题的测试照片/);
    assert.match(read('index.html'), /data-href="\/photos\/photo-window\/"/);
    assert.match(read('index.html'), /<img[^>]*src="https:\/\/avatars.example.com\/live-avatar.webp"[^>]*data-avatar-image/);
  });

  await t.test('CMS blank rows build empty folders without blocking published notes', () => {
    const collections = [[worksPath, fixtureWorks], [photosPath, fixturePhotos], [friendsPath, fixtureFriends]];
    try {
      for (const [path] of collections) writeFileSync(path, JSON.stringify({ items: [{}] }));
      build();
      const home = read('index.html');
      for (const [category, message, unit] of [['works', '暂无作品', '项'], ['photos', '暂无照片', '张'], ['friends', '暂无链接', '位']]) {
        assert.match(home, new RegExp(`href="/${category}/">全部 0 ${unit}`));
        assert.match(read(`${category}/index.html`), new RegExp(message));
      }
      assert.match(home, /data-href="\/posts\/note-13\/"/);
      assert.match(read('posts/note-13/index.html'), /修改过的标题/);
      assert.match(read('rss.xml'), /note-13/);
      assert.doesNotMatch(read('sitemap-0.xml'), /photo-window/);
    } finally {
      for (const [path, items] of collections) writeFileSync(path, JSON.stringify({ items }));
    }
  });

  await t.test('empty collections and all-draft notes keep usable lists and folder fallbacks', () => {
    const originals = readdirSync(content).map(file => [file, readFileSync(join(content, file), 'utf8')]);
    try {
      for (const [file] of originals) writePost(file.replace(/\.md$/, ''), { title: 'Unpublished', pubDate: '2026-09-01', draft: true }, '');
      writeFileSync(photosPath, JSON.stringify({ items: [] }));
      writeFileSync(friendsPath, JSON.stringify({ items: [] }));
      writeFileSync(worksPath, JSON.stringify({ items: [] }));
      writeFileSync(profilePath, JSON.stringify({ ...fixtureProfile, avatar: '', avatarUrl: '', favicon: '', contactUrl: '' }));
      build();
      assert.match(read('index.html'), /暂无笔记/);
      assert.match(read('posts/index.html'), /暂无笔记/);
      assert.match(read('index.html'), /href="\/posts\/" data-folder-open="posts-gallery"/);
      assert.doesNotMatch(read('index.html'), /data-kind="note"/);
      assert.doesNotMatch(read('index.html'), /class="folder-item"/);
      for (const [category, message, unit] of [['posts', '暂无笔记', '篇'], ['works', '暂无作品', '项'], ['photos', '暂无照片', '张'], ['friends', '暂无链接', '位']]) {
        assert.match(read('index.html'), new RegExp(`href="/${category}/" data-folder-open="${category}-gallery"`));
        assert.match(read('index.html'), new RegExp(`href="/${category}/">全部 0 ${unit}`));
        assert.match(read('index.html'), new RegExp(message));
        assert.ok(existsSync(join(fixture, 'dist', category, 'index.html')));
      }
      assert.match(read('photos/index.html'), /暂无照片/);
      assert.match(read('friends/index.html'), /暂无链接/);
      assert.doesNotMatch(read('rss.xml'), /<item>/);
      assert.doesNotMatch(read('sitemap-0.xml'), /note-\d|same-day|中文文章/);
      assert.doesNotMatch(read('index.html'), /<img\b/);
      assert.doesNotMatch(read('index.html'), /contact\.example\.com/);
      assert.match(read('index.html'), /<link rel="icon" href="\/favicon.svg"/);
      for (const path of ['works/index.html', 'photos/index.html', 'friends/index.html']) {
        assert.doesNotMatch(read(path), /<img\b/);
        assert.doesNotMatch(read(path), /friend\.example\.com|images\.example\.com|作品说明|测试用的友链简介/);
      }
      assert.ok(!existsSync(join(fixture, 'dist/photos/photo-window')));
      assert.ok(!existsSync(join(fixture, 'dist/posts/page/2')));
      for (const [file] of originals) rmSync(join(content, file));
      writeFileSync(join(content, '.gitkeep'), '');
      build();
      assert.match(read('posts/index.html'), /暂无笔记/);
      assert.doesNotMatch(read('index.html'), /<img\b|data-kind="note"/);
      assert.doesNotMatch(read('rss.xml'), /<item>/);
      assert.ok(!existsSync(join(fixture, 'dist/posts/page/2')));
      for (const path of readdirSync(join(fixture, 'dist'), { recursive: true }).filter(path => path.endsWith('.html'))) {
        const html = read(path);
        assert.doesNotMatch(html, /<img\b/, `${path} must use placeholders when collections and profile images are empty`);
        assert.doesNotMatch(html, /sample-night|a-page-for-small-moments|排版测试|终极共生/, `${path} still contains removed content`);
        assert.doesNotMatch(html, /(?:src|href)="(?:#|\/assets\/images\/[^\"]+)"/, `${path} contains an old image or broken placeholder link`);
        assert.doesNotMatch(html, /(?:href|data-href)="\/(?:lab(?:[/?#"]|$)|persona\/2025(?:[/?#"]|$)|pages\/(?:persona-2025|sandbox-lab|home-redirect)\.html)/, `${path} contains a fixed link to a retired page`);
      }
    } finally {
      for (const [file, source] of originals) writeFileSync(join(content, file), source);
      writeFileSync(photosPath, JSON.stringify({ items: fixturePhotos }));
      writeFileSync(friendsPath, JSON.stringify({ items: fixtureFriends }));
      writeFileSync(worksPath, JSON.stringify({ items: fixtureWorks }));
      writeFileSync(profilePath, JSON.stringify(fixtureProfile));
    }
  });

  await t.test('publishing an empty article fails the build instead of shipping a blank page', () => {
    writePost('empty-published', { title: '空白笔记', pubDate: '2026-09-01', draft: false }, '');
    assert.throws(build, /has no body/);
    rmSync(join(content, 'empty-published.md'));
    if (process.env.KEEP_BLOG_FIXTURE === '1') build();
  });
});
