const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../dist");
assert.ok(fs.existsSync(path.join(projectRoot, "index.html")), "Build the site before testing: npm run build");
const siteOrigin = "https://local.test";

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:html|css)$/i.test(entry.name) ? [filename] : [];
  });
}

function htmlAttributes(source, attribute) {
  const values = [];
  const expression = new RegExp(`\\s(?:${attribute})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`, "gi");
  for (const tag of source.matchAll(/<[a-z][^>]*>/gi)) {
    for (const match of tag[0].matchAll(expression)) {
      values.push((match[1] ?? match[2] ?? match[3]).replaceAll("&amp;", "&"));
    }
  }
  return values;
}

function cssUrls(source) {
  return Array.from(
    source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi),
    (match) => (match[1] ?? match[2] ?? match[3]).trim(),
  );
}

function readSource(filename) {
  return fs.readFileSync(filename, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function checkReference(filename, reference, checkFragment) {
  const value = reference.trim();
  assert.notEqual(value, "#", `Placeholder link in ${filename}`);
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return;
  if (!checkFragment && value.startsWith("#")) return;

  // Resolve CSS assets against their own stylesheet, just as the browser does.
  const sourcePath = path.relative(projectRoot, filename).split(path.sep).join("/");
  const url = new URL(value, `${siteOrigin}/${sourcePath}`);
  let target = path.join(projectRoot, decodeURIComponent(url.pathname));
  const description = `${sourcePath}: ${reference}`;
  assert.ok(fs.existsSync(target), `Missing local reference: ${description}`);
  if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `Missing local file: ${description}`);

  if (checkFragment && url.hash && /\.html$/i.test(target)) {
    const id = decodeURIComponent(url.hash.slice(1));
    const ids = htmlAttributes(readSource(target), "id");
    assert.ok(ids.includes(id), `Missing HTML anchor #${id}: ${description}`);
  }
}

for (const filename of sourceFiles(projectRoot)) {
  test(`local references in ${path.relative(projectRoot, filename)}`, () => {
    const source = readSource(filename);
    const isHtml = /\.html$/i.test(filename);
    if (isHtml) {
      for (const reference of htmlAttributes(source, "src|href")) {
        checkReference(filename, reference, true);
      }
      // Image variants only exist when the build generated every candidate a page offers.
      for (const srcset of htmlAttributes(source, "srcset")) {
        for (const candidate of srcset.split(",")) {
          checkReference(filename, candidate.trim().split(/\s+/)[0], false);
        }
      }
    }
    const cssSource = isHtml ? source.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&') : source;
    for (const reference of cssUrls(cssSource)) {
      checkReference(filename, reference, false);
    }
  });
}
