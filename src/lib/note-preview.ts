import { htmlToHast, type HastNode } from 'satteri';
import { toHtml } from 'hast-util-to-html';

type Element = Extract<HastNode, { type: 'element' }>;
const tags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'del', 's', 'code', 'pre', 'hr', 'br', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'span']);
const omitted = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'svg', 'math']);
const structureSpace: Record<string, number> = { h1: 30, h2: 30, h3: 30, h4: 30, h5: 30, h6: 30, li: 20, tr: 60, pre: 80, blockquote: 20 };
const shapes = [
  { width: 33, top: 3, ratio: 3 / 4.6 },
  { width: 36, top: 10, ratio: 3 / 3.8 },
  { width: 32, top: 1, ratio: 3 / 5 },
  { width: 35, top: 12, ratio: 3 / 4.2 },
];

export function notePreview(html: string, id: string, title: string) {
  const tree = htmlToHast(html, { fragment: true });
  let remaining = 1600;
  let images = 0;
  let blocks = 0;
  let structure = 0;

  function clean(node: HastNode): Element['children'] {
    if (remaining <= 0) return [];
    if (node.type === 'text') {
      const characters = Array.from(node.value);
      const value = characters.slice(0, remaining).join('');
      remaining -= characters.length;
      return [{ type: 'text', value: value + (remaining < 0 ? '…' : '') }];
    }
    if (node.type !== 'element') return [];
    const classes = Array.isArray(node.properties.className) ? node.properties.className : [];
    // KaTeX contains both visual and accessible trees; keep one source in the small preview.
    if (classes.includes('katex')) {
      function tex(child: HastNode): string {
        if (child.type !== 'element') return '';
        if (child.tagName === 'annotation' && child.properties.encoding === 'application/x-tex') {
          return child.children.filter(item => item.type === 'text').map(item => item.value).join('');
        }
        return child.children.map(tex).join('');
      }
      return clean({ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: tex(node) }] });
    }
    if (node.tagName === 'pre' && node.children.some(child => child.type === 'element' && Array.isArray(child.properties.className) && child.properties.className.includes('language-mermaid'))) {
      return clean({ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: '图表' }] });
    }
    if (omitted.has(node.tagName) || classes.includes('footnotes')) return [];
    if (node.tagName === 'input') {
      if (node.properties.type !== 'checkbox') return [];
      return [{ type: 'element', tagName: 'span', properties: { className: ['preview-task', ...(node.properties.checked ? ['is-checked'] : [])], ariaHidden: 'true' }, children: [] }];
    }

    const children = node.children.flatMap(clean);
    if (node.tagName === 'a') {
      return [{ type: 'element', tagName: 'span', properties: { className: ['preview-link'] }, children }];
    }
    if (!tags.has(node.tagName)) return children;
    const properties: Element['properties'] = {};
    if (node.tagName === 'img') {
      const src = String(node.properties.src ?? '');
      if (!/^(?:\/(?!\/)|https:\/\/)/.test(src) || src.startsWith('/@')) return [];
      if (images >= 2) return [];
      images++;
      Object.assign(properties, { src, alt: String(node.properties.alt ?? ''), loading: 'lazy', decoding: 'async' });
    }
    if (node.tagName === 'ol' && typeof node.properties.start === 'number') properties.start = node.properties.start;
    if (node.tagName === 'li' && classes.includes('task-list-item')) properties.className = ['task-list-item'];
    // Keep Shiki token colors without copying arbitrary styles, IDs or interactions to the homepage.
    if (node.tagName === 'span' && /^color:#[\da-f]{3,8};?$/i.test(String(node.properties.style))) properties.style = node.properties.style;
    if (!children.length && !['img', 'hr', 'br'].includes(node.tagName)) return [];
    structure += structureSpace[node.tagName] ?? 0;
    return [{ type: 'element', tagName: node.tagName, properties, children }];
  }

  const children: Element['children'] = [];
  if (tree.type === 'root') {
    for (const node of tree.children) {
      if (node.type === 'text' && !node.value.trim()) continue;
      if (blocks >= 14 || remaining <= 0) break;
      const cleaned = clean(node);
      if (cleaned.length) {
        children.push(...cleaned);
        blocks++;
      }
    }
  }
  const seed = Array.from(id).reduce((hash, character) => (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0, 0);
  const shape = shapes[seed % shapes.length];
  const amount = 1600 - remaining + blocks * 24 + images * 180 + structure + title.length * 2;
  // Short notes keep a full sheet and breathing room. Longer previews use the original tall papers.
  const ratio = amount < 260 ? .80 + (seed % 4) * .02 : amount < 650 ? Math.max(.72, shape.ratio) : shape.ratio;
  return { html: toHtml({ type: 'root', children }), ...shape, ratio };
}
