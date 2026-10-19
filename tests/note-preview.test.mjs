import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToHast } from 'satteri';
import { notePreview } from '../src/lib/note-preview.ts';

function tree(html) {
  return htmlToHast(html, { fragment: true });
}

function elements(node, tagName) {
  const found = node.type === 'element' && (!tagName || node.tagName === tagName) ? [node] : [];
  return found.concat((node.children ?? []).flatMap(child => elements(child, tagName)));
}

function text(node) {
  return node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
}

test('note previews keep rendered Markdown structure, emphasis, code, tables and images', () => {
  const result = notePreview(`
    <h2 id="section">一个小标题</h2>
    <p>正文里的<strong>重点</strong>、<em>强调</em>、<del>删去</del>和<code>&lt;tag&gt;</code>。</p>
    <ol start="3"><li>第三步</li><li>第四步</li></ol>
    <ul><li>一级<ul><li>二级</li></ul></li></ul>
    <blockquote><p>引用中的<strong>重点</strong>。</p></blockquote>
    <pre class="astro-code"><code><span style="color:#D5836D">const</span> value = &quot;&lt;hello&gt;&quot;;\n</code></pre>
    <table><thead><tr><th>名称</th><th>数量</th></tr></thead><tbody><tr><td>图片</td><td>2</td></tr></tbody></table>
    <p><img src="/uploads/example.webp" alt="一张照片"></p>
  `, 'rendered-note', '排版');
  const parsed = tree(result.html);
  assert.deepEqual(parsed.children.filter(node => node.type === 'element').map(node => node.tagName),
    ['h2', 'p', 'ol', 'ul', 'blockquote', 'pre', 'table', 'p']);
  assert.equal(text(elements(parsed, 'h2')[0]), '一个小标题');
  assert.deepEqual(elements(parsed, 'strong').map(text), ['重点', '重点']);
  assert.equal(text(elements(parsed, 'em')[0]), '强调');
  assert.equal(text(elements(parsed, 'del')[0]), '删去');
  assert.equal(text(elements(parsed, 'code')[0]), '<tag>');
  assert.equal(text(elements(parsed, 'pre')[0]), 'const value = "<hello>";\n');
  assert.equal(elements(parsed, 'ol')[0].properties.start, 3);
  assert.equal(elements(elements(parsed, 'ul')[0], 'ul').length, 2);
  assert.deepEqual(elements(parsed, 'th').map(text), ['名称', '数量']);
  assert.deepEqual(elements(parsed, 'td').map(text), ['图片', '2']);
  assert.equal(elements(parsed, 'img')[0].properties.src, '/uploads/example.webp');
  assert.equal(elements(parsed, 'img')[0].properties.alt, '一张照片');
});

test('long text is bounded without splitting emoji or emitting broken markup', () => {
  const content = '正文🌱'.repeat(900);
  const parsed = tree(notePreview(`<p><strong>${content}</strong></p><p>不应进入预览的结尾</p>`, 'long-note', '长文').html);
  const visible = text(parsed);
  assert.ok(Array.from(visible).length <= 1601, 'text budget plus at most one truncation mark');
  assert.ok(Array.from(visible).length >= 1500, 'the preview should use the available text budget');
  assert.ok(visible.startsWith('正文🌱正文🌱'));
  assert.ok(!visible.includes('不应进入预览的结尾'));
  assert.ok(!visible.includes('\uFFFD'));
  assert.equal(elements(parsed, 'strong').length, 1);
  assert.equal(elements(parsed, 'p').length, 1);
});

test('many short blocks stop at the preview boundary while preserving document order', () => {
  const paragraphs = Array.from({ length: 30 }, (_, index) => `<p>第 ${index + 1} 段</p>`).join('\n');
  const parsed = tree(notePreview(paragraphs, 'many-blocks', '分段').html);
  const displayed = parsed.children.filter(node => node.type === 'element');
  assert.ok(displayed.length > 1 && displayed.length <= 14);
  assert.deepEqual(displayed.map(text), Array.from({ length: displayed.length }, (_, index) => `第 ${index + 1} 段`));
  assert.ok(!text(parsed).includes('第 30 段'));
});

test('the preview stays passive inside its card link and drops embedded controls and footnotes', () => {
  const parsed = tree(notePreview(`
    <h2 id="same-heading" onclick="alert(1)">标题</h2>
    <p tabindex="0"><a href="https://example.com" target="_blank" id="same-link">链接里的<strong>重点</strong></a></p>
    <p><a href="javascript:alert(1)">保留链接文字</a><span style="position:fixed;background:url(https://example.com/tracker)">正常文字</span></p>
    <ul><li class="task-list-item"><input type="checkbox" checked disabled>完成</li><li class="task-list-item"><input type="checkbox" disabled>未完成</li></ul>
    <script>隐藏脚本</script><style>隐藏样式</style>
    <form action="https://example.com"><p>隐藏表单</p><input name="secret"></form>
    <iframe src="https://example.com">隐藏框架</iframe>
    <button>隐藏按钮</button><textarea>隐藏输入</textarea>
    <section data-footnotes class="footnotes"><h2 id="footnote-label">隐藏脚注</h2><ol><li id="note-1">脚注正文</li></ol></section>
    <p>最后一段</p>
  `, 'passive-note', '预览').html);
  const nodes = elements(parsed);
  const interactive = new Set(['a', 'input', 'button', 'textarea', 'select', 'form', 'iframe', 'script', 'style']);
  assert.ok(nodes.every(node => !interactive.has(node.tagName)));
  for (const node of nodes) {
    for (const property of Object.keys(node.properties)) {
      assert.ok(!['id', 'name', 'href', 'tabindex', 'contenteditable'].includes(property.toLowerCase()), property);
      assert.ok(!property.toLowerCase().startsWith('on'), property);
    }
    assert.notEqual(node.properties.style, 'position:fixed;background:url(https://example.com/tracker)');
  }
  assert.ok(text(parsed).includes('链接里的重点'));
  assert.ok(text(parsed).includes('保留链接文字正常文字'));
  assert.ok(text(parsed).includes('完成未完成'));
  assert.ok(text(parsed).endsWith('最后一段'));
  for (const hidden of ['隐藏脚本', '隐藏样式', '隐藏表单', '隐藏框架', '隐藏按钮', '隐藏输入', '隐藏脚注', '脚注正文']) {
    assert.ok(!text(parsed).includes(hidden), hidden);
  }
  const taskMarks = elements(parsed, 'li').map(item => elements(item, 'span')[0]);
  assert.ok(taskMarks.every(mark => mark && mark.properties.ariaHidden === 'true'));
  assert.notDeepEqual(taskMarks[0].properties, taskMarks[1].properties, 'checked and unchecked tasks remain distinguishable');
});

