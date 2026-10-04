import './minecraft-widget.mjs';

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
  }

  disconnectedCallback() { this.controller?.abort(); }

  selectSeason(button) {
    const current = this.querySelector('minecraft-widget');
    if (!current) return;
    if (button.getAttribute('aria-pressed') === 'true') {
      current.audio?.unlock();
      return;
    }
    const season = button.dataset.season;
    const world = current.cloneNode(false);
    world.setAttribute('season', season);
    current.replaceWith(world);
    world.audio?.unlock();
    for (const option of this.buttons) option.setAttribute('aria-pressed', String(option === button));
  }
}

if (!customElements.get('minecraft-season-picker')) customElements.define('minecraft-season-picker', MinecraftSeasonPicker);
