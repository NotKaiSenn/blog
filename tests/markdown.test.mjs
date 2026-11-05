import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import config from '../astro.config.mjs';
import { notePreview } from '../src/lib/note-preview.ts';

const processor = await createMarkdownProcessor({ ...config.markdown, ...config.markdown.processor.options });

test('math, GitHub alerts and existing GFM render together', async () => {
  const { code } = await processor.render(String.raw`
Inline $x^2 + y^2$.

$$
\frac{1}{2} + \sqrt{x}
$$

> [!NOTE]
> A **useful** note.

> [!TIP]
> A tip.

> [!IMPORTANT]
> Important.

> [!WARNING]
> Warning.

> [!CAUTION]
> Caution.

- [x] done

~~removed~~

| A | B |
| - | - |
| 1 | 2 |

Footnote[^1].

[^1]: Footnote text.
`);
  assert.match(code, /class="katex"/);
  assert.match(code, /class="katex-display"/);
  assert.match(code, /<math\b/);
  for (const type of ['note', 'tip', 'important', 'warning', 'caution']) assert.match(code, new RegExp(`markdown-alert-${type}`));
  for (const pattern of [/<strong>useful<\/strong>/, /type="checkbox"/, /<del>removed<\/del>/, /<table>/, /data-footnotes/]) assert.match(code, pattern);
  const preview = notePreview(code, 'math-note', 'Math').html;
  assert.equal((preview.match(/x\^2 \+ y\^2/g) ?? []).length, 1);
  assert.doesNotMatch(preview, /katex|<math|<svg|<annotation/);
  assert.match(preview, /useful/);
});

test('Mermaid keeps source for progressive rendering, while code still highlights', async () => {
  const { code } = await processor.render('```mermaid\ngraph LR\n  A[开始] --> B[结束]\n```\n\n```js\nconst value = 1;\n```');
  assert.match(code, /<code class="language-mermaid">graph LR/);
  assert.match(code, /astro-code/);
  const preview = notePreview(code, 'diagram', 'Diagram').html;
  assert.match(preview, /图表/);
  assert.doesNotMatch(preview, /graph LR/);
});

test('invalid or untrusted TeX cannot add active links or stop publication', async () => {
  const { code } = await processor.render(String.raw`$\unknowncommand{x}$ and $\href{javascript:alert(1)}{click}$`);
  assert.match(code, /unknowncommand/);
  assert.doesNotMatch(code, /href="javascript:|<script\b/);
});

test('bold closes after Chinese punctuation, as Chinese writing places it', async () => {
  const { code } = await processor.render('**人们想要“设计感”，却不在乎设计本身。**虽然有点爹味。\n\n**这就是我们想要的世界吗？**\n\n中文**加粗**中文，English **bold** stays.');
  assert.match(code, /<strong>人们想要“设计感”，却不在乎设计本身。<\/strong>虽然/);
  assert.match(code, /<strong>这就是我们想要的世界吗？<\/strong>/);
  assert.match(code, /中文<strong>加粗<\/strong>中文/);
  assert.match(code, /English <strong>bold<\/strong> stays/);
  assert.doesNotMatch(code, /\*\*/, 'no asterisks are left showing');
});
