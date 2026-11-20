#!/usr/bin/env node
/**
 * tessl-sync-prs.mjs — keeps open factory PRs mergeable after `main` moves.
 *
 * For every open PR whose head branch is in this repo and starts with BRANCH_PREFIX
 * (default "tessl/") and that GitHub reports as conflicting:
 *   1. merge origin/main into the branch
 *   2. auto-resolve the conflict types that parallel tickets always produce:
 *        - pnpm-lock.yaml            → take main's, then regenerate with `pnpm install --lockfile-only`
 *        - package.json (any)        → 3-way merge of scripts/dependencies/devDependencies/… key by key
 *        - barrel files (index.ts)   → union of `export … from` lines, sorted
 *   3. verify: `pnpm install --frozen-lockfile` + `pnpm -r typecheck`
 *   4. push the merge commit
 * Anything else (real code conflicts, failed verification) → no push; the PR gets the label
 * `needs-conflict-resolution` and ONE comment asking the Tessl agent to merge main and resolve.
 *
 * Env: GH_TOKEN (contents+pull-requests write), GITHUB_REPOSITORY, BRANCH_PREFIX, DRY_RUN=1
 * Runs from a checkout of main with full history (fetch-depth: 0).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY;
const PREFIX = process.env.BRANCH_PREFIX ?? 'tessl/';
const DRY = process.env.DRY_RUN === '1';
const LABEL = 'needs-conflict-resolution';
const MARK = '<!-- tessl-sync-prs -->';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20, ...opts });
const tryRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const git = (...a) => run('git', a);
const api = (method, route, body) => {
  const args = ['api', '-X', method, route];
  if (body) args.push('--input', '-');
  const out = execFileSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined });
  return out.trim() ? JSON.parse(out) : null;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ── resolvers ────────────────────────────────────────────────────────────────
const stage = (n, f) => tryRun('git', ['show', `:${n}:${f}`]); // 1 base, 2 ours (PR), 3 theirs (main)

function resolveLockfile(f) {
  git('checkout', '--theirs', '--', f);           // main's lockfile; regenerated after all files resolve
  return true;
}

function mergeMaps(base = {}, ours = {}, theirs = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const [b, o, t] = [base[k], ours[k], theirs[k]].map(v => (v === undefined ? undefined : JSON.stringify(v)));
    let pick;
    if (o === t) pick = o;
    else if (o === b) pick = t;
    else if (t === b) pick = o;
    else return null;                              // both sides changed the same key differently
    if (pick !== undefined) out[k] = JSON.parse(pick);
  }
  return out;
}

function resolvePackageJson(f) {
  const [b, o, t] = [1, 2, 3].map(n => stage(n, f));
  if (!o.ok || !t.ok) return false;
  let base, ours, theirs;
  try { base = b.ok ? JSON.parse(b.out) : {}; ours = JSON.parse(o.out); theirs = JSON.parse(t.out); }
  catch { return false; }
  const MAPS = new Set(['scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'exports', 'pnpm']);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])];
  const result = {};
  for (const k of keys) {
    let v;
    if (MAPS.has(k) && isObj(ours[k]) && isObj(theirs[k])) {
      v = mergeMaps(base[k], ours[k], theirs[k]);
      if (!v) return false;
      if (k.endsWith('ependencies')) v = Object.fromEntries(Object.entries(v).sort(([a], [z]) => a.localeCompare(z)));
    } else {
      const m = mergeMaps({ [k]: base[k] }, { [k]: ours[k] }, { [k]: theirs[k] });
      if (!m) return false;
      v = m[k];
    }
    if (v !== undefined) result[k] = v;
  }
  fs.writeFileSync(f, JSON.stringify(result, null, 2) + '\n');
  return true;
}

const EXPORT_LINE = /^\s*export\s+(type\s+)?(\*|\{[^}]*\})(\s+as\s+\w+)?\s+from\s+['"][^'"]+['"];?\s*$/;
function resolveBarrel(f) {
  const text = fs.readFileSync(f, 'utf8');
  if (!/^<<<<<<< /m.test(text)) return false;
  let ok = true;
  const out = text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)^(?:\|\|\|\|\|\|\| [^\n]*\n[\s\S]*?)?^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n/gm,
    (_, a, b) => {
      const lines = [...a.split('\n'), ...b.split('\n')].filter(l => l.trim());
      if (!lines.every(l => EXPORT_LINE.test(l))) { ok = false; return _; }
      const src = l => l.match(/from\s+['"]([^'"]+)['"]/)[1];
      return [...new Set(lines.map(l => l.trimEnd()))].sort((x, y) => src(x).localeCompare(src(y))).join('\n') + '\n';
    });
  if (!ok) return false;
  fs.writeFileSync(f, out);
  return true;
}

function resolverFor(f) {
  if (f === 'pnpm-lock.yaml') return resolveLockfile;
  if (f === 'package.json' || f.endsWith('/package.json')) return resolvePackageJson;
  if (/(^|\/)index\.(ts|tsx|js|mjs)$/.test(f)) return resolveBarrel;
  return null;
}

// ── PR handling ──────────────────────────────────────────────────────────────
async function mergeableOf(number) {
  for (let i = 0; i < 6; i++) {
    const pr = api('GET', `repos/${REPO}/pulls/${number}`);
    if (pr.mergeable !== null) return pr;
    await sleep(5000);                             // GitHub computes mergeability lazily
  }
  return api('GET', `repos/${REPO}/pulls/${number}`);
}

function askForHelp(pr, files, reason) {
  const labels = (pr.labels || []).map(l => l.name);
  if (DRY) { log(`  [dry-run] would label + comment: ${reason}`); return; }
  if (!labels.includes(LABEL)) api('POST', `repos/${REPO}/issues/${pr.number}/labels`, { labels: [LABEL] });
  const comments = api('GET', `repos/${REPO}/issues/${pr.number}/comments?per_page=100`);
  const head = pr.head.sha.slice(0, 7);
  if (comments.some(c => c.body.includes(MARK) && c.body.includes(head))) return; // already asked for this head
  api('POST', `repos/${REPO}/issues/${pr.number}/comments`, { body:
`${MARK}
This PR conflicts with \`main\` and could not be resolved automatically (${reason}).

Please merge the latest \`main\` into \`${pr.head.ref}\` and resolve the conflicts in:
${files.map(f => `- \`${f}\``).join('\n')}

Keep the intent of **both** sides (this branch's ticket and what is already on \`main\`), never drop code that landed on \`main\`, regenerate \`pnpm-lock.yaml\` with \`pnpm install\` instead of hand-editing it, and make sure \`pnpm lint && pnpm typecheck && pnpm test\` pass. (head ${head})` });
}

async function syncPr(pr) {
  const br = pr.head.ref;
  log(`\n#${pr.number} ${br}`);
  git('checkout', '-q', '-B', br, `origin/${br}`);
  const m = tryRun('git', ['merge', '--no-edit', '--no-ff', 'origin/main']);
  if (m.ok) { log('  merged cleanly (GitHub state was stale)'); }
  const conflicted = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  const unresolved = [];
  for (const f of conflicted) {
    const r = resolverFor(f);
    if (r && r(f)) { git('add', '--', f); log(`  ✓ auto-resolved ${f}`); }
    else unresolved.push(f);
  }
  if (unresolved.length) {
    log(`  ✗ needs an agent: ${unresolved.join(', ')}`);
    tryRun('git', ['merge', '--abort']);
    askForHelp(pr, unresolved, 'code conflicts');
    return;
  }
  // regenerate lockfile + verify
  const steps = [
    ['pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile']],
    ['pnpm', ['install', '--frozen-lockfile']],
    ['pnpm', ['-r', 'typecheck']],
  ];
  for (const [c, a] of steps) {
    const r = tryRun(c, a);
    if (!r.ok) {
      log(`  ✗ ${c} ${a.join(' ')} failed\n${r.out.slice(-3000)}`);
      tryRun('git', ['merge', '--abort']); tryRun('git', ['reset', '--hard', `origin/${br}`]);
      askForHelp(pr, conflicted, `auto-merge did not pass \`${c} ${a.join(' ')}\``);
      return;
    }
  }
  git('add', '-A');
  git('commit', '-q', '--no-edit', '-m', `Merge main into ${br}\n\nAuto-resolved by tessl-sync-prs: ${conflicted.join(', ') || 'no conflicts'}`);
  if (DRY) { log('  [dry-run] would push'); return; }
  git('push', 'origin', `HEAD:refs/heads/${br}`);
  if ((pr.labels || []).some(l => l.name === LABEL)) tryRun('gh', ['api', '-X', 'DELETE', `repos/${REPO}/issues/${pr.number}/labels/${LABEL}`]);
  log('  ✓ pushed');
}

(async () => {
  if (!REPO) throw new Error('GITHUB_REPOSITORY not set');
  git('config', 'user.name', process.env.GIT_AUTHOR_NAME || 'tessl-sync-prs');
  git('config', 'user.email', process.env.GIT_AUTHOR_EMAIL || 'tessl-sync-prs@users.noreply.github.com');
  git('fetch', '-q', '--prune', 'origin');
  const prs = api('GET', `repos/${REPO}/pulls?state=open&per_page=100`)
    .filter(p => p.head.repo?.full_name === REPO && p.head.ref.startsWith(PREFIX) && p.base.ref === 'main');
  log(`${prs.length} open ${PREFIX}* PR(s)`);
  for (const p of prs) {
    const pr = await mergeableOf(p.number);
    if (pr.mergeable !== false) { log(`#${pr.number} ${pr.head.ref}: mergeable=${pr.mergeable} — skip`); continue; }
    try { await syncPr(pr); }
    catch (e) { log(`  ✗ error: ${e.message}`); tryRun('git', ['merge', '--abort']); }
    git('checkout', '-q', '--detach', 'origin/main');
  }
})().catch(e => { console.error(e); process.exit(1); });
