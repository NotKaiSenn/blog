let renderer: Promise<typeof import('mermaid')['default']> | undefined;
let diagramId = 0;
const pending = new WeakSet<Element>();

async function renderDiagrams() {
  const blocks = [...document.querySelectorAll<HTMLElement>('.prose pre:has(> code.language-mermaid)')]
    .filter(block => !pending.has(block));
  if (!blocks.length) return;
  blocks.forEach(block => pending.add(block));
  try {
    renderer ??= import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'system-ui, sans-serif', suppressErrorRendering: true });
      return mermaid;
    });
    const mermaid = await renderer;
    for (const block of blocks) {
      if (!block.isConnected) continue;
      try {
        const { svg } = await mermaid.render(`note-diagram-${++diagramId}`, block.textContent ?? '');
        if (!block.isConnected) continue;
        const figure = document.createElement('figure');
        figure.className = 'note-diagram';
        figure.setAttribute('aria-label', '图表');
        figure.innerHTML = svg;
        block.replaceWith(figure);
      } catch {
        // Invalid diagrams remain readable source, without interrupting the rest of the note.
        block.setAttribute('aria-label', '图表源码（未能渲染）');
      }
    }
  } catch {
    renderer = undefined;
    blocks.forEach(block => pending.delete(block));
  }
}

document.addEventListener('astro:page-load', renderDiagrams);
void renderDiagrams();