test('image previews retain usable media and reject executable or local development sources', () => {
  const sources = ['javascript:alert(1)', 'data:image/svg+xml,bad', 'file:///private/photo.png', '//example.com/image.png', '/@fs/private/photo.png'];
  const input = sources.map(src => `<img src="${src}" alt="不应加载">`).join('')
    + '<p><img src="/uploads/first.webp" alt="本地照片" onerror="alert(1)"></p>'
    + '<p><img src="https://images.example.com/second.webp" alt="外链照片"></p>';
  const images = elements(tree(notePreview(input, 'images-note', '图片').html), 'img');
  assert.deepEqual(images.map(image => image.properties.src), ['/uploads/first.webp', 'https://images.example.com/second.webp']);
  assert.deepEqual(images.map(image => image.properties.alt), ['本地照片', '外链照片']);
  assert.ok(images.every(image => image.properties.loading === 'lazy'));
  assert.ok(images.every(image => !Object.keys(image.properties).some(property => property.toLowerCase().startsWith('on'))));
});

test('image previews keep the site\'s own variants but no other srcset candidates', () => {
  const variants = '/_uploads/480/wide.png.webp 480w, /_uploads/960/wide.png.webp 960w, /uploads/wide.png 1000w';
  const input = `<p><img src="/uploads/wide.png" alt="变体" srcset="${variants}" sizes="(max-width: 687px) 100vw, 640px" width="1000" height="400"></p>`
    + '<p><img src="/uploads/other.png" alt="外部候选" srcset="https://tracker.example.com/pixel.png 480w, /uploads/other.png 1000w" sizes="100vw"></p>';
  const [kept, dropped] = elements(tree(notePreview(input, 'variant-note', '变体').html), 'img').map(image => image.properties);
  assert.equal(kept.srcSet, variants);
  assert.equal(kept.sizes, '(max-width: 540px) 72vw, 400px', 'previews size images for the open note card, not the article column');
  assert.equal(dropped.src, '/uploads/other.png');
  assert.equal(dropped.srcSet, undefined);
  assert.equal(dropped.sizes, undefined);
});

test('short notes remain full sheets, longer notes get more room, and stable URLs keep their shape', () => {
  const longHtml = `<p>${'一段完整的正文。'.repeat(100)}</p>`;
  const geometries = new Set();
  for (let index = 0; index < 12; index++) {
    const id = `stable-note-${index}`;
    const empty = notePreview('', id, '标题');
    const short = notePreview('<p>只有一句正文。</p>', id, '标题');
    const long = notePreview(longHtml, id, '标题');
    const renamed = notePreview(longHtml, id, '修改后的标题');
    for (const result of [empty, short, long]) {
      assert.ok(result.width >= 20 && result.width <= 50, 'paper width stays proportionate to the folder');
      assert.ok(result.top >= 0 && result.top <= 20, 'insertion depth stays within the folder');
      assert.ok(result.ratio >= .5 && result.ratio <= .95, 'every note remains a portrait sheet');
    }
    assert.ok(short.ratio >= .75, 'a short note does not leave an excessively tall blank paper');
    assert.equal(empty.ratio, short.ratio, 'an empty note still has the minimum paper size');
    assert.ok(long.ratio < short.ratio, 'a longer note has a taller paper at the same width');
    assert.deepEqual([renamed.width, renamed.top, renamed.ratio], [long.width, long.top, long.ratio]);
    assert.deepEqual(notePreview(longHtml, id, '标题'), long);
    geometries.add(`${long.width}:${long.top}:${long.ratio}`);
  }
  assert.ok(geometries.size > 1, 'different fixed URLs vary the paper arrangement');
});

test('structured Markdown gets room even when its word count is low', () => {
  const plain = notePreview('<p>少量文字</p>', 'structured-note', '排版');
  const structured = notePreview('<h2>代码</h2><pre><code>let a = 1;</code></pre><ul><li>一项</li><li>二项</li></ul><table><tbody><tr><td>甲</td></tr><tr><td>乙</td></tr><tr><td>丙</td></tr></tbody></table>', 'structured-note', '排版');
  assert.ok(structured.ratio < plain.ratio, 'lists, code and table rows need more vertical room than plain text');
});
