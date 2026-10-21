import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryBrowser } from './helpers/gallery-browser.mjs';

function assertAtHome(browser, styles) {
  assert.equal(browser.dialog.open, false);
  assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
  assert.deepEqual(browser.home.children, [...browser.cards, ...browser.decorations], 'the same content returns in its original order');
  assert.equal(browser.stage.children.length, 0);
  assert.equal(browser.document.documentElement.classList.contains('gallery-open'), false);
  browser.cards.forEach((card, index) => {
    assert.equal(card.style.cssText, styles[index], 'home geometry and stack level are restored');
    assert.equal(card.classList.contains('is-active'), false);
    assert.equal(card.querySelector('.card-content').getAttribute('tabindex'), null);
  });
}

test('repeated page-load events initialize each gallery once without multiplying controls', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  for (let visit = 0; visit < 3; visit++) {
    browser.document.emit('astro:page-load');
    browser.document.emit('astro:page-load');
    assert.equal(browser.opener.listeners.get('click').length, 1);
    assert.equal(browser.window.listeners.get('resize').length, 1);
    browser.open();
    browser.controls.next.emit('click');
    assert.equal(browser.controls.count.textContent, '2 / 6', 'one click advances exactly one card');
    browser.leavePage();
    await browser.settle();
    assert.equal(browser.window.listeners.get('resize').length, 0);
    assert.equal(browser.opener.listeners.get('click').length, 0);
    browser.returnToPage();
    browser.closeEvents();
  }
  browser.open();
  browser.views.grid.emit('click');
  await browser.settle();
  assertGrid(browser);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('page swaps dispose moving galleries and cannot leak a lock or stale animation into the next visit', async () => {
  for (const phase of ['hover', 'open', 'grid', 'closing']) {
    const browser = galleryBrowser({ count: 6, tiled: true, decorationCount: 2 });
    const styles = browser.cards.map(card => card.style.cssText);
    browser.opener.emit('pointerenter');
    if (phase !== 'hover') browser.open();
    if (phase === 'grid') browser.views.grid.emit('click');
    if (phase === 'closing') browser.controls.close.emit('click');
    assert.ok(browser.animations.size > 0);
    browser.leavePage();
    assertAtHome(browser, styles);
    assert.equal(browser.animations.size, 0);
    browser.window.emit('resize');
    browser.window.emit('pageshow', { persisted: true });
    browser.setReducedMotion(true);
    assert.equal(browser.animations.size, 0, 'detached galleries no longer respond to global events');
    browser.setReducedMotion(false);
    browser.returnToPage();
    browser.open();
    browser.closeEvents();
    await browser.settle();
    assertStack(browser, 0);
    browser.controls.next.emit('click');
    assertStack(browser, 1);
    browser.controls.close.emit('click');
    await browser.settle();
    assertAtHome(browser, styles);
  }
});

test('background close returns every card below the folder flap across repeated cycles', async () => {
  const browser = galleryBrowser();
  const styles = browser.cards.map(card => card.style.cssText);
  for (let cycle = 0; cycle < 3; cycle++) {
    browser.open();
    browser.controls.next.emit('click');
    browser.controls.next.emit('click');
    browser.background();
    assert.equal(browser.dialog.open, true, 'dialog remains modal during the return flight');
    assert.equal(browser.stage.inert, true);
    await browser.settle();
    assertAtHome(browser, styles);
    assert.equal(browser.document.activeElement, browser.opener);
    browser.closeEvents();
  }
});

test('side cards select once while the active card keeps native link behavior', async () => {
  const browser = galleryBrowser();
  browser.open();
  const first = browser.cards[0].querySelector('.card-content');
  const second = browser.cards[1].querySelector('.card-content');
  assert.equal(first.getAttribute('tabindex'), null);
  assert.equal(first.emit('click').defaultPrevented, false);
  assert.equal(first.emit('click', { metaKey: true }).defaultPrevented, false);
  browser.cards[1].querySelector('.card-picker').emit('click');
  assert.equal(browser.document.activeElement, second);
  assert.equal(second.getAttribute('tabindex'), null);
  assert.equal(first.inert, true);
  assert.equal(second.emit('click').defaultPrevented, false);
  second.emit('keydown', { key: 'ArrowRight' });
  assert.equal(browser.document.activeElement, browser.cards[2].querySelector('.card-content'));
  browser.dialog.emit('cancel');
  await browser.settle();
});

test('opening uses home measurements without rereading moved cards, while interrupted selection samples the current pose', async () => {
  const browser = galleryBrowser();
  browser.opener.focus();
  browser.styleReads.length = 0;
  browser.open();
  const openingReads = browser.styleReads.filter(read => browser.cards.includes(read.element));
  assert.equal(openingReads.length, browser.cards.length, 'each opening pose is measured once');
  assert.ok(openingReads.every(read => read.parent === browser.home), 'moving cards into the stage must not trigger another computed-style read');
  for (const card of browser.cards) {
    const flight = [...browser.animations].find(animation => animation.owner === card);
    assert.equal(flight.frames[0].transform, 'translate(20px,120px) rotate(0deg) scale(1)', 'the opening flight starts at the captured viewport position');
  }

  const currentPoses = browser.cards.map((card, index) => {
    const transform = `translate(${140 + index * 120}px,180px) rotate(${index}deg) scale(1.6)`;
    card.style.transform = transform;
    return transform;
  });
  browser.styleReads.length = 0;
  browser.controls.next.emit('click');
  const selectionReads = browser.styleReads.filter(read => browser.cards.includes(read.element));
  assert.equal(selectionReads.length, browser.cards.length);
  assert.ok(selectionReads.every(read => read.parent === browser.stage), 'selection samples the cards already moving in the stage');
  browser.cards.forEach((card, index) => {
    const flight = [...browser.animations].find(animation => animation.owner === card);
    assert.equal(flight.frames[0].transform, currentPoses[index], 'a new selection continues the current pose instead of replaying the opening origin');
  });
  browser.controls.close.emit('click');
  await browser.settle();
});

test('card compositing hints survive interrupted flights and clear after settling, closing, or reduced motion', async () => {
  const browser = galleryBrowser();
  const assertHints = expected => browser.cards.forEach(card => assert.equal(card.style.willChange, expected));
  browser.open();
  assertHints('transform, opacity');
  const openingFlights = [...browser.animations].filter(animation => browser.cards.includes(animation.owner));
  browser.controls.next.emit('click');
  await Promise.all(openingFlights.map(animation => animation.finished.catch(() => {})));
  await Promise.resolve();
  assertHints('transform, opacity');
  assert.ok(browser.cards.every(card => [...browser.animations].some(animation => animation.owner === card)), 'canceled opening flights must not clear the hints of replacement flights');
  await browser.settle();
  assertHints('');

  browser.controls.next.emit('click');
  assertHints('transform, opacity');
  browser.setReducedMotion(true);
  await browser.settle();
  assertHints('');
  assert.equal(browser.dialog.open, true);

  browser.setReducedMotion(false);
  browser.controls.close.emit('click');
  assertHints('transform, opacity');
  await browser.settle();
  assertHints('');
  assert.equal(browser.dialog.open, false);
  browser.closeEvents();
  browser.setReducedMotion(true);
  browser.open();
  assertHints('');
  browser.controls.close.emit('click');
  await browser.settle();
  assertHints('');
});

test('resize during close cancels the old return flight and cannot restore a newly opened stage', async () => {
  const browser = galleryBrowser();
  const styles = browser.cards.map(card => card.style.cssText);
  browser.open();
  browser.stage.emit('pointerdown');
  browser.dialog.emit('cancel');
  browser.window.emit('resize');
  assertAtHome(browser, styles);
  browser.open();
  browser.stage.emit('pointerup');
  browser.closeEvents();
  await browser.settle();
  assert.equal(browser.dialog.open, true);
  assert.equal(browser.stage.children.length, browser.cards.length);
  browser.controls.close.emit('click');
  await browser.settle();
  assertAtHome(browser, styles);
});

test('rapid close requests and reduced-motion changes do not leave stage styles or placeholders', async () => {
  const browser = galleryBrowser();
  const styles = browser.cards.map(card => card.style.cssText);
  browser.open();
  browser.controls.close.emit('click');
  browser.dialog.emit('cancel');
  browser.background();
  browser.setReducedMotion(true);
  await browser.settle();
  assertAtHome(browser, styles);
  browser.open();
  browser.controls.close.emit('click');
  await browser.settle();
  assertAtHome(browser, styles);
});

test('touch swipes select without following the synthetic click; background drags stay open', async () => {
  const browser = galleryBrowser();
  browser.open();
  const first = browser.cards[0].querySelector('.card-content');
  first.emit('pointerdown', { pointerType: 'touch', clientX: 180 });
  first.emit('pointerup', { pointerType: 'touch', clientX: 70 });
  assert.equal(browser.cards[1].classList.contains('is-active'), true);
  assert.equal(first.emit('click').defaultPrevented, true);
  browser.stage.emit('pointerdown', { clientX: 20 });
  browser.stage.emit('pointerup', { clientX: 90 });
  assert.equal(browser.dialog.open, true);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('empty collections close and failed dialogs preserve the fallback URL', async () => {
  const empty = galleryBrowser({ count: 0 });
  empty.open();
  assert.equal(empty.controls.count.textContent, '0 / 0');
  empty.controls.close.emit('click');
  await empty.settle();
  assertAtHome(empty, []);
  const unavailable = galleryBrowser({ showModalFails: true });
  assert.equal(unavailable.open().defaultPrevented, false);
  assert.equal(unavailable.dialog.open, false);
  assert.equal(unavailable.home.children.length, unavailable.cards.length);
  const modified = galleryBrowser();
  assert.equal(modified.opener.emit('click', { metaKey: true }).defaultPrevented, false);
  assert.equal(modified.dialog.open, false);
});

test('empty-folder decorations fan on hover and focus without becoming gallery content', async () => {
  const browser = galleryBrowser({ count: 0, decorationCount: 2 });
  const styles = browser.decorations.map(decoration => decoration.style.cssText);
  browser.opener.emit('pointerenter');
  browser.decorations.forEach(decoration => {
    assert.match(decoration.style.transform, /translate\([^,]+px,-[\d.]+px\)/);
    assert.equal(decoration.getAttribute('tabindex'), null);
    assert.equal(decoration.href, undefined);
  });
  browser.opener.emit('pointerleave');
  browser.decorations.forEach((decoration, index) => {
    assert.equal(decoration.style.transform, `translateX(${index ? 9 : -9}%) rotate(${index ? 5 : -5}deg)`);
  });
  browser.opener.focus();
  assert.match(browser.decorations[0].style.transform, /translate\([^,]+px,-[\d.]+px\)/);
  browser.open();
  assert.equal(browser.controls.count.textContent, '0 / 0');
  assert.equal(browser.stage.children.length, 0);
  assert.equal(browser.home.inert, true);
  browser.decorations.forEach(decoration => {
    assert.equal(decoration.style.opacity, '0');
    assert.equal(decoration.parentNode, browser.home);
  });
  browser.background();
  await browser.settle();
  assertAtHome(browser, []);
  browser.decorations.forEach((decoration, index) => assert.equal(decoration.style.cssText, styles[index]));
});

test('hover chooses the fanned card nearest the pointer, even when every card is narrow', async () => {
  const browser = galleryBrowser();
  const wrap = browser.home.parentNode;
  wrap.offsetWidth = wrap.clientWidth = 320;
  wrap.offsetHeight = 250;
  for (const card of browser.cards) card.dataset.cardWidth = '20';
  browser.opener.emit('pointerenter');
  const folderCenter = 20 + 320 / 2;
  const [, middle, right] = browser.cards.map(card => folderCenter + Number(card.style.transform.match(/^translate\((-?[\d.]+)px/)[1]));
  browser.opener.emit('pointermove', { clientX: middle + (right - middle) * .6, clientY: 140 });
  assert.match(browser.cards[2].style.transform, /scale\(1\.05\)/, 'the card drawn closest to the pointer is lifted');
  assert.doesNotMatch(browser.cards[1].style.transform, /scale\(1\.05\)/);
  browser.opener.emit('pointerleave');
  await browser.settle();
});

test('photo hover keeps short cards tucked into the folder while notes retain their full lift', async () => {
  const browser = galleryBrowser();
  const wrap = browser.home.parentNode;
  wrap.offsetWidth = wrap.clientWidth = 320;
  wrap.offsetHeight = 250;
  const [shortPhoto, deeperPhoto, note] = browser.cards;
  Object.assign(shortPhoto, { offsetTop: 40, offsetHeight: 60 });
  Object.assign(deeperPhoto, { offsetTop: 30, offsetHeight: 80 });
  shortPhoto.dataset.layout = deeperPhoto.dataset.layout = 'photo';
  note.dataset.layout = 'note';
  const y = card => Number(card.style.transform.match(/^translate\([^,]+,(-?[\d.]+)px\)/)?.[1]);
  const assertTucked = () => {
    for (const photo of [shortPhoto, deeperPhoto]) {
      assert.ok(photo.offsetTop + photo.offsetHeight + y(photo) >= wrap.offsetHeight * .4,
        'the translated photo bottom remains inside the open folder cover');
    }
  };

  browser.opener.emit('pointerenter');
  assert.equal(y(shortPhoto), 0, 'a short photo already at the overlap limit must not float upwards');
  assert.equal(y(deeperPhoto), -10, 'a deeper photo can rise only through the available overlap');
  assert.equal(y(note), -note.offsetHeight * .24);
  assertTucked();

  browser.opener.emit('pointermove', { clientX: 74, clientY: 140 });
  assert.match(shortPhoto.style.transform, /rotate\(0deg\) scale\(1\.05\)/);
  assert.equal(y(shortPhoto), 0);
  assertTucked();
  browser.opener.emit('pointermove', { clientX: 180, clientY: 140 });
  assert.match(deeperPhoto.style.transform, /rotate\(0deg\) scale\(1\.05\)/);
  assert.equal(y(deeperPhoto), -10, 'the selected photo remains tucked despite its larger nominal lift');
  assertTucked();
  browser.opener.emit('pointermove', { clientX: 286, clientY: 140 });
  assert.equal(y(note), -note.offsetHeight * .34, 'selection keeps the existing note animation');
  assertTucked();

  browser.opener.emit('pointerleave');
  for (const card of browser.cards) assert.equal(y(card), 0);
  await browser.settle();
});

test('empty-folder decorations recover from interrupted close and respect reduced motion', async () => {
  const browser = galleryBrowser({ count: 0, decorationCount: 2, reducedMotion: true });
  const styles = browser.decorations.map(decoration => decoration.style.cssText);
  browser.opener.emit('pointerenter');
  assert.equal(browser.animations.size, 0);
  browser.open();
  assert.equal(browser.animations.size, 0);
  browser.dialog.emit('cancel');
  browser.window.emit('resize');
  browser.open();
  await browser.settle();
  assert.equal(browser.dialog.open, true);
  browser.setReducedMotion(false);
  browser.controls.close.emit('click');
  browser.window.emit('pagehide');
  browser.window.emit('pageshow', { persisted: true });
  await browser.settle();
  assertAtHome(browser, []);
  browser.decorations.forEach((decoration, index) => assert.equal(decoration.style.cssText, styles[index]));
  assert.equal(browser.animations.size, 0);
});

test('native navigation leaves the open gallery intact and BFCache restores its selected card', async () => {
  const browser = galleryBrowser();
  browser.open();
  browser.controls.next.emit('click');
  await browser.settle();
  const selected = browser.cards[1].querySelector('.card-content');
  const styles = browser.cards.map(card => card.style.cssText);
  const slots = [...browser.home.children];
  assert.equal(selected.emit('click').defaultPrevented, false);
  assert.equal(selected.emit('click', { ctrlKey: true }).defaultPrevented, false);
  browser.window.emit('pagehide', { persisted: true });
  assert.equal(browser.dialog.open, true);
  assert.deepEqual(browser.stage.children, browser.cards);
  assert.deepEqual(browser.home.children, slots);
  assert.deepEqual(browser.cards.map(card => card.style.cssText), styles);
  assert.equal(browser.document.documentElement.classList.contains('gallery-open'), true);
  browser.window.innerWidth = 768;
  browser.window.emit('pageshow', { persisted: true });
  assert.equal(browser.cards[1].classList.contains('is-active'), true);
  assert.equal(browser.controls.count.textContent, '2 / 3');
  assert.equal(browser.dialog.open, true);
  assert.equal(browser.animations.size, 0, 'returning does not replay the opening animation');
  assert.notEqual(browser.cards[1].style.cssText, styles[1], 'the retained gallery adapts to the restored viewport');
  browser.controls.next.emit('click');
  assert.equal(browser.controls.count.textContent, '3 / 3');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('BFCache recovery finishes an interrupted close without a stale flight closing a new gallery', async () => {
  const browser = galleryBrowser();
  const styles = browser.cards.map(card => card.style.cssText);
  browser.open();
  browser.controls.close.emit('click');
  browser.window.emit('pagehide', { persisted: true });
  browser.window.emit('pageshow', { persisted: false });
  assert.equal(browser.dialog.open, true, 'ordinary pageshow does not interrupt a close');
  assert.equal(browser.stage.inert, true);
  browser.window.emit('pageshow', { persisted: true });
  assertAtHome(browser, styles);
  browser.open();
  browser.closeEvents();
  await browser.settle();
  assert.equal(browser.dialog.open, true);
  assert.deepEqual(browser.stage.children, browser.cards);
  browser.controls.close.emit('click');
  await browser.settle();
  assertAtHome(browser, styles);
});

for (const [name, deltaMode, deltaY] of [['pixels', 0, 32], ['lines', 1, 2], ['pages', 2, 1]]) {
  test(`wheel ${name} select a card and retain native navigation on the new card`, async () => {
    const browser = galleryBrowser();
    browser.open();
    const event = browser.cards[0].querySelector('.card-content').emit('wheel', { deltaMode, deltaY });
    assert.equal(event.defaultPrevented, true);
    assert.equal(browser.controls.count.textContent, '2 / 3');
    assert.equal(browser.cards[1].querySelector('.card-content').emit('click').defaultPrevented, false);
    browser.controls.close.emit('click');
    await browser.settle();
  });
}

test('wheel accumulates small deltas, follows the dominant axis and clears opposite partial movement', async () => {
  const browser = galleryBrowser();
  browser.open();
  for (let i = 0; i < 2; i++) {
    browser.stage.emit('wheel', { deltaX: 12, deltaY: -2 });
    browser.advanceTime(30);
  }
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.stage.emit('wheel', { deltaX: 12, deltaY: -2 });
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.advanceTime(160);
  browser.stage.emit('wheel', { deltaY: 24 });
  browser.advanceTime(30);
  browser.stage.emit('wheel', { deltaY: -24 });
  assert.equal(browser.controls.count.textContent, '2 / 3', 'opposite partial movement does not reuse the old accumulation');
  browser.advanceTime(30);
  browser.stage.emit('wheel', { deltaY: -24 });
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('small line-mode wheel notches accumulate to one selection', async () => {
  const browser = galleryBrowser();
  browser.open();
  browser.stage.emit('wheel', { deltaMode: 1, deltaY: 1 });
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.advanceTime(60);
  browser.stage.emit('wheel', { deltaMode: 1, deltaY: 1 });
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('a fading wheel gesture advances once while renewed force responds without waiting for a pause', async () => {
  const browser = galleryBrowser({ count: 5 });
  browser.open();
  browser.stage.emit('wheel', { deltaY: 80 });
  for (let i = 0; i < 10; i++) {
    browser.advanceTime(80);
    browser.stage.emit('wheel', { deltaY: 60 - i * 4 });
  }
  assert.equal(browser.controls.count.textContent, '2 / 5', 'the inertial tail does not keep flipping cards after the cooldown');
  for (let i = 0; i < 3; i++) {
    browser.advanceTime(60);
    browser.stage.emit('wheel', { deltaY: 24 });
  }
  assert.equal(browser.controls.count.textContent, '2 / 5', 'a level patch in the fading tail is not another wheel notch');
  browser.advanceTime(60);
  browser.stage.emit('wheel', { deltaY: 60 });
  assert.equal(browser.controls.count.textContent, '3 / 5');
  browser.advanceTime(80);
  browser.stage.emit('wheel', { deltaY: -60 });
  assert.equal(browser.controls.count.textContent, '3 / 5', 'direction changes still respect the minimum switch interval');
  browser.advanceTime(80);
  browser.stage.emit('wheel', { deltaY: -60 });
  assert.equal(browser.controls.count.textContent, '2 / 5');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('a fresh wheel gesture can advance again after 140 ms', async () => {
  const browser = galleryBrowser({ count: 5 });
  browser.open();
  browser.stage.emit('wheel', { deltaY: 40 });
  browser.advanceTime(140);
  browser.stage.emit('wheel', { deltaY: 40 });
  assert.equal(browser.controls.count.textContent, '3 / 5', 'a second deliberate roll does not wait for the old 350 ms lock');
  browser.controls.close.emit('click');
  await browser.settle();
});

for (const [name, deltaMode, deltaY] of [['pixel', 0, 80], ['line', 1, 3]]) {
  test(`continuous ${name} wheel notches keep advancing without a stopped gesture`, async () => {
    const browser = galleryBrowser({ count: 6 });
    browser.open();
    browser.stage.emit('wheel', { deltaMode, deltaY });
    for (let i = 0; i < 4; i++) {
      browser.advanceTime(80);
      browser.stage.emit('wheel', { deltaMode, deltaY });
    }
    assert.equal(browser.controls.count.textContent, '4 / 6');
    browser.controls.close.emit('click');
    await browser.settle();
  });
}

test('acceleration during the first wheel impulse does not release its later inertial tail', async () => {
  const browser = galleryBrowser({ count: 5 });
  browser.open();
  for (const deltaY of [40, 60, 80, 100, 80, 60, 40, 40, 40, 24, 12]) {
    browser.stage.emit('wheel', { deltaY });
    browser.advanceTime(30);
  }
  assert.equal(browser.controls.count.textContent, '2 / 5');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('reversing a continuous gesture after the cooldown permits one switch back', async () => {
  const browser = galleryBrowser();
  browser.open();
  browser.stage.emit('wheel', { deltaY: 60 });
  for (let i = 0; i < 4; i++) {
    browser.advanceTime(100);
    browser.stage.emit('wheel', { deltaY: 10 });
  }
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.advanceTime(20);
  browser.stage.emit('wheel', { deltaY: -60 });
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('boundary selection and outward wheel input do not replay card animations', async () => {
  const browser = galleryBrowser();
  browser.open();
  await browser.settle();
  browser.controls.prev.emit('click');
  browser.stage.emit('wheel', { deltaY: -60 });
  assert.equal(browser.controls.count.textContent, '1 / 3');
  assert.equal(browser.animations.size, 0);
  browser.controls.next.emit('click');
  browser.controls.next.emit('click');
  await browser.settle();
  browser.advanceTime(400);
  browser.controls.next.emit('click');
  browser.stage.emit('wheel', { deltaY: 60 });
  assert.equal(browser.controls.count.textContent, '3 / 3');
  assert.equal(browser.animations.size, 0);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('wheel preserves zoom modifiers and is not intercepted by closed, closing or single-card galleries', async () => {
  const browser = galleryBrowser();
  assert.equal(browser.dialog.emit('wheel', { deltaY: 100 }).defaultPrevented, false);
  browser.open();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(browser.stage.emit('wheel', { deltaY: 100, [modifier]: true }).defaultPrevented, false);
  }
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.stage.emit('wheel', { deltaY: 48 });
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.controls.close.emit('click');
  assert.equal(browser.stage.emit('wheel', { deltaY: 100 }).defaultPrevented, false);
  await browser.settle();
  for (const count of [0, 1]) {
    const sparse = galleryBrowser({ count });
    sparse.open();
    assert.equal(sparse.stage.emit('wheel', { deltaY: 100 }).defaultPrevented, false);
    sparse.controls.close.emit('click');
    await sparse.settle();
  }
});

test('reopening and BFCache restoration clear wheel state while reduced motion remains usable', async () => {
  const browser = galleryBrowser({ reducedMotion: true });
  browser.open();
  browser.stage.emit('wheel', { deltaY: 60 });
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.controls.close.emit('click');
  await browser.settle();
  browser.open();
  browser.stage.emit('wheel', { deltaY: 24 });
  assert.equal(browser.controls.count.textContent, '1 / 3');
  browser.stage.emit('wheel', { deltaY: 24 });
  assert.equal(browser.controls.count.textContent, '2 / 3');
  browser.window.emit('pagehide', { persisted: true });
  browser.window.emit('pageshow', { persisted: true });
  browser.stage.emit('wheel', { deltaY: 48 });
  assert.equal(browser.controls.count.textContent, '3 / 3');
  assert.equal(browser.animations.size, 0);
  browser.controls.close.emit('click');
  await browser.settle();
});

function assertGrid(browser) {
  assert.equal(browser.dialog.open, true);
  assert.equal(browser.dialog.classList.contains('is-grid'), true);
  assert.equal(browser.views.grid.getAttribute('aria-pressed'), 'true');
  assert.equal(browser.views.stack.getAttribute('aria-pressed'), 'false');
  assert.equal(browser.footer.hidden, true);
  assert.deepEqual(browser.stage.children, browser.cards, 'spreading reuses the same cards in the same dialog');
  browser.cards.forEach(card => {
    assert.equal(card.querySelector('.card-content').inert, true);
    assert.equal(card.querySelector('.card-content').tabIndex, -1);
    assert.equal(card.querySelector('.card-picker').tabIndex, 0);
  });
}

function assertStack(browser, selected) {
  assert.equal(browser.dialog.open, true);
  assert.equal(browser.dialog.classList.contains('is-grid'), false);
  assert.equal(browser.views.stack.getAttribute('aria-pressed'), 'true');
  assert.equal(browser.views.grid.getAttribute('aria-pressed'), 'false');
  assert.equal(browser.footer.hidden, false);
  browser.cards.forEach((card, index) => {
    const content = card.querySelector('.card-content');
    assert.equal(content.inert, index !== selected);
    assert.equal(card.querySelector('.card-picker').tabIndex, -1);
    assert.equal(card.classList.contains('is-active'), index === selected);
  });
}

test('photos spread inside the existing gallery and a picker returns to the selected stack card', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  browser.open();
  const stackHeight = browser.stage.style.height;
  browser.views.grid.emit('click');
  assertGrid(browser);
  assert.ok(parseFloat(browser.stage.style.height) > 0, 'the spread has a scrollable canvas height');
  browser.viewport.scrollTop = 180;
  browser.cards[4].querySelector('.card-picker').emit('click');
  assertStack(browser, 4);
  assert.equal(browser.stage.style.height, stackHeight, 'stack mode clears the spread canvas height');
  assert.equal(browser.viewport.scrollTop, 0);
  const selected = browser.cards[4].querySelector('.card-content');
  assert.equal(browser.document.activeElement, selected);
  assert.equal(selected.emit('click').defaultPrevented, false);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('photo mode changes keep the flight space open until every card reaches its destination', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  browser.open();
  await browser.settle();
  browser.viewport.getBoundingClientRect = () => browser.dialog.classList.contains('is-grid')
    ? { left: 24, top: 92, width: 900, height: 740 }
    : { left: 0, top: 0, width: 1280, height: 900 };
  browser.cards.forEach((card, index) => {
    card.getBoundingClientRect = () => ({ left: 40 + index * 150, top: 30, width: 108, height: 166 });
  });
  browser.views.grid.emit('click');
  assert.equal(browser.dialog.classList.contains('is-reflowing'), true);
  const flights = [...browser.animations].filter(animation => browser.cards.includes(animation.owner));
  assert.equal(flights.length, 6);
  flights.forEach((flight, index) => {
    assert.equal(flight.frames[0].transform, `translate(${16 + index * 150}px,-62px) rotate(0deg) scale(1)`,
      'changing the viewport origin preserves the card’s screen position, including positions above its new top edge');
  });
  const pending = flights.pop();
  flights.forEach(animation => animation.finish());
  await Promise.all(flights.map(animation => animation.finished));
  assert.equal(browser.dialog.classList.contains('is-reflowing'), true, 'the last moving photo must still have the complete flight space');
  pending.finish();
  await browser.settle();
  assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
  assertGrid(browser);
  assert.equal(browser.viewport.emit('wheel', { deltaY: 80 }).defaultPrevented, false, 'settled photos retain native scrolling');
  browser.controls.close.emit('click');
  await browser.settle();
});

test('cancelled photo flights cannot clip a newer reverse transition', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  browser.open();
  await browser.settle();
  for (const nextView of ['grid', 'stack', 'grid']) {
    const replaced = [...browser.animations];
    browser.views[nextView].emit('click');
    await Promise.all(replaced.map(animation => animation.finished.catch(() => {})));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(browser.dialog.classList.contains('is-reflowing'), true,
      'a cancelled batch cannot restore clipping while its replacement still moves');
    assert.ok(browser.cards.every(card => [...browser.animations].some(animation => animation.owner === card)));
  }
  await browser.settle();
  assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
  assertGrid(browser);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('interrupted photo mode changes restore normal viewport behavior without stale completions', async () => {
  for (const interrupt of ['resize', 'pageshow', 'reduced', 'close']) {
    const browser = galleryBrowser({ count: 6, tiled: true });
    browser.open();
    await browser.settle();
    browser.views.grid.emit('click');
    assert.equal(browser.dialog.classList.contains('is-reflowing'), true);
    if (interrupt === 'close') browser.controls.close.emit('click');
    else if (interrupt === 'reduced') browser.setReducedMotion(true);
    else browser.window.emit(interrupt, { persisted: true });
    assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
    await browser.settle();
    assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
    if (interrupt !== 'close') {
      assertGrid(browser);
      browser.controls.close.emit('click');
      await browser.settle();
    }
    browser.open();
    browser.closeEvents();
    assertStack(browser, 0);
    browser.views.grid.emit('click');
    await browser.settle();
    assertGrid(browser);
    assert.equal(browser.dialog.classList.contains('is-reflowing'), false);
    browser.controls.close.emit('click');
    await browser.settle();
  }
});

test('spread mode leaves wheel and touch movement to native scrolling without changing selection', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  browser.open();
  browser.controls.next.emit('click');
  browser.views.grid.emit('click');
  const count = browser.controls.count.textContent;
  for (const [deltaX, deltaY] of [[0, 80], [0, -80], [100, 0]]) {
    assert.equal(browser.viewport.emit('wheel', { deltaX, deltaY }).defaultPrevented, false);
    browser.advanceTime(160);
  }
  const picker = browser.cards[1].querySelector('.card-picker');
  picker.emit('pointerdown', { pointerType: 'touch', clientX: 200, clientY: 200 });
  picker.emit('pointerup', { pointerType: 'touch', clientX: 60, clientY: 220 });
  browser.viewport.emit('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 300 });
  browser.viewport.emit('pointerup', { pointerType: 'touch', clientX: 100, clientY: 100 });
  assertGrid(browser);
  assert.equal(browser.controls.count.textContent, count);
  browser.views.stack.emit('click');
  assertStack(browser, 1);
  browser.controls.close.emit('click');
  await browser.settle();
});

test('repeated view changes and direct spread closes restore links, styles and the default stack mode', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  const styles = browser.cards.map(card => card.style.cssText);
  for (let cycle = 0; cycle < 3; cycle++) {
    browser.open();
    assertStack(browser, 0);
    const stackHeight = browser.stage.style.height;
    for (let switchCount = 0; switchCount < 2; switchCount++) {
      browser.views.grid.emit('click');
      assertGrid(browser);
      browser.viewport.scrollTop = 120;
      browser.views.stack.emit('click');
      assertStack(browser, 0);
      assert.equal(browser.stage.style.height, stackHeight);
      assert.equal(browser.viewport.scrollTop, 0);
    }
    browser.views.grid.emit('click');
    browser.viewport.scrollTop = 180;
    browser.controls.close.emit('click');
    await browser.settle();
    assertAtHome(browser, styles);
    assert.equal(browser.dialog.classList.contains('is-grid'), false);
    assert.equal(browser.viewport.scrollTop, 0);
    browser.cards.forEach(card => {
      assert.equal(card.querySelector('.card-content').inert, false);
      assert.equal(card.querySelector('.card-picker').tabIndex, -1);
    });
    browser.closeEvents();
  }
});

test('spread mode survives resize, reduced motion and BFCache without replaying flights', async () => {
  const browser = galleryBrowser({ count: 6, tiled: true });
  browser.open();
  browser.views.grid.emit('click');
  await browser.settle();
  const desktopHeight = browser.stage.style.height;
  browser.window.innerWidth = 375;
  browser.window.innerHeight = 812;
  browser.viewport.offsetWidth = browser.viewport.clientWidth = 343;
  browser.viewport.offsetHeight = browser.viewport.clientHeight = 650;
  browser.window.emit('resize');
  assertGrid(browser);
  assert.notEqual(browser.stage.style.height, desktopHeight);
  assert.equal(browser.animations.size, 0);
  browser.setReducedMotion(true);
  assertGrid(browser);
  assert.equal(browser.animations.size, 0);
  browser.window.emit('pagehide', { persisted: true });
  browser.window.emit('pageshow', { persisted: true });
  assertGrid(browser);
  assert.equal(browser.animations.size, 0);
  browser.views.stack.emit('click');
  assertStack(browser, 0);
  browser.views.grid.emit('click');
  assertGrid(browser);
  assert.equal(browser.animations.size, 0);
  browser.controls.close.emit('click');
  await browser.settle();
  assert.equal(browser.dialog.open, false);
});

test('an interrupted spread close safely restores before reopening', async () => {
  for (const interrupt of ['resize', 'pageshow', 'reduced']) {
    const browser = galleryBrowser({ count: 6, tiled: true });
    const styles = browser.cards.map(card => card.style.cssText);
    browser.open();
    browser.views.grid.emit('click');
    browser.controls.close.emit('click');
    if (interrupt === 'reduced') browser.setReducedMotion(true);
    else browser.window.emit(interrupt, { persisted: true });
    assertAtHome(browser, styles);
    browser.open();
    browser.closeEvents();
    await browser.settle();
    assertStack(browser, 0);
    browser.views.grid.emit('click');
    assertGrid(browser);
    browser.controls.close.emit('click');
    await browser.settle();
    assertAtHome(browser, styles);
  }
});
