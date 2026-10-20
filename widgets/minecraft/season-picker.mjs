import './minecraft-widget.mjs';
import { prefetchSeason, resolveAssetBase } from './asset-cache.mjs';

class MinecraftSeasonPicker extends HTMLElement {
  connectedCallback() {
    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.buttons = [...this.querySelectorAll('button[data-season]')];
    this.addEventListener('click', event => {
      const button = event.target.closest('button[data-season]');
      if (this.buttons.includes(button)) this.selectSeason(button);
    }, { signal });
    this.addEventListener('keydown', event => {
      const index = this.buttons.indexOf(event.target);
      if (index < 0) return;
      const next = { ArrowRight: (index + 1) % this.buttons.length, ArrowLeft: (index + this.buttons.length - 1) % this.buttons.length, Home: 0, End: this.buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      this.buttons[next].focus();
      this.selectSeason(this.buttons[next]);
    }, { signal });
    // Once the first scene is up, load the other seasons while idle so switching does not wait on the network.
    this.addEventListener('minecraft-ready', event => {
      const assetBase = resolveAssetBase(event.target.getAttribute('asset-base'));
      const idle = globalThis.requestIdleCallback ?? (callback => setTimeout(callback, 200));
      idle(() => { for (const button of this.buttons) prefetchSeason(button.dataset.season, assetBase); });
    }, { signal, once: true });
  }

  disconnectedCallback() { this.controller?.abort(); }

  selectSeason(button) {
    const world = this.querySelector('minecraft-widget');
    if (!world) return;
    world.audio?.unlock();
    if (button.getAttribute('aria-pressed') === 'true') return;
    // The widget keeps showing the current season until the next one is ready.
    world.setAttribute('season', button.dataset.season);
    for (const option of this.buttons) option.setAttribute('aria-pressed', String(option === button));
  }
}

if (!customElements.get('minecraft-season-picker')) customElements.define('minecraft-season-picker', MinecraftSeasonPicker);
