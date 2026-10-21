import { stagePoses, gridPoses, type CardSize, type CardPose } from '../lib/folder-poses';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const galleries = new Map<HTMLDialogElement, () => void>();

function initializeGallery(dialog: HTMLDialogElement) {
  if (galleries.has(dialog)) return;
  const opener = document.querySelector<HTMLAnchorElement>(`[data-folder-open="${dialog.id}"]`);
  const folder = opener?.closest<HTMLElement>('.folder');
  const home = folder?.querySelector<HTMLElement>('.folder-items');
  const wrap = folder?.querySelector<HTMLElement>('.folder-object');
  const flap = folder?.querySelector<HTMLElement>('.folder-flap');
  const stage = dialog.querySelector<HTMLElement>('.stage-cards');
  const viewport = dialog.querySelector<HTMLElement>('.stage-viewport');
  if (!opener || !folder || !home || !wrap || !flap || !stage || !viewport || typeof dialog.showModal !== 'function') return;
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const viewButtons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-gallery-view]')];
  const footer = dialog.querySelector<HTMLElement>('.stage-footer')!;
  const cards = [...home.querySelectorAll<HTMLElement>('.folder-item')];
  const decorations = [...home.querySelectorAll<HTMLElement>('.folder-decoration')];
  const previous = dialog.querySelector<HTMLButtonElement>('[data-gallery-prev]')!;
  const next = dialog.querySelector<HTMLButtonElement>('[data-gallery-next]')!;
  const count = dialog.querySelector<HTMLElement>('[data-gallery-count]')!;
  const empty = dialog.querySelector<HTMLElement>('.stage-empty')!;
  const homeStyles = cards.map(card => card.style.cssText);
  const decorationStyles = decorations.map(decoration => decoration.style.cssText);
  const flapStyle = flap.style.cssText;
  const animations = new Map<HTMLElement, Animation>();
  let status: 'closed' | 'open' | 'closing' = 'closed';
  let view: 'stack' | 'grid' = 'stack';
  let active = 0;
  let focused = -1;
  let expanded = false;
  let restoring = false;
  let epoch = 0;
  let layoutEpoch = 0;
  let slots: HTMLElement[] = [];
  let sizes: CardSize[] = [];
  let ignorePointerClickUntil = 0;
  let gesture: { id: number; x: number; y: number; background: boolean; touch: boolean } | null = null;
  let wheelTime = -Infinity;
  let wheelChangeTime = -Infinity;
  let wheelDirection = 0;
  let wheelDistance = 0;
  let wheelConsumed = false;
  let wheelMagnitude = 0;
  let wheelPeak = 0;

  function animationStart(element: HTMLElement) {
    const computed = getComputedStyle(element);
    return { transform: computed.transform, opacity: computed.opacity };
  }

  async function animate(element: HTMLElement, transform: string, opacity = 1, duration = 450, delay = 0, start = animationStart(element)) {
    animations.get(element)?.cancel();
    animations.delete(element);
    element.style.transform = transform;
    element.style.opacity = String(opacity);
    const card = element.classList.contains('folder-item');
    if (reduced.matches || duration === 0 || typeof element.animate !== 'function') {
      if (card) element.style.willChange = '';
      return;
    }
    if (card) element.style.willChange = 'transform, opacity';
    const animation = element.animate([start, { transform, opacity }], {
      duration, delay, easing: 'cubic-bezier(.22,.85,.24,1)', fill: 'backwards',
    });
    animations.set(element, animation);
    await animation.finished.catch(() => {});
    if (animations.get(element) === animation) {
      animations.delete(element);
      if (card) element.style.willChange = '';
    }
  }

  function transform(pose: CardPose, size: CardSize) {
    return `translate(${pose.x - size.width / 2}px,${pose.y - size.height / 2}px) rotate(${pose.rotation}deg) scale(${pose.scale})`;
  }

  function screenPoses(): CardPose[] {
    return cards.map(card => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const matrix = new DOMMatrix(style.transform);
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, scale: Math.hypot(matrix.a, matrix.b), opacity: Number(style.opacity) };
    });
  }

  function applyView(nextView: 'stack' | 'grid') {
    view = nextView;
    dialog.classList.toggle('is-grid', view === 'grid');
    footer.hidden = view === 'grid';
    if (view === 'stack') stage!.style.height = '';
    viewport!.scrollTop = 0;
    viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.galleryView === view)));
    resetWheel();
    gesture = null;
  }

  function changeView(nextView: 'stack' | 'grid', index = active) {
    if (status !== 'open' || view === nextView || !viewButtons.length) return;
    const starts = screenPoses();
    dialog.classList.add('is-reflowing');
    active = clampIndex(index);
    applyView(nextView);
    const origin = viewport!.getBoundingClientRect();
    const frames = starts.map((pose, i) => ({
      transform: transform({ ...pose, x: pose.x - origin.left, y: pose.y - origin.top }, sizes[i]),
      opacity: String(pose.opacity),
    }));
    render(320, 0, frames);
  }

  function decorationHome(decoration: HTMLElement) {
    const style = getComputedStyle(decoration);
    // Keep percentage offsets responsive when the folder changes width.
    const x = style.getPropertyValue('--decor-x').trim() || '0%';
    const rotation = style.getPropertyValue('--decor-turn').trim() || '0deg';
    return `translateX(${x}) rotate(${rotation})`;
  }

  function decorationRetirement() {
    return decorations.map(decoration => ({
      transform: `translateY(${decoration.offsetHeight * .12}px) ${decorationHome(decoration)} scale(.88)`,
      start: animationStart(decoration),
    }));
  }

  function retireDecorations(duration = 250, poses = decorationRetirement()) {
    poses.forEach((pose, i) => { void animate(decorations[i], pose.transform, 0, duration, 0, pose.start); });
  }

  // Spacing of fanned cards, as a percentage of the folder width. Hover hit-testing uses the same spacing.
  function fanStep() {
    const widest = Math.max(34, ...cards.map(card => Number(card.dataset.cardWidth)));
    return (100 - widest) / Math.max(cards.length - 1, 1);
  }

  function fan(isExpanded: boolean, singled = -1) {
    if (status !== 'closed' || restoring) return;
    expanded = isExpanded;
    focused = singled;
    const gaps = Math.max(cards.length - 1, 1);
    const step = fanStep();
    const wrapWidth = wrap!.clientWidth;
    const tuckLine = wrap!.offsetHeight * .4;
    const measurements = cards.map(card => ({ height: card.offsetHeight, top: card.offsetTop, start: animationStart(card) }));
    const decorationMeasurements = decorations.map(decoration => ({ height: decoration.offsetHeight, home: decorationHome(decoration), start: animationStart(decoration) }));
    const flapStart = animationStart(flap!);
    cards.forEach((card, i) => {
      const { height, top, start } = measurements[i];
      const offset = i - (cards.length - 1) / 2;
      const selected = expanded && i === singled;
      const yieldToSide = expanded && singled >= 0 && !selected ? Math.sign(i - singled) * 4 : 0;
      const x = (offset * (expanded ? step : 6) + yieldToSide) / 100 * wrapWidth;
      const lift = height * (selected ? .34 : .24);
      const tuckedLift = card.dataset.layout === 'photo'
        ? Math.min(lift, Math.max(0, top + height - tuckLine))
        : lift;
      const y = expanded ? -tuckedLift : 0;
      const rotation = selected ? 0 : offset * ((expanded ? 11 : 6) / gaps);
      card.style.zIndex = String(selected ? cards.length + 1 : cards.length - Math.round(Math.abs(offset)));
      const delay = singled < 0 ? Math.abs(offset) * (expanded ? 40 : 20) : 0;
      void animate(card, `translate(${x}px,${y}px) rotate(${rotation}deg) scale(${selected ? 1.05 : 1})`, 1, expanded ? 350 : 250, delay, start);
    });
    decorations.forEach((decoration, i) => {
      const { height, home, start } = decorationMeasurements[i];
      const index = Number(decoration.dataset.decorIndex ?? i);
      const offset = index - (decorations.length - 1) / 2;
      const pose = expanded
        ? `translate(${offset * wrapWidth * .14}px,${-height * .24}px) ${home} rotate(${offset * 5}deg)`
        : home;
      void animate(decoration, pose, 1, expanded ? 350 : 250, 0, start);
    });
    void animate(flap!, `rotateX(${expanded ? -30 : 0}deg)`, 1, 350, 0, flapStart);
  }

  function render(duration = 450, stagger = 0, initialFrames?: ReturnType<typeof animationStart>[]) {
    if (status !== 'open') return;
    const renderingEpoch = ++layoutEpoch;
    const layout = view === 'grid' ? gridPoses(sizes, viewport!.clientWidth) : null;
    const poses = layout?.poses ?? stagePoses(sizes, active, window.innerWidth, window.innerHeight);
    const starts = initialFrames ?? cards.map(animationStart);
    stage!.style.height = layout ? `${layout.height}px` : '';
    const flights = cards.map((card, i) => {
      const selected = i === active;
      card.classList.toggle('is-active', selected);
      card.style.setProperty('--stage-scale', String(poses[i].scale));
      card.style.zIndex = String(30 + cards.length - Math.abs(i - active));
      const content = card.querySelector<HTMLElement>('.card-content')!;
      const picker = card.querySelector<HTMLButtonElement>('.card-picker')!;
      content.inert = view === 'grid' || !selected;
      if (selected && view === 'stack') {
        content.removeAttribute('aria-hidden');
        content.removeAttribute('tabindex');
      } else {
        content.setAttribute('aria-hidden', 'true');
        content.tabIndex = -1;
      }
      picker.tabIndex = view === 'grid' ? 0 : -1;
      picker.setAttribute('aria-label', `${view === 'grid' ? '查看照片' : '选择'}：${card.dataset.title}`);
      return animate(card, transform(poses[i], sizes[i]), poses[i].opacity, duration, Math.min(Math.abs(i - active) * stagger, 100), starts[i]);
    });
    previous.setAttribute('aria-disabled', String(active === 0));
    next.setAttribute('aria-disabled', String(active >= cards.length - 1));
    count.textContent = cards.length ? `${active + 1} / ${cards.length}` : '0 / 0';
    empty.hidden = cards.length > 0;
    if (duration === 0 || reduced.matches || !cards.length) {
      dialog.classList.remove('is-reflowing');
    } else if (dialog.classList.contains('is-reflowing')) {
      // Restore the scroll window only after the current card flights have landed.
      void Promise.all(flights).then(() => {
        if (renderingEpoch === layoutEpoch && status === 'open') dialog.classList.remove('is-reflowing');
      });
    }
  }

  function clampIndex(index: number) {
    return Math.max(0, Math.min(cards.length - 1, index));
  }

  function focusActiveCard() {
    cards[active].querySelector<HTMLElement>('.card-content')!.focus({ preventScroll: true });
  }

  // Buttons, arrow keys, the wheel, swipes and side-card pickers all move through the stack here.
  // Focus follows the selection when it was already on a card. Returns whether the selection changed.
  function select(index: number): boolean {
    if (status !== 'open' || !cards.length) return false;
    const selected = clampIndex(index);
    if (selected === active) return false;
    const focusWasInCard = cards.some(card => card.contains(document.activeElement));
    active = selected;
    render();
    if (focusWasInCard) focusActiveCard();
    return true;
  }

  function resetWheel() {
    wheelTime = wheelChangeTime = -Infinity;
    wheelDirection = wheelDistance = 0;
    wheelConsumed = false;
    wheelMagnitude = wheelPeak = 0;
  }

  function open(index: number) {
    if (status !== 'closed') return true;
    status = 'open';
    epoch++;
    applyView('stack');
    active = clampIndex(index);
    sizes = cards.map(card => ({ width: card.offsetWidth, height: card.offsetHeight, kind: card.dataset.kind === 'note' ? 'note' : 'photo' }));
    const starts = screenPoses();
    const initialFrames = starts.map((pose, i) => ({ transform: transform(pose, sizes[i]), opacity: '1' }));
    const flapStart = animationStart(flap!);
    const retiringDecorations = decorationRetirement();
    try {
      dialog.showModal();
    } catch {
      status = 'closed';
      return false;
    }
    slots = cards.map((card, i) => {
      const slot = document.createElement('li');
      slot.className = 'folder-item';
      slot.style.cssText = homeStyles[i];
      slot.style.visibility = 'hidden';
      card.before(slot);
      return slot;
    });
    dialog.classList.remove('is-closing');
    stage!.inert = false;
    ignorePointerClickUntil = 0;
    gesture = null;
    resetWheel();
    document.documentElement.classList.add('gallery-open');
    cards.forEach((card, i) => {
      animations.get(card)?.cancel();
      animations.delete(card);
      card.style.width = sizes[i].width + 'px';
      card.style.height = sizes[i].height + 'px';
      stage!.append(card);
      card.style.transform = initialFrames[i].transform;
    });
    retireDecorations(250, retiringDecorations);
    void animate(flap!, 'rotateX(-80deg)', 0, 350, 0, flapStart);
    render(500, 25, initialFrames);
    return true;
  }

  function putContentsHome() {
    cards.forEach((card, i) => {
      if (slots[i]?.parentNode) slots[i].replaceWith(card);
      // Restore the original stack levels as well as the card geometry.
      card.style.cssText = homeStyles[i];
      card.classList.remove('is-active');
      const content = card.querySelector<HTMLElement>('.card-content')!;
      content.inert = false;
      content.removeAttribute('aria-hidden');
      content.removeAttribute('tabindex');
      content.scrollTop = 0;
      card.querySelector<HTMLButtonElement>('.card-picker')!.tabIndex = -1;
    });
    decorations.forEach((decoration, i) => { decoration.style.cssText = decorationStyles[i]; });
    slots = [];
  }

  function restore(returnFocus: boolean) {
    restoring = true;
    epoch++;
    layoutEpoch++;
    animations.forEach(animation => animation.cancel());
    animations.clear();
    putContentsHome();
    applyView('stack');
    flap!.style.cssText = flapStyle;
    stage!.inert = false;
    gesture = null;
    resetWheel();
    dialog.classList.remove('is-closing');
    dialog.classList.remove('is-reflowing');
    status = 'closed';
    expanded = false;
    focused = -1;
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove('gallery-open');
    if (returnFocus) opener!.focus({ preventScroll: true });
    restoring = false;
  }

  async function close() {
    if (status !== 'open') return;
    status = 'closing';
    resetWheel();
    const closingEpoch = ++epoch;
    layoutEpoch++;
    dialog.classList.add('is-closing');
    stage!.inert = true;
    const gridStarts = view === 'grid' ? screenPoses().map((pose, i) => ({ transform: transform(pose, sizes[i]), opacity: String(pose.opacity) })) : null;
    if (gridStarts) applyView('stack');
    dialog.classList.remove('is-reflowing');
    const destinations = cards.map((card, i) => {
      const rect = slots[i].getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(slots[i]).transform);
      const pose = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, scale: slots[i].offsetWidth / sizes[i].width, opacity: 1 };
      return { transform: transform(pose, sizes[i]), start: gridStarts?.[i] ?? animationStart(card) };
    });
    const decorationDestinations = decorations.map(decoration => ({ transform: decorationHome(decoration), start: animationStart(decoration) }));
    const cardFlights = cards.map((card, i) => animate(card, destinations[i].transform, 1, 400, Math.abs(i - active) * 30, destinations[i].start));
    const decorationFlights = decorations.map((decoration, i) => animate(decoration, decorationDestinations[i].transform, 1, 350, 0, decorationDestinations[i].start));
    await Promise.all([...cardFlights, ...decorationFlights]);
    if (closingEpoch !== epoch) return;
    putContentsHome();
    await animate(flap!, 'rotateX(0deg)', 1, 300);
    if (closingEpoch !== epoch) return;
    restore(true);
  }

  opener.setAttribute('aria-haspopup', 'dialog');
  opener.setAttribute('aria-controls', dialog.id);
  opener.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || opener.hasAttribute('download') || (opener.target && opener.target !== '_self')) return;
    if (open(focused >= 0 ? focused : 0)) event.preventDefault();
  }, { signal });
  opener.addEventListener('pointerenter', () => { if (finePointer.matches) fan(true); }, { signal });
  opener.addEventListener('pointerleave', () => { if (finePointer.matches) fan(false); }, { signal });
  opener.addEventListener('pointermove', event => {
    if (!finePointer.matches || status !== 'closed' || !expanded || cards.length < 2) return;
    const bounds = wrap.getBoundingClientRect();
    if (event.clientY > bounds.top + bounds.height * .24) { if (focused >= 0) fan(true); return; }
    const step = fanStep();
    let index = 0;
    let distance = Infinity;
    cards.forEach((_, i) => {
      const center = bounds.left + bounds.width * (.5 + (i - (cards.length - 1) / 2) * step / 100);
      if (Math.abs(event.clientX - center) < distance) { distance = Math.abs(event.clientX - center); index = i; }
    });
    if (focused !== index) fan(true, index);
  }, { signal });
  opener.addEventListener('focus', () => { if (opener.matches(':focus-visible')) fan(true); }, { signal });
  opener.addEventListener('blur', () => fan(false), { signal });
  previous.addEventListener('click', () => select(active - 1), { signal });
  next.addEventListener('click', () => select(active + 1), { signal });
  viewButtons.forEach(button => button.addEventListener('click', () => changeView(button.dataset.galleryView === 'grid' ? 'grid' : 'stack'), { signal }));
  cards.forEach((card, index) => {
    card.querySelector('.card-picker')!.addEventListener('click', () => {
      // A picker brings its card to the front, leaving the spread if needed, and moves focus onto it.
      if (view === 'grid') changeView('stack', index);
      else select(index);
      if (status === 'open') focusActiveCard();
    }, { signal });
    card.querySelector('.card-content')!.addEventListener('click', event => {
      // Only the front card of an open stack is a link. Side cards are inert and chosen through their pickers.
      if (status !== 'open' || index !== active) event.preventDefault();
    }, { signal });
  });
  dialog.querySelector('[data-gallery-close]')!.addEventListener('click', () => void close(), { signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); }, { signal });
  dialog.addEventListener('close', () => { if (!dialog.open && status !== 'closed') restore(true); }, { signal });
  dialog.addEventListener('keydown', event => {
    if (status !== 'open' || view === 'grid' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    select(active + (event.key === 'ArrowRight' ? 1 : -1));
  }, { signal });
  dialog.addEventListener('wheel', event => {
    if (status !== 'open' || view === 'grid' || cards.length < 2 || event.ctrlKey || event.metaKey || event.altKey) return;
    const axisDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const delta = axisDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    if (!delta) return;
    event.preventDefault();
    const now = performance.now();
    const direction = Math.sign(delta);
    const magnitude = Math.abs(delta);
    const elapsed = now - wheelTime;
    const ready = now - wheelChangeTime >= 140;
    const newGesture = elapsed > 120 || direction !== wheelDirection;
    const renewedPush = magnitude >= 24 && magnitude - wheelMagnitude >= 10 && magnitude >= wheelMagnitude * 1.4;
    // Repeated wheel notches can advance again; a fading trackpad tail cannot.
    const repeatedNotch = event.deltaMode !== 0 || (
      elapsed >= 24 && magnitude >= 32 && magnitude >= wheelPeak - 1 && Math.abs(magnitude - wheelMagnitude) <= 1
    );
    if (newGesture || (wheelConsumed && ready && (renewedPush || repeatedNotch))) {
      wheelDistance = 0;
      wheelConsumed = false;
      wheelPeak = magnitude;
    }
    wheelTime = now;
    wheelDirection = direction;
    wheelMagnitude = magnitude;
    wheelPeak = Math.max(wheelPeak, magnitude);
    if (wheelConsumed || !ready) return;
    wheelDistance += delta;
    if (Math.abs(wheelDistance) < 32) return;
    wheelConsumed = true;
    wheelDistance = 0;
    if (select(active + direction)) wheelChangeTime = now;
  }, { passive: false, signal });
  dialog.addEventListener('pointerdown', event => {
    if (status !== 'open' || event.button !== 0 || !event.isPrimary) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, background: event.target === dialog || event.target === stage || event.target === viewport, touch: event.pointerType === 'touch' };
  }, { signal });
  dialog.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (view === 'stack' && gesture.touch && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 2) {
      ignorePointerClickUntil = performance.now() + 350;
      select(active + (dx < 0 ? 1 : -1));
    }
    else if (gesture.background && (event.target === dialog || event.target === stage || event.target === viewport) && Math.abs(dx) < 8 && Math.abs(dy) < 8) void close();
    gesture = null;
  }, { signal });
  dialog.addEventListener('click', event => {
    if (event.detail && performance.now() < ignorePointerClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      ignorePointerClickUntil = 0;
    }
  }, { capture: true, signal });
  dialog.addEventListener('pointercancel', () => { gesture = null; }, { signal });
  window.addEventListener('resize', () => {
    if (status === 'open') render(0);
    else if (status === 'closing') restore(true);
    else fan(false);
  }, { signal });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    gesture = null;
    ignorePointerClickUntil = 0;
    resetWheel();
    if (status === 'open') render(0);
    else if (status === 'closing') restore(false);
  }, { signal });
  reduced.addEventListener('change', () => {
    if (status === 'open') {
      render(0);
      retireDecorations(0);
      void animate(flap!, 'rotateX(-80deg)', 0, 0);
    } else if (status === 'closing') restore(true);
    else fan(false);
  }, { signal });
  galleries.set(dialog, () => {
    lifecycle.abort();
    restore(false);
  });
}

function initializeGalleries() {
  document.querySelectorAll<HTMLDialogElement>('.folder-stage').forEach(initializeGallery);
}

initializeGalleries();
document.addEventListener('astro:page-load', initializeGalleries);
document.addEventListener('astro:before-swap', () => {
  galleries.forEach(dispose => dispose());
  galleries.clear();
});
