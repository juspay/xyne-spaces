#!/usr/bin/env node
/**
 * DEV-ONLY end-to-end fixture builder for the Release Manager "commit range" flow
 * on a real Bitbucket Server / Data Center repo. Mirrors the GitHub fixture.
 *
 * Bitbucket has no Git-Data API (and its file-edit REST can't seed an empty
 * repo), so content is created with LOCAL GIT (commit + push over HTTPS using
 * the token as a Bearer header) and PRs are opened/squash-merged over REST.
 * Merging records the token's user as committer, so a PERSONAL HTTP access token
 * (which has an email) is required — a repository access token will fail.
 *
 * Auth:  export BITBUCKET_TOKEN=BBDC-xxxx   (personal HTTP access token, Repo Write+Admin)
 * Base:  export BITBUCKET_BASE=https://bitbucket.juspay.net   (default)
 *
 * Full:   BITBUCKET_TOKEN=… node backend/scripts/release-manager-localdev/create-bitbucket-release-fixture.mjs
 * Hotfix: BITBUCKET_TOKEN=… node backend/scripts/release-manager-localdev/create-bitbucket-release-fixture.mjs hotfix
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import crypto from 'node:crypto';

const TOKEN = process.env.BITBUCKET_TOKEN;
const BASE = (process.env.BITBUCKET_BASE || 'https://bitbucket.juspay.net').replace(/\/+$/, '');
const API = `${BASE}/rest/api/1.0`;

// ---------- input helpers (TTY or piped) ----------
const isTTY = Boolean(input.isTTY);
const rl = isTTY ? readline.createInterface({ input, output }) : null;
let pipedLines = null;
async function loadPiped() {
  if (pipedLines !== null) return;
  const chunks = [];
  for await (const c of input) chunks.push(c);
  pipedLines = Buffer.concat(chunks).toString('utf8').split('\n');
}
const ask = async (q, def) => {
  if (isTTY) { const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim(); return a || def || ''; }
  await loadPiped();
  const val = ((pipedLines.shift() ?? '').trim()) || def || '';
  console.log(`${q}: ${val}`);
  return val;
};
const askYN = async (q, def = true) => {
  const a = (await ask(`${q} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
};
const pause = async (msg = '  ⏸  press Enter to continue...') => {
  if (!isTTY) { if (pipedLines && pipedLines.length) pipedLines.shift(); return; }
  await rl.question(msg);
};
function die(msg) { console.error(`\n❌ ${msg}`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- REST ----------
async function bb(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}
async function bbOr(method, path, body, what) {
  const r = await bb(method, path, body);
  if (!r.ok) die(`${what} failed (${r.status}): ${JSON.stringify(r.json)}`);
  return r.json;
}

// ---------- git (token via Bearer header; no creds persisted) ----------
function git(args, cwd) {
  const r = spawnSync('git', ['-c', `http.extraHeader=Authorization: Bearer ${TOKEN}`, ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) die(`git ${args.slice(2).join(' ')} failed:\n${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
}
function writeFiles(root, files) {
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
}

// ---------- file fixtures (identical recipes to the GitHub fixture) ----------
function baselineFiles() {
  return [
    { path: 'frontend/package.json', content: JSON.stringify({ name: 'frontend', version: '0.1.0' }, null, 2) + '\n' },
    { path: 'frontend/src/App.tsx', content: `export const App = () => <div>v0</div>;\n` },
    { path: 'frontend/.env.prod', content: `VITE_API_URL=https://api.example.com\nVITE_FEATURE_FLAG=off\n` },
    { path: 'backend/package.json', content: JSON.stringify({ name: 'backend', version: '0.1.0' }, null, 2) + '\n' },
    { path: 'backend/src/index.ts', content: `console.log('backend v0');\n` },
    { path: 'backend/.env.prod', content: `DATABASE_URL=postgres://localhost/app\nREDIS_URL=redis://localhost:6379\n` },
    { path: 'backend/config/env.yml', content: `service: backend\nreplicas: 2\n` },
    { path: 'backend/migrations/0001_init.sql', content: `CREATE TABLE users (id serial primary key, email text);\n` },
    { path: 'README.md', content: `# Release Manager E2E fixture (Bitbucket)\n\nGenerated repo for testing the release commit-range flow.\n` },
  ];
}
const RECIPES = ['migration', 'env', 'both', 'code'];
function featureFiles(kind, num, code) {
  const tag = `${code}-${num}`;
  const files = [
    { path: 'backend/src/index.ts', content: `console.log('backend ${tag}');\n` },
    { path: 'frontend/src/App.tsx', content: `export const App = () => <div>${tag}</div>;\n` },
  ];
  if (kind === 'migration' || kind === 'both')
    files.push({ path: `backend/migrations/${String(num).padStart(4, '0')}_${tag.toLowerCase()}.sql`, content: `-- ${tag}\nALTER TABLE users ADD COLUMN col_${num} text;\n` });
  if (kind === 'env' || kind === 'both')
    files.push({ path: 'backend/.env.prod', content: `DATABASE_URL=postgres://localhost/app\nREDIS_URL=redis://localhost:6379\nFEATURE_${num}=enabled\n` });
  return files;
}
function featureTitle(kind, num) {
  switch (kind) {
    case 'migration': return `add migration for feature ${num}`;
    case 'env': return `add env config for feature ${num}`;
    case 'both': return `add table and env vars for feature ${num}`;
    default: return `code change for feature ${num}`;
  }
}

// ---------- higher-level ops ----------
function cloneUrl(proj, repo) { return `${BASE}/scm/${proj}/${repo}.git`; }

// Clone into a fresh temp dir. Returns the work dir.
function cloneRepo(proj, repo) {
  const work = mkdtempSync(join(tmpdir(), 'bb-fixture-'));
  git(['clone', cloneUrl(proj, repo), work], tmpdir());
  git(['config', 'user.name', 'Xyne Release Fixture'], work);
  git(['config', 'user.email', 'release-fixture@xyne.local'], work);
  return work;
}
// The repo may not allow every merge strategy (e.g. squash disabled); use its
// configured default (falls back to no-ff). Cached across PRs.
let MERGE_STRATEGY = null;
async function mergeStrategy(proj, repo) {
  if (MERGE_STRATEGY) return MERGE_STRATEGY;
  const r = await bb('GET', `/projects/${proj}/repos/${repo}/settings/pull-requests`);
  MERGE_STRATEGY = (r.ok && r.json?.mergeConfig?.defaultStrategy?.id) || 'no-ff';
  return MERGE_STRATEGY;
}

// Open a PR and merge it (repo's default strategy). Returns { prId, mergeCommit }.
async function openAndMergePR(proj, repo, base, featureBranch, title, body) {
  const repoRef = { slug: repo, project: { key: proj } };
  const pr = await bbOr('POST', `/projects/${proj}/repos/${repo}/pull-requests`, {
    title, description: body,
    fromRef: { id: `refs/heads/${featureBranch}`, repository: repoRef },
    toRef: { id: `refs/heads/${base}`, repository: repoRef },
  }, 'create PR');

  const strategyId = await mergeStrategy(proj, repo);
  let merge;
  for (let i = 0; i < 6; i++) {
    merge = await bb('POST', `/projects/${proj}/repos/${repo}/pull-requests/${pr.id}/merge?version=${pr.version}`, { strategyId });
    if (merge.ok) break;
    // 409 = out-of-date version or not mergeable yet; refetch version and retry.
    if (merge.status === 409) {
      const fresh = await bb('GET', `/projects/${proj}/repos/${repo}/pull-requests/${pr.id}`);
      if (fresh.ok) pr.version = fresh.json.version;
      await sleep(1500); continue;
    }
    die(`merge PR #${pr.id} failed (${merge.status}): ${JSON.stringify(merge.json)}`);
  }
  if (!merge.ok) die(`merge PR #${pr.id} not mergeable: ${JSON.stringify(merge.json)}`);
  const mergeCommit = merge.json.properties?.mergeCommit?.id || null;
  return { prId: pr.id, mergeCommit };
}

// Create a feature/hotfix branch off the CURRENT server `base`, commit files,
// push, open+merge PR. Fetching first is essential: earlier merges advance the
// server branch, so branching off a stale local ref would conflict on merge.
async function devTicketPR(work, proj, repo, base, featureBranch, files, title, body) {
  git(['fetch', '-q', 'origin', base], work);
  git(['checkout', '-q', '-B', featureBranch, `origin/${base}`], work);
  writeFiles(work, files);
  git(['add', '-A'], work);
  git(['commit', '-q', '-m', title], work);
  git(['push', '-q', '--force', 'origin', `HEAD:${featureBranch}`], work);
  return openAndMergePR(proj, repo, base, featureBranch, title, body);
}

async function ensureBaseline(work, proj, repo, branch) {
  const def = await bb('GET', `/projects/${proj}/repos/${repo}/branches/default`);
  if (def.ok && def.json.latestCommit) {
    console.log(`✓ Branch "${branch}" exists — using its head as baseline: ${def.json.latestCommit.slice(0, 10)}`);
    git(['checkout', '-q', branch], work);
    return def.json.latestCommit;
  }
  // Empty repo → seed the baseline via git push.
  writeFiles(work, baselineFiles());
  git(['checkout', '-q', '-B', branch], work);
  git(['add', '-A'], work);
  git(['commit', '-q', '-m', 'chore: scaffold frontend + backend apps (baseline / deployed commit)'], work);
  git(['push', '-q', '-u', 'origin', `HEAD:${branch}`], work);
  const head = git(['rev-parse', 'HEAD'], work);
  console.log(`✓ Baseline commit created: ${head.slice(0, 10)}`);
  return head;
}

async function getBranchHead(proj, repo) {
  const def = await bbOr('GET', `/projects/${proj}/repos/${repo}/branches/default`, null, 'get default branch');
  return def.latestCommit;
}

// ---------- webhook registration (real, against the tunnel) ----------
async function maybeRegisterWebhook(proj, repo) {
  if (!(await askYN('\nRegister a pr:merged webhook on the repo (points Bitbucket at your backend)?', false))) return;
  const publicUrl = (await ask('Public backend base URL (cloudflared/ngrok)', process.env.PUBLIC_URL || '')).replace(/\/+$/, '');
  const workspaceId = await ask('Workspace ID', process.env.WORKSPACE_ID || '');
  const secret = process.env.SCM_WEBHOOK_SECRET || (await ask('SCM_WEBHOOK_SECRET (must match backend)', ''));
  if (!publicUrl || !workspaceId) { console.log('  ⚠️  Missing URL or workspace ID — skipping webhook.'); return; }
  const url = `${publicUrl}/api/webhooks/bitbucket/${workspaceId}`;
  // Remove stale xyne webhooks first (idempotent re-runs).
  const existing = await bb('GET', `/projects/${proj}/repos/${repo}/webhooks`);
  for (const h of existing.ok ? existing.json.values || [] : []) {
    if ((h.name || '').startsWith('xyne-release')) await bb('DELETE', `/projects/${proj}/repos/${repo}/webhooks/${h.id}`);
  }
  const r = await bb('POST', `/projects/${proj}/repos/${repo}/webhooks`, {
    name: 'xyne-release', url, active: true, events: ['pr:merged'],
    ...(secret ? { configuration: { secret } } : {}),
  });
  if (r.ok) console.log(`✓ Webhook registered (id ${r.json.id}) → ${url}`);
  else console.log(`  ⚠️  Webhook registration failed (${r.status}): ${JSON.stringify(r.json)}`);
}

// ---------- flows ----------
async function fullSetup() {
  console.log('\n=== Release Manager E2E (Bitbucket) — full setup ===\n');
  const me = await bb('GET', '/application-properties'); // cheap auth probe
  if (!me.ok) die(`token check failed (${me.status}). Is BITBUCKET_TOKEN set + valid?`);

  const proj = await ask('Project key (personal repos use ~username, e.g. ~sumant.tirkey_juspay.in)', '~sumant.tirkey_juspay.in');
  const repo = await ask('Repo slug', 'xyne-test-release-manager');
  const code = (await ask('Project code / ticket prefix', 'XYNE')).toUpperCase();
  const branch = await ask('Release/base branch', 'master');
  const count = parseInt(await ask('How many feature PRs (dev tickets)?', '3'), 10) || 3;
  const startNum = parseInt(await ask('Starting ticket number', '101'), 10) || 101;
  const stepwise = await askYN('Pause after each PR so you can verify in the app?', false);

  const exists = await bb('GET', `/projects/${proj}/repos/${repo}`);
  if (!exists.ok) die(`repo ${proj}/${repo} not found (${exists.status}). Create it in Bitbucket first.`);
  console.log(`✓ Using repo ${proj}/${repo}`);
  console.log(`  URL: ${BASE}/projects/${proj}/repos/${repo}`);

  const work = cloneRepo(proj, repo);
  const deployedCommitId = await ensureBaseline(work, proj, repo, branch);

  const rows = [];
  for (let i = 0; i < count; i++) {
    const num = startNum + i;
    const tag = `${code}-${num}`;
    const kind = RECIPES[i % RECIPES.length];
    const fb = `feature/${tag.toLowerCase()}`;
    const files = featureFiles(kind, num, code);
    const title = `${tag}: ${featureTitle(kind, num)}`;
    const { prId, mergeCommit } = await devTicketPR(work, proj, repo, branch, fb, files, title,
      `Automated E2E dev ticket ${tag}\n\nChange kind: ${kind}`);
    rows.push({ tag, kind, prId, mergeCommit, touched: files.map(f => f.path) });
    console.log(`✓ ${tag}  PR #${prId}  [${kind}]  merged ${(mergeCommit || '').slice(0, 10)}`);
    if (stepwise && i < count - 1) await pause(`  ⏸  ${tag} done. Check the app, then press Enter for the next PR...`);
  }

  const newCommitId = await getBranchHead(proj, repo);
  printSummary({ proj, repo, branch, code, deployedCommitId, newCommitId, rows, ticketType: 'Release' });

  let hotfixNum = startNum + count;
  while (await askYN('Add a hotfix PR now?', false)) {
    const sinceCommit = await getBranchHead(proj, repo);
    await doHotfix({ work, proj, repo, branch, code, sinceCommit, num: hotfixNum });
    hotfixNum++;
    console.log('➡  Create a HOTFIX ticket with the new range above and verify.\n');
  }
  await maybeRegisterWebhook(proj, repo);
  rmSync(work, { recursive: true, force: true });
  console.log('Done. 🎉');
}

async function hotfixOnly() {
  console.log('\n=== Release Manager E2E (Bitbucket) — hotfix ===\n');
  const proj = await ask('Project key', '~sumant.tirkey_juspay.in');
  const repo = await ask('Repo slug', 'xyne-test-release-manager');
  const branch = await ask('Base branch', 'master');
  const code = (await ask('Project code / ticket prefix', 'XYNE')).toUpperCase();
  const num = parseInt(await ask('Hotfix ticket number', '901'), 10) || 901;

  const sinceCommit = await getBranchHead(proj, repo);
  console.log(`Current head (hotfix deployed commit): ${sinceCommit.slice(0, 10)}`);
  const work = cloneRepo(proj, repo);
  await doHotfix({ work, proj, repo, branch, code, sinceCommit, num });
  await maybeRegisterWebhook(proj, repo);
  rmSync(work, { recursive: true, force: true });
}

async function doHotfix({ work, proj, repo, branch, code, sinceCommit, num }) {
  const tag = `${code}-${num}`;
  const fb = `hotfix/${tag.toLowerCase()}`;
  const files = featureFiles('both', num, code);
  const title = `${tag}: hotfix urgent production issue`;
  const { prId, mergeCommit } = await devTicketPR(work, proj, repo, branch, fb, files, title,
    `Automated E2E HOTFIX ${tag}`);
  console.log(`✓ HOTFIX ${tag}  PR #${prId}  merged ${(mergeCommit || '').slice(0, 10)}`);
  const newCommitId = await getBranchHead(proj, repo);
  printSummary({
    proj, repo, branch, code, deployedCommitId: sinceCommit, newCommitId,
    rows: [{ tag, kind: 'both', prId, mergeCommit, touched: files.map(f => f.path) }], ticketType: 'Hotfix',
  });
}

// ---------- output ----------
function printSummary({ proj, repo, branch, code, deployedCommitId, newCommitId, rows, ticketType }) {
  const repoUrl = `${BASE}/projects/${proj}/repos/${repo}`;
  const line = '─'.repeat(66);
  console.log(`\n${line}`);
  console.log(`  ${ticketType.toUpperCase()} FIXTURE READY`);
  console.log(line);
  console.log(`  Repo URL          : ${repoUrl}`);
  console.log(`  Branch            : ${branch}`);
  console.log(`  deployedCommitId  : ${deployedCommitId}`);
  console.log(`  newCommitId       : ${newCommitId}`);
  console.log(line);
  console.log('  Dev tickets (PRs) in range:');
  for (const r of rows) {
    console.log(`    ${r.tag.padEnd(12)} PR #${String(r.prId).padEnd(5)} [${r.kind}]`);
    for (const f of r.touched) console.log(`        · ${f}`);
  }
  console.log(line);
  console.log('  Configure Applications (paste into the wizard):');
  console.log(`    Repository URL   : ${repoUrl}`);
  console.log(`    VCS provider     : Bitbucket`);
  console.log(`    Tracking mode    : Commit range`);
  console.log(`    App 1 name/regex : frontend   ^frontend/    env: .env.prod`);
  console.log(`    App 2 name/regex : backend    ^backend/     env: .env.prod, config/env.yml   migrations: migrations/`);
  console.log(line);
  console.log(`  Create a ${ticketType} ticket with: branch=${branch}, deployedCommitId=${deployedCommitId}, newCommitId=${newCommitId}`);
  console.log(`  Dev tickets need Ticket rows with those xyneIds, OR run backend with RELEASE_AUTOSTUB_MISSING_TICKETS=1.`);
  console.log(`${line}\n`);
}

// ---------- entry ----------
(async () => {
  if (!TOKEN) die('BITBUCKET_TOKEN is required (personal HTTP access token). export BITBUCKET_TOKEN=BBDC-xxx');
  try {
    const mode = (process.argv[2] || '').toLowerCase();
    if (mode === 'hotfix') await hotfixOnly();
    else await fullSetup();
  } catch (e) {
    die(e?.stack || String(e));
  } finally {
    if (rl) rl.close();
  }
})();
