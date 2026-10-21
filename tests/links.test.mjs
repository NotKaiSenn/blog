import test from 'node:test';
import assert from 'node:assert/strict';
import { linkProps } from '../src/lib/links.ts';

test('addresses on this site stay in the tab as paths, however they are written', () => {
  assert.deepEqual(linkProps('/works/minecraftwidget/'), { href: '/works/minecraftwidget/' });
  assert.deepEqual(linkProps('https://kaisenn.net/'), { href: '/' });
  assert.deepEqual(linkProps('https://kaisenn.net/photos/?from=friends#top'), { href: '/photos/?from=friends#top' });
  assert.deepEqual(linkProps('https://KaiSenn.net/posts/'), { href: '/posts/' });
});

test('other sites open in a new tab and keep their full address', () => {
  for (const href of ['https://friend.example.com/', 'https://x.com/RealKaiSenn/', 'https://kaisenn.net.example.com/', 'https://example.com/kaisenn.net/']) {
    assert.deepEqual(linkProps(href), { href, rel: 'noopener noreferrer', target: '_blank' });
  }
});
