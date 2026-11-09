import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setMaxListeners } from 'node:events';
import ts from 'typescript';
import { gridPoses, stagePoses } from '../../src/lib/folder-poses.ts';
import { EASE_SETTLE } from '../../src/scripts/motion.ts';

const script = ts.transpileModule(readFileSync(new URL('../../src/scripts/folder-gallery.ts', import.meta.url), 'utf8')
  .replace(/^import .*?;\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

export function galleryBrowser({ count = 3, decorationCount = 0, reducedMotion = false, showModalFails = false, tiled = false } = {}) {
  const animations = new Set();
  const styleReads = [];
  const closeEvents = [];
  let now = 0;
  let document;
  const style = () => {
    const values = new Map();
    return new Proxy({}, {
      get(_, name) {
        if (name === 'cssText') return [...values].map(([key, value]) => `${key}:${value}`).join(';');
        if (name === 'setProperty') return (key, value) => values.set(key, String(value));
        if (name === 'getPropertyValue') return key => values.get(key) ?? '';
        if (name === 'removeProperty') return key => values.delete(key);
        return values.get(name) ?? '';
      },
      set(_, name, value) {
        if (name === 'cssText') {
          values.clear();
          for (const declaration of value.split(';')) {
            const colon = declaration.indexOf(':');
            if (colon !== -1) values.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
          }
        } else if (value === '') values.delete(name);
        else values.set(name, String(value));
        return true;
      },
    });
  };

  class Element {
    constructor(className = '') {
      this.className = className;
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.listeners = new Map();
      this.style = style();
      this.parentNode = null;
      this.inert = false;
      this.open = false;
      this.offsetWidth = 108;
      this.offsetHeight = 166;
      this.clientWidth = 320;
      this.clientHeight = 166;
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.target = '';
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
        toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name),
      };
    }
    set tabIndex(value) { this.setAttribute('tabindex', String(value)); }
    get tabIndex() { return Number(this.attributes.get('tabindex') ?? (this.href ? 0 : -1)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    matches(selector) {
      if (selector === ':focus-visible') return true;
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return !!match && this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]);
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    append(child) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      child.parentNode = this;
      this.children.push(child);
    }
    before(child) {
      child.parentNode = this.parentNode;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, child);
    }
    replaceWith(child) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      const parent = this.parentNode;
      parent.children.splice(parent.children.indexOf(this), 1, child);
      child.parentNode = parent;
      this.parentNode = null;
    }
    getBoundingClientRect() { return { left: 20, top: 120, width: this.offsetWidth, height: this.offsetHeight }; }
    scrollTo(options, y) {
      this.scrollLeft = typeof options === 'number' ? options : options.left ?? this.scrollLeft;
      this.scrollTop = typeof options === 'number' ? y : options.top ?? this.scrollTop;
    }
    addEventListener(type, callback, options = {}) {
      if (options.signal?.aborted) return;
      const handlers = this.listeners.get(type) ?? [];
      handlers.push({ callback, capture: options.capture ?? false });
      this.listeners.set(type, handlers);
      options.signal?.addEventListener('abort', () => this.removeEventListener(type, callback, options), { once: true });
    }
    removeEventListener(type, callback, options = {}) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(handler =>
        handler.callback !== callback || handler.capture !== (options.capture ?? false)));
    }
    emit(type, values = {}) {
      const event = {
        type, target: this, button: 0, detail: type === 'click' ? 1 : 0, isPrimary: true, pointerId: 1,
        clientX: 20, clientY: 20, pointerType: 'mouse', defaultPrevented: false, stopped: false,
        deltaX: 0, deltaY: 0, deltaMode: 0, cancelable: true,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values,
      };
      const path = [];
      for (let element = this; element; element = element.parentNode) path.push(element);
      const dispatch = (element, capture) => {
        for (const handler of element.listeners.get(type) ?? []) {
          if (handler.capture === capture) handler.callback(event);
        }
      };
      for (const element of [...path].reverse()) { dispatch(element, true); if (event.stopped) return event; }
      for (const element of path) { dispatch(element, false); if (event.stopped) break; }
      return event;
    }
    focus() {
      if (document.activeElement === this) return;
      document.activeElement?.emit('blur');
      document.activeElement = this;
      this.emit('focus');
    }
    showModal() {
      if (showModalFails) throw new Error('Dialog unavailable');
      this.open = true;
      this.querySelector('[data-gallery-close]').focus();
    }
    close() {
      this.open = false;
      closeEvents.push(() => this.emit('close'));
    }
    animate(frames, options) {
      let resolve;
      let reject;
      const animation = {
        owner: this, frames, options,
        finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
        finish() { animations.delete(animation); resolve(); },
        cancel() { animations.delete(animation); reject(new Error('Animation canceled')); },
      };
      animations.add(animation);
      return animation;
    }
  }

  document = new Element();
  document.documentElement = new Element();
  document.createElement = () => new Element();
  const folder = new Element('folder');
  const wrap = new Element('folder-object');
  const home = new Element('folder-items');
  home.inert = true;
  const flap = new Element('folder-flap');
  const opener = new Element();
  opener.setAttribute('data-folder-open', 'test-gallery');
  opener.href = '/posts/';
  document.append(folder);
  folder.append(wrap);
  for (const child of [home, flap, opener]) wrap.append(child);
  const cards = Array.from({ length: count }, (_, index) => {
    const card = new Element('folder-item');
    card.dataset = { kind: tiled ? 'photo' : 'note', cardWidth: '34', href: `/posts/note-${index}/`, title: `笔记 ${index}` };
    card.style.cssText = `--card-width:34%;--card-ratio:0.65;z-index:${count - index}`;
    const content = new Element('card-content');
    content.href = card.dataset.href;
    const picker = new Element('card-picker');
    picker.tabIndex = -1;
    card.append(content);
    card.append(picker);
    home.append(card);
    return card;
  });
  const decorations = Array.from({ length: decorationCount }, (_, index) => {
    const decoration = new Element('folder-decoration');
    decoration.dataset.decorIndex = String(index);
    decoration.style.cssText = `--decor-x:${index ? 9 : -9}%;--decor-turn:${index ? 5 : -5}deg;z-index:${index + 1}`;
    home.append(decoration);
    return decoration;
  });
  const dialog = new Element('folder-stage');
  dialog.id = 'test-gallery';
  const stage = new Element('stage-cards');
  const viewport = new Element('stage-viewport');
  viewport.offsetWidth = viewport.clientWidth = 900;
  viewport.offsetHeight = viewport.clientHeight = 740;
  const empty = new Element('stage-empty');
  viewport.append(stage);
  dialog.append(viewport);
  dialog.append(empty);
  document.append(dialog);
  const footer = new Element('stage-footer');
  dialog.append(footer);
  const controls = Object.fromEntries(['prev', 'next', 'count', 'close'].map(name => {
    const element = new Element();
    element.setAttribute(`data-gallery-${name}`, '');
    (name === 'close' ? dialog : footer).append(element);
    return [name, element];
  }));
  const views = tiled ? Object.fromEntries(['stack', 'grid'].map(name => {
    const element = new Element();
    element.setAttribute('data-gallery-view', name);
    element.dataset.galleryView = name;
    element.setAttribute('aria-pressed', String(name === 'stack'));
    dialog.append(element);
    return [name, element];
  })) : {};
  const reduced = new Element();
  reduced.matches = reducedMotion;
  const window = new Element();
  Object.assign(window, { innerWidth: 1280, innerHeight: 900, matchMedia: query => query.includes('reduced') ? reduced : { matches: true } });
  runInNewContext(script, {
    document, window, gridPoses, stagePoses, EASE_SETTLE, performance: { now: () => now },
    AbortController: class extends AbortController {
      constructor() { super(); setMaxListeners(0, this.signal); }
    },
    getComputedStyle: element => {
      const computed = { transform: element.style.transform || 'none', opacity: element.style.opacity || '1', getPropertyValue: name => element.style.getPropertyValue(name) };
      styleReads.push({ element, parent: element.parentNode, transform: computed.transform, opacity: computed.opacity });
      return computed;
    },
    DOMMatrix: class { a = 1; b = 0; },
  });
  return {
    document, window, dialog, stage, viewport, footer, home, flap, opener, cards, decorations, controls, views, animations, styleReads,
    advanceTime(ms) { now += ms; },
    open() { opener.focus(); return opener.emit('click'); },
    background() { stage.emit('pointerdown'); stage.emit('pointerup'); },
    closeEvents() { closeEvents.splice(0).forEach(callback => callback()); },
    leavePage() {
      document.emit('astro:before-swap');
      document.children = [];
      folder.parentNode = dialog.parentNode = null;
      document.activeElement = null;
      document.emit('astro:page-load');
    },
    returnToPage() {
      document.append(folder);
      document.append(dialog);
      document.emit('astro:page-load');
    },
    async settle() {
      for (let i = 0; i < 20; i++) {
        [...animations].forEach(animation => animation.finish());
        await Promise.resolve();
      }
    },
    setReducedMotion(value) { reduced.matches = value; reduced.emit('change'); },
  };
}
