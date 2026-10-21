import test from 'node:test';
import assert from 'node:assert/strict';

// A small document: router events, the root's data attributes as the swap leaves them, and one <main>.
function page({ reducedMotion = false } = {}) {
  const document = new EventTarget();
  document.documentElement = { dataset: {} };
  const main = new EventTarget();
  main.classList = new Set();
  main.classList.add = main.classList.add.bind(main.classList);
  main.classList.remove = main.classList.delete.bind(main.classList);
  document.querySelector = selector => selector === 'main' ? main : null;
  // The router's swap copies the new page's root attributes over the old ones.
  const swap = () => {
    const newDocument = { documentElement: { dataset: {} } };
    document.dispatchEvent(Object.assign(new Event('astro:before-swap'), { newDocument }));
    document.documentElement.dataset = { ...newDocument.documentElement.dataset };
    document.dispatchEvent(new Event('astro:after-swap'));
  };
  const navigate = (fetchTime, t) => {
    document.dispatchEvent(new Event('astro:before-preparation'));
    t.mock.timers.tick(fetchTime);
    swap();
  };
  return { document, main, swap, navigate, window: { matchMedia: () => ({ matches: reducedMotion }) } };
}

async function feedback(t, options) {
  const browser = page(options);
  Object.assign(globalThis, { document: browser.document, window: browser.window });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Each test gets a fresh copy of the module, bound to its own document.
  await import(`../src/scripts/navigation-feedback.ts?${Math.random()}`);
  return browser;
}

test('a page that arrives quickly swaps in without the progress bar and eases its content in', async t => {
  const browser = await feedback(t);
  browser.navigate(100, t);
  assert.equal(browser.document.documentElement.dataset.navigation, undefined, 'no flash of the bar for a prefetched page');
  assert.ok(browser.main.classList.has('is-entering'));
  const fromInside = Object.defineProperty(new Event('animationend'), 'target', { value: {} });
  browser.main.dispatchEvent(fromInside);
  assert.ok(browser.main.classList.has('is-entering'), 'an animation inside the content does not end its entrance');
  browser.main.dispatchEvent(new Event('animationend'));
  assert.ok(!browser.main.classList.has('is-entering'));
});

test('a slow page shows the bar, which finishes its run after the swap and then clears', async t => {
  const browser = await feedback(t);
  const { dataset } = browser.document.documentElement;
  browser.document.dispatchEvent(new Event('astro:before-preparation'));
  t.mock.timers.tick(149);
  assert.equal(dataset.navigation, undefined);
  t.mock.timers.tick(1);
  assert.equal(browser.document.documentElement.dataset.navigation, 'loading');
  browser.document.dispatchEvent(new Event('astro:before-preparation'));
  assert.equal(browser.document.documentElement.dataset.navigation, 'loading', 'a second click keeps the running bar');
  browser.swap();
  assert.equal(browser.document.documentElement.dataset.navigation, 'done', 'the new page carries the bar on to its end');
  t.mock.timers.tick(400);
  assert.equal(browser.document.documentElement.dataset.navigation, undefined);
  browser.navigate(100, t);
  assert.equal(browser.document.documentElement.dataset.navigation, undefined, 'the next quick page stays clear');
});

test('reduced motion swaps content in place', async t => {
  const browser = await feedback(t, { reducedMotion: true });
  browser.navigate(100, t);
  assert.ok(!browser.main.classList.has('is-entering'));
});
