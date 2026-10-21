// Feedback while the client router fetches the next page: a progress bar once it takes a moment, and the
// new content easing in when it arrives. The view transition snapshots nothing (see PageTransition.astro),
// so leaving a page never stalls on a capture of the old one.

// A prefetched page usually arrives sooner than this, so the bar never flashes for it.
const PROGRESS_DELAY = 150;
// Long enough for the bar's closing transition in PageTransition.astro.
const PROGRESS_FINISH = 400;

const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let progress: 'idle' | 'waiting' | 'shown' = 'idle';
let timer: ReturnType<typeof setTimeout> | undefined;

document.addEventListener('astro:before-preparation', () => {
  clearTimeout(timer);
  // Another click while the bar is running keeps it running.
  if (progress === 'shown') return;
  progress = 'waiting';
  timer = setTimeout(() => {
    progress = 'shown';
    root.dataset.navigation = 'loading';
  }, PROGRESS_DELAY);
});

document.addEventListener('astro:before-swap', event => {
  clearTimeout(timer);
  // The swap copies the new page's root attributes over the old ones. Marking the new root lets a bar that
  // was showing run on to its end, instead of restarting once the old attribute is gone.
  if (progress === 'shown') {
    event.newDocument.documentElement.dataset.navigation = 'done';
    timer = setTimeout(() => { delete root.dataset.navigation; }, PROGRESS_FINISH);
  }
  progress = 'idle';
});

document.addEventListener('astro:after-swap', () => {
  const main = document.querySelector('main');
  if (!main || reduced.matches) return;
  main.classList.add('is-entering');
  const settle = (event: Event) => {
    if (event.target !== main) return;
    main.classList.remove('is-entering');
    main.removeEventListener('animationend', settle);
  };
  main.addEventListener('animationend', settle);
});
