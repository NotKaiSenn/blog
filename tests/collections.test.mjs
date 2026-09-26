import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceUrl = new URL('../src/lib/collections.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const collectionModule = {};
new Function('exports', 'require', compiled.outputText)(collectionModule, createRequire(fileURLToPath(sourceUrl)));
const { parsePhotos, parseFriends, parseWorks } = collectionModule;

const photo = { id: 'window', title: '窗边', date: '2026-09-21', src: '/uploads/window.webp', alt: '窗外的树', width: 1600, height: 900 };

test('untouched CMS list rows are ignored without changing populated entries', () => {
  const blankRows = [{}, { title: '', url: null, icon: undefined }, { name: ' \n\t ', width: null }];
  for (const [parse, populated] of [
    [parseWorks, [{ title: '作品一', url: '/one/' }, { title: '作品二', url: '/two/' }]],
    [parseFriends, [{ name: '朋友一', url: 'https://one.example.com/' }, { name: '朋友二', url: 'https://two.example.com/' }]],
    [parsePhotos, [photo, { ...photo, id: 'another', date: '2026-09-20' }]],
  ]) {
    assert.deepEqual(parse({ items: blankRows }), []);
    assert.deepEqual(parse({ items: [blankRows[0], populated[0], blankRows[1], populated[1], blankRows[2]] }), parse({ items: populated }));
  }
});

test('blank-row handling still rejects invalid and partially filled entries at their original positions', () => {
  for (const parse of [parseWorks, parseFriends, parsePhotos]) {
    for (const item of [null, [], '', 0, false, { title: 0 }, { title: false }, { title: {} }, { title: [] }]) {
      assert.throws(() => parse({ items: [{}, item] }), /2\b/);
    }
  }
  assert.throws(() => parseWorks({ items: [{}, { title: '未填写链接' }] }), /Work 2\.url/);
  assert.throws(() => parseFriends({ items: [{}, { name: '未填写链接' }] }), /Friend 2\.url/);
  assert.throws(() => parsePhotos({ items: [{}, { ...photo, src: '' }] }), /Photo 2\.src/);
  assert.throws(() => parseWorks({ items: [{}, { title: '非法链接', url: 'javascript:alert(1)' }] }), /Work 2\.url/);
});

test('photo data rejects duplicate routes, invalid calendar dates and missing image sources', () => {
  assert.throws(() => parsePhotos({ items: [photo, { ...photo, title: '另一个标题' }] }), /Duplicate photo id/);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', 'not-a-date']) {
    assert.throws(() => parsePhotos({ items: [{ ...photo, date }] }), /valid date/);
  }
  assert.throws(() => parsePhotos({ items: [{ ...photo, id: '../window' }] }), /\.id/);
  assert.throws(() => parsePhotos({ items: [{ ...photo, src: '' }] }), /\.src/);
  assert.throws(() => parsePhotos({ items: [{ ...photo, width: -1 }] }), /dimension/);
  assert.throws(() => parsePhotos({ items: [{ ...photo, height: '900' }] }), /dimension/);
  assert.equal(parsePhotos({ items: [{ ...photo, date: '2024-02-29' }] })[0].date, '2024-02-29');
});

test('media paths stay within uploads and remote links use HTTPS without credentials', () => {
  for (const src of ['/uploads/../private.webp', '/uploads/%2e%2e/private.webp', '/uploads/%5cprivate.webp', '/uploads/', '//example.com/photo.webp', 'javascript:alert(1)', 'http://example.com/photo.webp', 'https://user:password@example.com/photo.webp']) {
    assert.throws(() => parsePhotos({ items: [{ ...photo, src }] }), undefined, src);
    assert.throws(() => parseFriends({ items: [{ name: '朋友', url: 'https://example.com/', avatar: src }] }), undefined, src);
  }
  const remote = parsePhotos({ items: [{ ...photo, src: '', externalSrc: 'https://cdn.example.com/photo.webp?version=2' }] });
  assert.equal(remote[0].src, 'https://cdn.example.com/photo.webp?version=2');
  assert.throws(() => parsePhotos({ items: [{ ...photo, externalSrc: 'http://cdn.example.com/photo.webp' }] }), /HTTPS/);
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:password@example.com']) {
    assert.throws(() => parseFriends({ items: [{ name: '朋友', url }] }), /HTTPS/);
  }
});

