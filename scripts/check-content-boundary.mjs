import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTENT_PATHS = [
  'src/content/posts',
  'src/data/site.json',
  'src/data/works.json',
  'src/data/photos.json',
  'src/data/friends.json',
  'src/data/things.json',
  'public/uploads',
];

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function commit(ref) {
  try {
    return git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  } catch {
    throw new Error(`无法读取基准或提交 ${ref}。请先同步远程 main，再重新检查。`);
  }
}

function check(baseRef, headRef) {
  const base = commit(baseRef);
  const head = commit(headRef);
  const ancestor = git('merge-base', base, head).trim();
  const paths = CONTENT_PATHS.map(path => `:(top,literal)${path}`);
  // The merge base avoids treating newer CMS content on main as a developer deletion.
  const currentChanges = git('diff', '--no-renames', '--name-only', '-z', ancestor, head, '--', ...paths);
  // Check intermediate commits too, even when a later commit restores the content.
  // Commits inherited from main are excluded; the diff above checks merge resolutions.
  const historyChanges = git('log', '--full-history', '--no-merges', '--format=', '--no-renames', '--name-only', '-z', `${base}..${head}`, '--', ...paths);
  const changed = [...new Set(`${currentChanges}\0${historyChanges}`.split('\0').filter(Boolean))].sort();
  if (changed.length) {
    throw new Error([
      '已拦截：开发提交包含由 Pages CMS 管理的内容。',
      ...changed.map(path => `  ${JSON.stringify(path)}`),
      '请将内容改动与框架开发分开，在 Pages CMS 中更新内容；此检查不会自动删除或恢复文件。',
    ].join('\n'));
  }
}

function prePush(remote) {
  const lines = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('无法读取推送信息，已停止推送。');
    const [, localOid, remoteRef, remoteOid] = fields;
    if (!/^[a-f0-9]{40,64}$/.test(localOid) || !/^[a-f0-9]{40,64}$/.test(remoteOid)) {
      throw new Error('推送信息中的提交无效，已停止推送。');
    }
    if (/^0+$/.test(localOid)) continue;

    if (remoteRef === 'refs/heads/main') {
      if (/^0+$/.test(remoteOid)) throw new Error('远程 main 不存在，无法确认 CMS 内容基准。');
      const base = commit(remoteOid);
      const head = commit(localOid);
      if (git('merge-base', base, head).trim() !== base) {
        throw new Error('不能回退或覆盖远程 main，以免丢失 CMS 内容。请先同步 main。');
      }
      check(base, head);
    } else {
      // Use main rather than the old dev tip, so existing dev content changes stay visible.
      check(`refs/remotes/${remote}/main`, localOid);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--pre-push' && args[1]) {
      prePush(args[1]);
    } else if (args.length === 4 && args[0] === '--base' && args[2] === '--head') {
      check(args[1], args[3]);
    } else {
      throw new Error('用法：node scripts/check-content-boundary.mjs --base <main> --head <head>');
    }
    console.log('CMS 内容检查通过。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
