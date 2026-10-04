import * as THREE from 'three';
import { createGeneratedItemGeometry } from './generated-item-geometry.mjs';

export class MinecraftSeasonItems extends HTMLElement {
  generation = 0;
  resources = new Set();
  items = [];

  connectedCallback() {
    this.dispose();
    const generation = ++this.generation;
    const buttons = [...this.querySelectorAll('button[data-season]')];
    if (!buttons.length) return;
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.elapsed = 0;
    this.visible = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', () => this.schedule(), { signal });
    document.addEventListener('visibilitychange', () => this.schedule(), { signal });
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersection.observe(this);
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.schedule();
    });
    this.resizeObserver.observe(this);
    for (const button of buttons) this.resizeObserver.observe(button);
    this.selectionObserver = new MutationObserver(() => this.schedule());
    for (const button of buttons) this.selectionObserver.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
    void this.initialize(buttons, generation);
  }

  async initialize(buttons, generation) {
    try {
      const loader = new THREE.TextureLoader();
      const items = await Promise.all(buttons.map(async (button, index) => {
        const image = button.querySelector('img');
        if (!image?.src) throw new Error('Missing item image');
        const texture = await loader.loadAsync(image.currentSrc || image.src);
        if (generation !== this.generation || !this.isConnected) {
          texture.dispose();
          return null;
        }
        this.resources.add(texture);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        const canvas = document.createElement('canvas');
        canvas.width = texture.image.width;
        canvas.height = texture.image.height;
        const context = canvas.getContext('2d');
        context.drawImage(texture.image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const geometry = createGeneratedItemGeometry(pixels, canvas.width, canvas.height);
        const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: .1 });
        this.resources.add(geometry);
        this.resources.add(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.setScalar(30);
        return {
          button, image, mesh, phase: index * .9,
          hovered: false, pressed: false, lift: 0, scale: 1, clickTime: null,
          visibility: image.style.getPropertyValue('visibility'),
          visibilityPriority: image.style.getPropertyPriority('visibility'),
        };
      }));
      if (generation !== this.generation || !this.isConnected) return;
      this.items = items;
      this.bindFeedback();
      this.scene = new THREE.Scene();
      this.scene.add(...items.map(item => item.mesh));
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 1000);
      this.camera.position.z = 100;
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setClearColor(0, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      const canvas = this.renderer.domElement;
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '2',
      });
      canvas.addEventListener('webglcontextlost', () => this.dispose(), { signal: this.controller.signal });
      this.append(canvas);
      this.ready = true;
      this.resize();
      this.schedule();
    } catch {
      if (generation === this.generation) this.dispose();
    }
  }

  bindFeedback() {
    const { signal } = this.controller;
    const release = () => {
      for (const item of this.items) item.pressed = false;
      this.schedule();
    };
    window.addEventListener('pointerup', release, { signal });
    window.addEventListener('pointercancel', release, { signal });
    window.addEventListener('blur', release, { signal });
    for (const item of this.items) {
      const on = (type, listener) => item.button.addEventListener(type, listener, { signal });
      on('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        item.hovered = true;
        this.schedule();
      });
      on('pointerleave', () => {
        item.hovered = item.pressed = false;
        this.schedule();
      });
      on('pointerdown', event => {
        if (event.button !== 0) return;
        item.pressed = true;
        this.schedule();
      });
      on('focus', () => this.schedule());
      on('blur', () => {
        item.pressed = false;
        this.schedule();
      });
      on('keydown', event => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        item.pressed = true;
        this.schedule();
      });
      on('keyup', event => {
        if (event.key === ' ' || event.key === 'Enter') release();
      });
      on('click', () => {
        item.pressed = false;
        item.clickTime = this.motion.matches ? null : this.elapsed;
        this.schedule();
      });
    }
  }

  resize() {
    if (!this.ready) return;
    const bounds = this.getBoundingClientRect();
    this.hasSize = bounds.width > 0 && bounds.height > 0;
    if (!this.hasSize) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(bounds.width, bounds.height, false);
    Object.assign(this.camera, {
      left: -bounds.width / 2, right: bounds.width / 2,
      top: bounds.height / 2, bottom: -bounds.height / 2,
    });
    this.camera.updateProjectionMatrix();
    for (const item of this.items) {
      const button = item.button.getBoundingClientRect();
      item.x = button.left + button.width / 2 - bounds.left - bounds.width / 2;
      item.y = bounds.height / 2 - (button.top + button.height / 2 - bounds.top);
    }
  }

  schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.previousTime = undefined;
    if (this.ready && this.hasSize && this.visible && !document.hidden && this.isConnected) {
      this.frame = requestAnimationFrame(now => this.draw(now));
    }
  }

  draw(now) {
    this.frame = null;
    if (!this.ready || !this.hasSize || !this.visible || document.hidden || !this.isConnected) return;
    const delta = this.previousTime === undefined ? 16 : Math.min(now - this.previousTime, 100);
    if (!this.motion.matches && this.previousTime !== undefined) {
      this.elapsed += delta;
    }
    this.previousTime = now;
    for (const item of this.items) {
      const selected = item.button.getAttribute('aria-pressed') === 'true';
      const reduced = this.motion.matches;
      const active = item.hovered || item.button.matches(':focus-visible');
      const lift = item.pressed ? -1 : active ? (reduced ? 1 : 6) : 0;
      const scale = item.pressed ? .94 : active ? (reduced ? 1.05 : 1.1) : 1;
      const blend = reduced ? 1 : 1 - Math.exp(-delta / 65);
      item.lift += (lift - item.lift) * blend;
      item.scale += (scale - item.scale) * blend;
      const progress = item.clickTime === null ? 1 : (this.elapsed - item.clickTime) / 280;
      const hop = reduced || progress >= 1 ? 0 : Math.sin(progress * Math.PI);
      if (reduced || progress >= 1) item.clickTime = null;
      const bob = reduced ? 0 : Math.sin(this.elapsed / 700 + item.phase) * 2;
      item.mesh.position.set(item.x, item.y + bob + item.lift + hop * 8 + (selected ? 2 : 0), 0);
      item.mesh.scale.setScalar((selected ? 31.8 : 30) * item.scale);
      item.mesh.rotation.y = reduced ? .3 : .3 + item.phase + this.elapsed / 1800 + hop * .18;
    }
    this.renderer.render(this.scene, this.camera);
    for (const item of this.items) item.image.style.visibility = 'hidden';
    if (!this.motion.matches) this.frame = requestAnimationFrame(time => this.draw(time));
  }

  disconnectedCallback() { this.dispose(); }

  dispose() {
    ++this.generation;
    this.ready = false;
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.controller?.abort();
    this.intersection?.disconnect();
    this.resizeObserver?.disconnect();
    this.selectionObserver?.disconnect();
    for (const item of this.items) {
      if (item.visibility) item.image.style.setProperty('visibility', item.visibility, item.visibilityPriority);
      else item.image.style.removeProperty('visibility');
    }
    this.items = [];
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.scene?.clear();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }
}

if (!customElements.get('minecraft-season-items')) customElements.define('minecraft-season-items', MinecraftSeasonItems);