test('friend avatars accept uploads and give HTTPS external overrides priority', () => {
  const friend = { name: '测试友链', url: 'https://example.com/', avatar: '/uploads/avatar.webp' };
  assert.equal(parseFriends({ items: [friend] })[0].avatar, '/uploads/avatar.webp');
  assert.equal(parseFriends({ items: [{ ...friend, avatarUrl: 'https://cdn.example.com/avatar.webp' }] })[0].avatar, 'https://cdn.example.com/avatar.webp');
  assert.equal(parseFriends({ items: [{ ...friend, avatar: '', avatarUrl: 'https://cdn.example.com/avatar.webp' }] })[0].avatar, 'https://cdn.example.com/avatar.webp');
  assert.equal(parseFriends({ items: [{ ...friend, avatarUrl: '' }] })[0].avatar, '/uploads/avatar.webp');
  for (const avatarUrl of ['/uploads/avatar.webp', 'http://example.com/avatar.webp', 'https://user:password@example.com/avatar.webp']) {
    assert.throws(() => parseFriends({ items: [{ ...friend, avatarUrl }] }), /HTTPS/);
  }
});

test('CMS works keep configured order, accept optional uploaded covers and prioritize external covers', () => {
  const work = { id: 'first', title: '第一个作品', url: 'https://example.com/project/', description: '作品说明', image: '/uploads/work.png' };
  const works = parseWorks({ items: [
    work,
    { id: 'second', title: '第二个作品', url: 'https://example.com/' },
    { ...work, id: 'third', imageUrl: 'https://cdn.example.com/work.png' },
  ] });
  assert.deepEqual(works.map(work => work.id), ['first', 'second', 'third']);
  assert.deepEqual(works.map(work => work.image), ['/uploads/work.png', undefined, 'https://cdn.example.com/work.png']);
  assert.equal(works[0].description, '作品说明');
  assert.deepEqual(parseWorks({ items: [] }), []);
});

test('work dimensions accept external image sizes and otherwise use a square fallback', () => {
  const work = { title: '作品', url: '/', icon: 'https://images.example.com/work.png' };
  const parsed = parseWorks({ items: [work, { ...work, width: 900, height: 1600 }] });
  assert.deepEqual(parsed.map(({ width, height }) => [width, height]), [[1, 1], [900, 1600]]);
  for (const invalid of [0, -1, 2.5, '900']) {
    assert.throws(() => parseWorks({ items: [{ ...work, width: invalid }] }), /dimension/);
    assert.throws(() => parseWorks({ items: [{ ...work, height: invalid }] }), /dimension/);
  }
});

test('works can be submitted with an icon, text and link without manual identifiers', () => {
  const works = parseWorks({ items: [
    { title: '上传的作品', icon: '/uploads/work-icon.png', url: 'https://example.com/project/', description: '作品说明' },
    { title: '独立页面', icon: 'https://images.example.com/icon.png', url: '/projects/example/' },
    { title: '暂无图标', icon: '', url: 'https://example.com/another/' },
  ] });
  assert.deepEqual(works.map(work => work.title), ['上传的作品', '独立页面', '暂无图标']);
  assert.deepEqual(works.map(work => work.icon), ['/uploads/work-icon.png', 'https://images.example.com/icon.png', undefined]);
  assert.equal(works[0].description, '作品说明');
  assert.equal(works[1].url, '/projects/example/');
  assert.equal(works[1].image, undefined);
  assert.equal(works[2].description, undefined);
  assert.equal(parseWorks({ items: [{ title: '无图标字段', url: '/' }] })[0].icon, undefined);
  for (const field of ['title', 'url']) {
    assert.throws(() => parseWorks({ items: [{ title: '作品', url: '/', [field]: '' }] }), new RegExp(`\\.${field}`));
  }
});

test('uploaded work icons cannot escape uploads or use unsafe remote sources', () => {
  for (const icon of ['/uploads/../private.png', '/uploads/%2e%2e/private.png', '/uploads/%5cprivate.png', '/uploads/icon.png?x=1', '/uploads/', '//example.com/icon.png', 'javascript:alert(1)', 'http://example.com/icon.png', 'https://user:password@example.com/icon.png']) {
    assert.throws(() => parseWorks({ items: [{ title: '作品', url: 'https://example.com/', icon }] }), undefined, icon);
  }
});

test('works reject duplicate identifiers, unsafe destinations and invalid cover paths', () => {
  const work = { id: 'example', title: '作品', url: 'https://example.com/project/' };
  assert.throws(() => parseWorks({ items: [work, work] }), /Duplicate work id/);
  assert.throws(() => parseWorks({ items: [{ ...work, id: '../example' }] }), /\.id/);
  for (const url of ['//example.com/', '/%2fexample.com/', '/\\example.com/', 'javascript:alert(1)', 'http://example.com/', 'https://user:password@example.com/']) {
    assert.throws(() => parseWorks({ items: [{ ...work, url }] }), undefined, url);
  }
  for (const image of ['/uploads/../private.png', '/uploads/%2e%2e/private.png', '/uploads/', '//example.com/photo.png', 'http://example.com/photo.png']) {
    assert.throws(() => parseWorks({ items: [{ ...work, image }] }), undefined, image);
  }
});
