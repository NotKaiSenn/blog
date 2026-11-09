import { EASE_SETTLE } from './motion';

// Clicking a thing lifts its picture out of the grid into a card of frosted glass; closing flies it home.
// Without scripts, or with a modifier key held, the link still leads to the thing's own page.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOTION = { open: 520, close: 400, text: 360, textDelay: 120, textStagger: 40, fade: 200 };

type Rect = { left: number; top: number; width: number; height: number };

// Places a copy of a picture over `to`, then animates it from `from`, so it ends exactly where the real one sits.
function fly(sheet: HTMLElement, picture: HTMLImageElement, from: Rect, to: Rect, duration: number) {
  const flight = picture.cloneNode() as HTMLImageElement;
  flight.removeAttribute('loading');
  flight.removeAttribute('class');
  flight.className = 'thing-flight';
  Object.assign(flight.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  // The dialog sits in the top layer, so the flight must too, or the backdrop would cover it.
  sheet.append(flight);
  const animation = flight.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
    { transform: 'none' },
  ], { duration, easing: EASE_SETTLE, fill: 'forwards' });
  return { flight, finished: animation.finished };
}

// A card grows out of, and shrinks back into, the spot its thing occupies in the grid.
function fromSpot(card: HTMLElement, spot: Rect) {
  const box = card.getBoundingClientRect();
  const dx = spot.left + spot.width / 2 - (box.left + box.width / 2);
  const dy = spot.top + spot.height / 2 - (box.top + box.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${Math.min(.6, spot.width / box.width * 1.6)})`;
}

const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0;
const visible = (rect: Rect) => rect.width > 0 && rect.top < innerHeight && rect.top + rect.height > 0;

class ThingShelf extends HTMLElement {
  private lifecycle?: AbortController;

  connectedCallback() {
    this.lifecycle = new AbortController();
    const { signal } = this.lifecycle;
    this.setUpFilter(signal);
    this.setUpCards(signal);
  }

  disconnectedCallback() {
    this.lifecycle?.abort();
  }

  // Filtering only hides items, so without scripts every thing is still listed and the filter stays hidden.
  private setUpFilter(signal: AbortSignal) {
    const filter = this.querySelector<HTMLElement>('.thing-filter');
    if (!filter) return;
    const buttons = [...filter.querySelectorAll<HTMLButtonElement>('button')];
    const items = [...this.querySelectorAll<HTMLElement>('.thing-grid > li')];
    filter.hidden = false;
    filter.addEventListener('click', event => {
      const button = (event.target as Element).closest('button');
      if (!button) return;
      const category = button.dataset.category;
      for (const each of buttons) each.setAttribute('aria-pressed', String(each === button));
      for (const item of items) item.hidden = Boolean(category) && item.dataset.category !== category;
    }, { signal });
  }

  private setUpCards(signal: AbortSignal) {
    const sheet = this.querySelector<HTMLDialogElement>('.thing-sheet');
    if (!sheet || typeof sheet.showModal !== 'function') return;
    let open: { link: HTMLAnchorElement; card: HTMLElement } | null = null;
    let busy = false;

    const parts = (link: HTMLAnchorElement, card: HTMLElement) => ({
      spot: link.querySelector<HTMLElement>('.thing-frame')!,
      thumb: link.querySelector<HTMLImageElement>('.thing-frame img'),
      picture: card.querySelector<HTMLImageElement>('.card-art img'),
      text: [...card.querySelectorAll<HTMLElement>('.card-text > *')],
    });

    const show = async (link: HTMLAnchorElement) => {
      const card = sheet.querySelector<HTMLElement>(`.thing-card[data-thing="${CSS.escape(link.dataset.thing ?? '')}"]`);
      if (!card || busy) return;
      busy = true;
      open = { link, card };
      for (const each of sheet.querySelectorAll<HTMLElement>('.thing-card')) each.hidden = each !== card;
      sheet.setAttribute('aria-labelledby', card.getAttribute('aria-labelledby') ?? '');
      sheet.scrollTop = 0;
      sheet.showModal();
      sheet.classList.add('is-shown');
      const { spot, thumb, picture, text } = parts(link, card);
      if (reduced.matches) {
        await card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.fade }).finished.catch(() => {});
        busy = false;
        return;
      }
      const spotRect = (thumb ?? spot).getBoundingClientRect();
      // Measure where the picture lands before the card starts growing, while it still sits at its final size.
      const landing = picture?.getBoundingClientRect();
      card.animate([
        { opacity: 0, transform: fromSpot(card, spotRect) },
        { opacity: 1, offset: .45 },
        { opacity: 1, transform: 'none' },
      ], { duration: MOTION.open, easing: EASE_SETTLE });
      text.forEach((part, index) => part.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: MOTION.text, delay: MOTION.textDelay + index * MOTION.textStagger, easing: EASE_SETTLE, fill: 'backwards' },
      ));
      if (thumb && picture && landing && ready(thumb)) {
        // The thumbnail is already decoded, so it makes the journey while the card's sharper copy loads.
        const { flight, finished } = fly(sheet, thumb, spotRect, landing, MOTION.open);
        picture.style.visibility = 'hidden';
        link.classList.add('is-away');
        await finished.catch(() => {});
        const land = () => {
          picture.style.visibility = '';
          flight.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.fade, fill: 'forwards' }).finished.then(() => flight.remove(), () => flight.remove());
        };
        if (ready(picture)) land();
        else {
          picture.addEventListener('load', land, { once: true });
          picture.addEventListener('error', land, { once: true });
        }
      }
      busy = false;
    };

    const hide = async () => {
      if (!open || busy) return;
      busy = true;
      const { link, card } = open;
      const { spot, thumb, picture, text } = parts(link, card);
      sheet.classList.remove('is-shown');
      const spotRect = (thumb ?? spot).getBoundingClientRect();
      const motions: Promise<unknown>[] = [];
      if (!reduced.matches) {
        if (thumb && picture && ready(picture) && visible(spotRect)) {
          // Fly the card's own picture home and land it on the thumbnail.
          sheet.querySelectorAll('.thing-flight').forEach(flight => flight.remove());
          const { flight, finished } = fly(sheet, picture, picture.getBoundingClientRect(), spotRect, MOTION.close);
          picture.style.visibility = 'hidden';
          link.classList.add('is-away');
          motions.push(finished);
        }
        text.forEach(part => part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.close / 3, fill: 'forwards' }));
        motions.push(card.animate([
          { opacity: 1, transform: 'none' },
          { opacity: 1, offset: .5 },
          { opacity: 0, transform: fromSpot(card, spotRect) },
        ], { duration: MOTION.close, easing: EASE_SETTLE, fill: 'forwards' }).finished);
      } else {
        motions.push(card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.fade, fill: 'forwards' }).finished);
      }
      await Promise.all(motions.map(motion => motion.catch(() => {})));
      sheet.close();
      card.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      sheet.querySelectorAll('.thing-flight').forEach(flight => flight.remove());
      if (picture) picture.style.visibility = '';
      link.classList.remove('is-away');
      link.focus({ preventScroll: true });
      open = null;
      busy = false;
    };

    this.addEventListener('click', event => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a.thing-link');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void show(link);
    }, { signal });
    sheet.addEventListener('click', event => {
      const target = event.target as Element;
      if (target === sheet || target.closest('.card-close')) void hide();
    }, { signal });
    sheet.addEventListener('cancel', event => { event.preventDefault(); void hide(); }, { signal });
  }
}

if (!customElements.get('thing-shelf')) customElements.define('thing-shelf', ThingShelf);
