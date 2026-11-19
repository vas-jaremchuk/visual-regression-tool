#!/usr/bin/env node
/**
 * import-issues.mjs
 * Imports the factory tickets (issues.json + issues/*.md) into GitHub:
 *   1. creates milestones and the labels `tessl` / `tessl:waiting`
 *   2. creates one issue per ticket (idempotent — re-running updates instead of duplicating)
 *   3. rewrites "Depends on: T10, T11" into links to the real issue numbers
 *   4. adds native GitHub "blocked by" dependencies between the issues
 *   5. labels: unblocked open tickets get `tessl`, blocked ones get `tessl:waiting`
 *      (the workflow .github/workflows/tessl-release.yml releases them later)
 *
 * Requirements: Node 18+, GitHub CLI (`gh`) logged in with repo/issues write access.
 *
 * Usage:
 *   node specification/factory/import-issues.mjs                 # repo = current gh repo
 *   node specification/factory/import-issues.mjs --repo owner/name
 *   node specification/factory/import-issues.mjs --dry-run       # show the plan, change nothing
 *   node specification/factory/import-issues.mjs --label-mode all|auto|none   (default auto)
 *   node specification/factory/import-issues.mjs --only T01,T02  # limit to some tickets
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'issues.json'), 'utf8'));
const LABEL = manifest.label;               // "tessl"
const WAITING = manifest.waitingLabel;      // "tessl:waiting"
const MARKER = id => `<!-- tessl-ticket:${id} -->`;
const WRITE_DELAY_MS = 1000;                // avoid GitHub secondary rate limits

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry-run');
const LABEL_MODE = opt('--label-mode') || 'auto';
const ONLY = opt('--only') ? new Set(opt('--only').split(',').map(s => s.trim())) : null;
if (!['auto', 'all', 'none'].includes(LABEL_MODE)) die(`--label-mode must be auto|all|none`);

// ── gh helpers ───────────────────────────────────────────────────────────────
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function gh(args, input) {
  try {
    return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = new Error((e.stderr || e.message || '').toString().trim());
    err.stderr = (e.stderr || '').toString();
    throw err;
  }
}

function api(method, route, body) {
  const args = ['api', '-X', method, route,
    '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (body !== undefined) args.push('--input', '-');
  const out = gh(args, body !== undefined ? JSON.stringify(body) : undefined);
  return out.trim() ? JSON.parse(out) : null;
}

function apiAll(route) {
  const sep = route.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; ; page++) {
    const batch = api('GET', `${route}${sep}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function write(desc, fn) {
  if (DRY) { console.log(`  [dry-run] ${desc}`); return null; }
  const res = fn();
  console.log(`  ✓ ${desc}`);
  await sleep(WRITE_DELAY_MS);
  return res;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  try { gh(['--version']); } catch { die('GitHub CLI `gh` not found — https://cli.github.com'); }
  try { gh(['auth', 'status']); } catch { die('`gh` is not logged in — run `gh auth login`'); }

  const REPO = opt('--repo') || gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) die(`invalid repo "${REPO}"`);
  const R = `repos/${REPO}`;

  const tickets = manifest.tickets.filter(t => !ONLY || ONLY.has(t.id));
  const byId = Object.fromEntries(manifest.tickets.map(t => [t.id, t]));
  for (const t of manifest.tickets) for (const d of t.dependsOn) if (!byId[d]) die(`${t.id} depends on unknown ${d}`);

  console.log(`\nRepo: ${REPO}   tickets: ${tickets.length}   label mode: ${LABEL_MODE}${DRY ? '   (DRY RUN)' : ''}\n`);

  // 1. labels
  console.log('Labels');
  const labels = new Set(apiAll(`${R}/labels`).map(l => l.name));
  const wantLabels = [
    { name: LABEL, color: '5319E7', description: 'Handed to the Tessl factory' },
    { name: WAITING, color: 'FBCA04', description: 'Tessl ticket waiting for blocking issues' },
  ];
  for (const l of wantLabels) {
    if (labels.has(l.name)) console.log(`  · ${l.name} exists`);
    else await write(`create label ${l.name}`, () => api('POST', `${R}/labels`, l));
  }

  // 2. milestones
  console.log('\nMilestones');
  const milestones = Object.fromEntries(apiAll(`${R}/milestones?state=all`).map(m => [m.title, m]));
  for (const m of manifest.milestones) {
    if (milestones[m.title]) { console.log(`  · ${m.title} exists`); continue; }
    const created = await write(`create milestone ${m.title}`, () => api('POST', `${R}/milestones`, { title: m.title }));
    if (created) milestones[m.title] = created;
  }

  // 3. find existing issues (by hidden marker, then by title prefix)
  console.log('\nIssues');
  const existing = apiAll(`${R}/issues?state=all`).filter(i => !i.pull_request);
  const issueOf = {};
  for (const t of manifest.tickets) {
    issueOf[t.id] = existing.find(i => (i.body || '').includes(MARKER(t.id)))
                 || existing.find(i => i.title.startsWith(`${t.id} —`) || i.title.startsWith(`${t.id} -`));
  }

  const bodyFor = t => {
    let md = fs.readFileSync(path.join(HERE, t.file), 'utf8');
    md = md.replace(/^# .*\n+/, '');                                  // title is the issue title
    const deps = t.dependsOn.map(d => {
      const iss = issueOf[d];
      return iss ? `#${iss.number} (${d})` : d;
    });
    md = md.replace(/^\*\*Depends on:\*\*.*$/m, `**Depends on:** ${deps.length ? deps.join(', ') : 'none'}`);
    return `${md.trimEnd()}\n\n---\n_Source: \`specification/factory/${t.file}\` — imported by \`import-issues.mjs\`. Edit the source file and re-run the importer to update._\n${MARKER(t.id)}\n`;
  };

  // 3a. create missing issues (in ticket order so numbers follow T01..T26)
  for (const t of tickets) {
    if (issueOf[t.id]) { console.log(`  · ${t.id} exists as #${issueOf[t.id].number}`); continue; }
    const created = await write(`create issue "${t.title}"`, () => api('POST', `${R}/issues`, {
      title: t.title,
      body: bodyFor(t),
      milestone: milestones[t.milestone]?.number,
    }));
    if (created) issueOf[t.id] = created;
  }

  // 3b. update title/body/milestone (dependency links need all numbers)
  console.log('\nBodies & milestones');
  for (const t of tickets) {
    const iss = issueOf[t.id];
    if (!iss) continue;
    const body = bodyFor(t);
    const ms = milestones[t.milestone]?.number;
    const patch = {};
    if (iss.title !== t.title) patch.title = t.title;
    if ((iss.body || '') !== body) patch.body = body;
    if (ms && iss.milestone?.number !== ms) patch.milestone = ms;
    if (!Object.keys(patch).length) { console.log(`  · #${iss.number} up to date`); continue; }
    const updated = await write(`update #${iss.number} (${Object.keys(patch).join(', ')})`,
      () => api('PATCH', `${R}/issues/${iss.number}`, patch));
    if (updated) issueOf[t.id] = updated;
  }

  // 4. native "blocked by" dependencies
  console.log('\nDependencies (blocked by)');
  for (const t of tickets) {
    const iss = issueOf[t.id];
    if (!iss || !t.dependsOn.length) continue;
    let current = [];
    try { current = apiAll(`${R}/issues/${iss.number}/dependencies/blocked_by`).map(b => b.number); }
    catch (e) { die(`cannot read dependencies of #${iss.number}: ${e.message}\n  (issue dependencies must be available on this repo/plan)`); }
    for (const d of t.dependsOn) {
      const blocker = issueOf[d];
      if (!blocker) { console.log(`  ? ${t.id} ← ${d}: blocker issue not found (import it too)`); continue; }
      if (current.includes(blocker.number)) { console.log(`  · #${iss.number} ${t.id} ← #${blocker.number} ${d}`); continue; }
      try {
        await write(`#${iss.number} ${t.id} blocked by #${blocker.number} ${d}`,
          () => api('POST', `${R}/issues/${iss.number}/dependencies/blocked_by`, { issue_id: blocker.id }));
      } catch (e) {
        console.warn(`  ⚠ #${iss.number} ← #${blocker.number}: ${e.message}`);
      }
    }
  }

  // 5. labels
  console.log(`\nLabels (${LABEL_MODE})`);
  if (LABEL_MODE !== 'none') {
    for (const t of tickets) {
      const iss = issueOf[t.id];
      if (!iss || iss.state === 'closed') continue;
      const has = new Set((iss.labels || []).map(l => (typeof l === 'string' ? l : l.name)));
      const openBlockers = t.dependsOn.map(d => issueOf[d]).filter(b => !b || b.state !== 'closed');
      const ready = LABEL_MODE === 'all' || openBlockers.length === 0;
      if (ready) {
        if (!has.has(LABEL)) await write(`#${iss.number} ${t.id} +${LABEL}`,
          () => api('POST', `${R}/issues/${iss.number}/labels`, { labels: [LABEL] }));
        if (has.has(WAITING)) await write(`#${iss.number} ${t.id} -${WAITING}`,
          () => api('DELETE', `${R}/issues/${iss.number}/labels/${encodeURIComponent(WAITING)}`));
        if (has.has(LABEL) && !has.has(WAITING)) console.log(`  · #${iss.number} ${t.id} already ${LABEL}`);
      } else if (!has.has(LABEL) && !has.has(WAITING)) {
        await write(`#${iss.number} ${t.id} +${WAITING} (blocked by ${t.dependsOn.join(', ')})`,
          () => api('POST', `${R}/issues/${iss.number}/labels`, { labels: [WAITING] }));
      } else {
        console.log(`  · #${iss.number} ${t.id} ${has.has(LABEL) ? LABEL : WAITING}`);
      }
    }
  }

  // 6. map file
  const map = Object.fromEntries(manifest.tickets.filter(t => issueOf[t.id]).map(t =>
    [t.id, { number: issueOf[t.id].number, url: issueOf[t.id].html_url }]));
  if (!DRY) fs.writeFileSync(path.join(HERE, 'issue-map.json'), JSON.stringify({ repo: REPO, issues: map }, null, 2) + '\n');
  console.log(`\n✅ Done${DRY ? ' (dry run — nothing changed)' : ` — map written to specification/factory/issue-map.json`}`);
})().catch(e => die(e.stack || e.message));
