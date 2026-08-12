#!/usr/bin/env node
/**
 * DEV-ONLY end-to-end fixture builder for the Release Manager "commit range" flow
 * on a real GitHub repo. Interactive: prompts for repo name / project code / etc.,
 * then pauses at checkpoints so you can verify in the app between steps.
 *
 * Builds a repo shaped for commit-range analysis:
 *   - frontend/ and backend/ apps (match app regexes ^frontend/ and ^backend/)
 *   - a baseline commit (the "deployed commit")
 *   - N feature PRs, each merged, titled "<CODE>-<n>: ...", touching env and/or
 *     migration files so the analysis produces the env/migration badges
 *   - prints the commit range (deployedCommitId -> newCommitId) for the release ticket
 *   - a hotfix loop to append hotfix PRs on demand and print a fresh range for each
 *
 * All content is created through the GitHub REST / Git-Data API (blobs/trees/commits/
 * refs + pulls) — there is no local `git push`, so machine-level pre-push hooks
 * (e.g. GitGuardian) are not involved. No external deps (Node >= 18: fetch + stdlib).
 *
 * Auth: export GITHUB_TOKEN=ghp_xxx   (a classic PAT with `repo` scope; read from env,
 *        never hardcoded).
 *
 * Full setup:   GITHUB_TOKEN=ghp_xxx node backend/scripts/release-manager-localdev/create-github-release-fixture.mjs
 * Hotfix only:  GITHUB_TOKEN=ghp_xxx node backend/scripts/release-manager-localdev/create-github-release-fixture.mjs hotfix
 *
 * Dev tickets resolve if Ticket rows with the XYNE-### xyneIds exist in the workspace,
 * OR run the backend (dev) with RELEASE_AUTOSTUB_MISSING_TICKETS=1 to auto-stub them
 * (clean up later with cleanup-autostub-tickets.ts).
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const API = 'https://api.github.com';
const MODE_FILE = '100644';

// ---------- input helpers (interactive TTY or pre-buffered pipe) ----------
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
  if (isTTY) {
    const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
    return a || def || '';
  }
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
// checkpoint: on a TTY, block until the user presses Enter; when piped, auto-continue
const pause = async (msg = '  ⏸  press Enter to continue...') => {
  if (!isTTY) { if (pipedLines && pipedLines.length) pipedLines.shift(); return; }
  await rl.question(msg);
};

function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- GitHub API ----------
async function gh(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}
async function ghOr(method, path, body, what) {
  const r = await gh(method, path, body);
  if (!r.ok) die(`${what} failed (${r.status}): ${JSON.stringify(r.json)}`);
  return r.json;
}

// Git Data API primitives
const getRefSha = async (o, r, branch) => {
  const res = await gh('GET', `/repos/${o}/${r}/git/ref/heads/${branch}`);
  return res.ok ? res.json.object.sha : null;
};
const getCommitTree = async (o, r, sha) => {
  const c = await ghOr('GET', `/repos/${o}/${r}/git/commits/${sha}`, null, 'get commit');
  return c.tree.sha;
};
const makeTree = (o, r, tree, baseTree) =>
  ghOr('POST', `/repos/${o}/${r}/git/trees`, baseTree ? { base_tree: baseTree, tree } : { tree }, 'create tree');
const makeCommit = (o, r, message, treeSha, parents) =>
  ghOr('POST', `/repos/${o}/${r}/git/commits`, { message, tree: treeSha, parents }, 'create commit');
const makeRef = (o, r, ref, sha) =>
  ghOr('POST', `/repos/${o}/${r}/git/refs`, { ref, sha }, `create ref ${ref}`);
const updateRef = (o, r, ref, sha) =>
  ghOr('PATCH', `/repos/${o}/${r}/git/refs/${ref}`, { sha, force: false }, `update ref ${ref}`);

// files: [{path, content}]  ->  tree entries with inline content (GitHub makes the blobs)
const toTreeEntries = (files) => files.map((f) => ({ path: f.path, mode: MODE_FILE, type: 'blob', content: f.content }));

// ---------- file fixtures ----------
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
    { path: 'README.md', content: `# Release Manager E2E fixture\n\nGenerated repo for testing the release commit-range flow.\n` },
  ];
}

// change recipes: guarantees env + migration coverage across tickets
const RECIPES = ['migration', 'env', 'both', 'code'];

function featureFiles(kind, num, code) {
  const tag = `${code}-${num}`;
  const files = [
    { path: 'backend/src/index.ts', content: `console.log('backend ${tag}');\n` },
    { path: 'frontend/src/App.tsx', content: `export const App = () => <div>${tag}</div>;\n` },
  ];
  if (kind === 'migration' || kind === 'both') {
    files.push({
      path: `backend/migrations/${String(num).padStart(4, '0')}_${tag.toLowerCase()}.sql`,
      content: `-- ${tag}\nALTER TABLE users ADD COLUMN col_${num} text;\n`,
    });
  }
  if (kind === 'env' || kind === 'both') {
    files.push({
      path: 'backend/.env.prod',
      content: `DATABASE_URL=postgres://localhost/app\nREDIS_URL=redis://localhost:6379\nFEATURE_${num}=enabled\n`,
    });
  }
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
async function ensureBaseline(owner, repo, branch) {
  const existing = await getRefSha(owner, repo, branch);
  if (existing) {
    console.log(`✓ Branch "${branch}" exists — using its head as baseline: ${existing.slice(0, 10)}`);
    return existing;
  }
  // Empty repos can't use the Git Data tree API yet — bootstrap the first file via
  // the Contents API (this also creates the branch), then add the rest via Git Data.
  const files = baselineFiles();
  const first = files[0];
  const put = await ghOr('PUT', `/repos/${owner}/${repo}/contents/${first.path}`, {
    message: 'chore: initial scaffold (baseline / deployed commit)',
    content: Buffer.from(first.content).toString('base64'),
    branch,
  }, 'bootstrap initial commit');
  let headSha = put.commit.sha;

  const rest = files.slice(1);
  if (rest.length) {
    const baseTree = await getCommitTree(owner, repo, headSha);
    const tree = await makeTree(owner, repo, toTreeEntries(rest), baseTree);
    const commit = await makeCommit(owner, repo, 'chore: scaffold frontend + backend apps', tree.sha, [headSha]);
    await updateRef(owner, repo, `heads/${branch}`, commit.sha);
    headSha = commit.sha;
  }
  console.log(`✓ Baseline commit created: ${headSha.slice(0, 10)}`);
  return headSha;
}

// opt-in teardown: delete the whole repo (needs a token with `delete_repo` scope).
async function maybeDeleteRepo(owner, repo) {
  if (!(await askYN(`\n🗑  Delete the repo ${owner}/${repo} now?`, false))) {
    console.log(`  Kept ${owner}/${repo}.`);
    console.log(`  Delete manually: https://github.com/${owner}/${repo}/settings (Danger Zone → Delete)`);
    return;
  }
  const res = await gh('DELETE', `/repos/${owner}/${repo}`);
  if (res.ok) { console.log(`✓ Deleted repo ${owner}/${repo}`); return; }
  if (res.status === 403) {
    console.log(`  ⚠️  Delete forbidden (403). Your token needs the "delete_repo" scope.`);
    console.log(`      Option 1: Delete via web UI: https://github.com/${owner}/${repo}/settings`);
    console.log(`      Option 2: Create a token with delete_repo scope at: https://github.com/settings/tokens`);
    console.log(`      Option 3: Use curl (if you have a token with delete_repo):`);
    console.log(`        curl -X DELETE -H "Authorization: Bearer \${TOKEN}" https://api.github.com/repos/${owner}/${repo}`);
    return;
  }
  console.log(`  ⚠️  Delete failed (${res.status}): ${JSON.stringify(res.json)}`);
}

// ---------- local webhook simulation ----------
// GitHub cloud can't reach a localhost backend without a public tunnel, and a
// fresh fixture repo has no webhook configured — so instead we POST the exact
// `pull_request` (merged) payload GitHub would send, HMAC-signed the same way,
// straight to the local backend. This exercises the release webhook-sync path
// (hotfix → dev tickets/env/migrations + "🔥 Hotfix PRs" canvas section) with
// zero infra. Opt-in via prompt.
let webhookCfg = null; // { url, secret } when enabled

async function maybeSetupWebhookDelivery() {
  const enable = await askYN('\nSimulate GitHub merge webhooks to your LOCAL backend (no tunnel needed)?', false);
  if (!enable) { webhookCfg = null; return; }
  const backend = await ask('Backend base URL', 'http://localhost:3001');
  const workspaceId = await ask('Workspace ID (for /api/webhooks/github/:workspaceId)', process.env.WORKSPACE_ID || '');
  if (!workspaceId) {
    console.log('  ⚠️  No workspace ID given — skipping webhook simulation.');
    webhookCfg = null;
    return;
  }
  // Must match the backend's SCM_WEBHOOK_SECRET. Unset on both sides → '' → still
  // a valid (empty-key) HMAC that the validator accepts.
  const secret = process.env.SCM_WEBHOOK_SECRET ?? '';
  webhookCfg = { url: `${backend.replace(/\/+$/, '')}/api/webhooks/github/${workspaceId}`, secret };
  console.log(`  ✓ Will POST pull_request(merged) webhooks to ${webhookCfg.url}`);
  if (!secret) console.log('  (empty SCM_WEBHOOK_SECRET — matches an unset backend secret)');
}

// POST a signed pull_request.closed(merged) event mirroring GitHub's shape, with
// exactly the fields the backend's extractPRContext reads.
async function deliverMergeWebhook({ owner, repo, prNumber, title, base, head, headSha, mergeSha }) {
  if (!webhookCfg) return;
  const repoObj = {
    name: repo,
    full_name: `${owner}/${repo}`,
    owner: { login: owner },
    clone_url: `https://github.com/${owner}/${repo}.git`,
    html_url: `https://github.com/${owner}/${repo}`,
  };
  const payload = {
    action: 'closed',
    number: prNumber,
    pull_request: {
      number: prNumber,
      html_url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      title,
      state: 'closed',
      merged: true,
      merge_commit_sha: mergeSha,
      user: { login: owner },
      head: { ref: head, sha: headSha, repo: null },
      base: { ref: base, sha: mergeSha, repo: repoObj },
      comments: 0,
      review_comments: 0,
    },
    repository: repoObj,
    sender: { login: owner },
  };
  const bodyStr = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', webhookCfg.secret).update(bodyStr).digest('hex');
  try {
    const res = await fetch(webhookCfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
      },
      body: bodyStr,
    });
    const text = await res.text();
    console.log(`  📡 Webhook PR #${prNumber} → HTTP ${res.status} ${res.ok ? 'OK' : 'FAIL'}: ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`  ⚠️  Webhook delivery failed (backend running at ${webhookCfg.url}?): ${e.message}`);
  }
}

// create a branch, commit files on it, open a PR, squash-merge it. Returns {prNumber, mergeSha}.
async function devTicketPR(owner, repo, base, featureBranch, files, title, body) {
  const baseSha = await getRefSha(owner, repo, base);
  const baseTree = await getCommitTree(owner, repo, baseSha);

  // fresh branch (delete stale one from a previous run, if any)
  const stale = await getRefSha(owner, repo, featureBranch);
  if (stale) await gh('DELETE', `/repos/${owner}/${repo}/git/refs/heads/${featureBranch}`);
  await makeRef(owner, repo, `refs/heads/${featureBranch}`, baseSha);

  const tree = await makeTree(owner, repo, toTreeEntries(files), baseTree);
  const commit = await makeCommit(owner, repo, title, tree.sha, [baseSha]);
  await updateRef(owner, repo, `heads/${featureBranch}`, commit.sha);

  const pr = await ghOr('POST', `/repos/${owner}/${repo}/pulls`,
    { title, head: featureBranch, base, body }, 'create PR');

  let merge;
  for (let i = 0; i < 6; i++) {
    merge = await gh('PUT', `/repos/${owner}/${repo}/pulls/${pr.number}/merge`,
      { merge_method: 'squash', commit_title: `${title} (#${pr.number})` });
    if (merge.ok) break;
    if (merge.status === 405 || merge.status === 409) { await sleep(1500); continue; }
    die(`merge PR #${pr.number} failed (${merge.status}): ${JSON.stringify(merge.json)}`);
  }
  if (!merge.ok) die(`merge PR #${pr.number} not mergeable: ${JSON.stringify(merge.json)}`);

  // Simulate the GitHub merge webhook to the local backend (if enabled). The
  // merge commit sha is the post-merge branch head — the hotfix delta's upper
  // bound the backend uses.
  await deliverMergeWebhook({
    owner, repo, prNumber: pr.number, title, base,
    head: featureBranch, headSha: commit.sha, mergeSha: merge.json.sha,
  });

  return { prNumber: pr.number, mergeSha: merge.json.sha };
}

// ---------- flows ----------
async function fullSetup() {
  console.log('\n=== Release Manager E2E — full setup ===\n');
  const me = await gh('GET', '/user');
  if (!me.ok) die(`token check failed (${me.status}). Is GITHUB_TOKEN set + valid?`);
  const defaultOwner = me.json.login;
  console.log(`Authenticated as: ${defaultOwner}\n`);

  const owner = await ask('GitHub owner (user or org)', defaultOwner);
  const repo = await ask('New repo name', 'release-e2e-test');
  const isPrivate = await askYN('Private repo?', true);
  const code = (await ask('Project code / ticket prefix', 'XYNE')).toUpperCase();
  const branch = await ask('Release/base branch', 'main');
  const count = parseInt(await ask('How many feature PRs (dev tickets)?', '3'), 10) || 3;
  const startNum = parseInt(await ask('Starting ticket number', '101'), 10) || 101;
  const stepwise = await askYN('Pause after each PR so you can verify in the app?', false);
  await maybeSetupWebhookDelivery();

  // create repo (or reuse)
  const createPath = owner === defaultOwner ? '/user/repos' : `/orgs/${owner}/repos`;
  const created = await gh('POST', createPath, { name: repo, private: isPrivate, auto_init: false });
  if (created.status === 422) {
    const exists = await gh('GET', `/repos/${owner}/${repo}`);
    if (!exists.ok) die(`repo create failed: ${JSON.stringify(created.json)}`);
    if (!(await askYN(`Repo ${owner}/${repo} already exists. Reuse it?`, false)))
      die('aborted (choose a different name).');
    console.log('Reusing existing repo.');
  } else if (!created.ok) {
    die(`repo create failed (${created.status}): ${JSON.stringify(created.json)}`);
  } else {
    console.log(`✓ Created repo ${owner}/${repo}`);
  }
  console.log(`  URL: https://github.com/${owner}/${repo}.git`);

  const deployedCommitId = await ensureBaseline(owner, repo, branch);

  const rows = [];
  for (let i = 0; i < count; i++) {
    const num = startNum + i;
    const tag = `${code}-${num}`;
    const kind = RECIPES[i % RECIPES.length];
    const fb = `feature/${tag.toLowerCase()}`;
    const files = featureFiles(kind, num, code);
    const title = `${tag}: ${featureTitle(kind, num)}`;
    const { prNumber, mergeSha } = await devTicketPR(owner, repo, branch, fb, files, title,
      `Automated E2E dev ticket ${tag}\n\nChange kind: ${kind}\nFiles: ${files.map(f => f.path).join(', ')}`);
    rows.push({ tag, kind, prNumber, mergeSha, touched: files.map(f => f.path) });
    console.log(`✓ ${tag}  PR #${prNumber}  [${kind}]  merged ${mergeSha.slice(0, 10)}`);
    if (stepwise && i < count - 1) await pause(`  ⏸  ${tag} done. Check the app, then press Enter for the next PR...`);
  }

  const newCommitId = await getRefSha(owner, repo, branch);
  printSummary({ owner, repo, branch, code, deployedCommitId, newCommitId, rows, ticketType: 'Release' });
  console.log('➡  Now create the RELEASE ticket in the app with the range above,');
  console.log('   and verify Dev Tickets / Envs / Migrations populate.\n');

  // hotfix loop — add as many as you like, verifying between each
  let hotfixNum = startNum + count;
  while (await askYN('Add a hotfix PR now?', false)) {
    const sinceCommit = await getRefSha(owner, repo, branch);
    await doHotfix({ owner, repo, branch, code, sinceCommit, num: hotfixNum });
    hotfixNum++;
    console.log('➡  Create a HOTFIX ticket with the new range above and verify.\n');
  }
  await maybeDeleteRepo(owner, repo);
  console.log('Done. 🎉');
}

async function hotfixOnly() {
  console.log('\n=== Release Manager E2E — hotfix ===\n');
  const me = await gh('GET', '/user');
  if (!me.ok) die(`token check failed (${me.status}).`);
  const owner = await ask('GitHub owner', me.json.login);
  const repo = await ask('Existing repo name', 'release-e2e-test');
  const branch = await ask('Base branch', 'main');
  const code = (await ask('Project code / ticket prefix', 'XYNE')).toUpperCase();
  const num = parseInt(await ask('Hotfix ticket number', '901'), 10) || 901;
  await maybeSetupWebhookDelivery();

  const sinceCommit = await getRefSha(owner, repo, branch);
  if (!sinceCommit) die(`branch ${branch} not found in ${owner}/${repo}`);
  console.log(`Current head (hotfix deployed commit): ${sinceCommit.slice(0, 10)}`);
  await doHotfix({ owner, repo, branch, code, sinceCommit, num });
  await maybeDeleteRepo(owner, repo);
}

async function doHotfix({ owner, repo, branch, code, sinceCommit, num }) {
  const tag = `${code}-${num}`;
  const fb = `hotfix/${tag.toLowerCase()}`;
  const files = featureFiles('both', num, code); // typical urgent fix: env + migration
  const title = `${tag}: hotfix urgent production issue`;
  const { prNumber, mergeSha } = await devTicketPR(owner, repo, branch, fb, files, title,
    `Automated E2E HOTFIX ${tag}\nFiles: ${files.map(f => f.path).join(', ')}`);
  console.log(`✓ HOTFIX ${tag}  PR #${prNumber}  merged ${mergeSha.slice(0, 10)}`);
  const newCommitId = await getRefSha(owner, repo, branch);
  printSummary({
    owner, repo, branch, code,
    deployedCommitId: sinceCommit, newCommitId,
    rows: [{ tag, kind: 'both', prNumber, mergeSha, touched: files.map(f => f.path) }],
    ticketType: 'Hotfix',
  });
}

// ---------- output ----------
function printSummary({ owner, repo, branch, code, deployedCommitId, newCommitId, rows, ticketType }) {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const line = '─'.repeat(66);
  console.log(`\n${line}`);
  console.log(`  ${ticketType.toUpperCase()} FIXTURE READY`);
  console.log(line);
  console.log(`  Repo URL          : ${repoUrl}`);
  console.log(`  Repo (clone)      : ${repoUrl}.git`);
  console.log(`  Branch            : ${branch}`);
  console.log(`  deployedCommitId  : ${deployedCommitId}`);
  console.log(`  newCommitId       : ${newCommitId}`);
  console.log(line);
  console.log('  Dev tickets (PRs) in range:');
  for (const r of rows) {
    console.log(`    ${r.tag.padEnd(12)} PR #${String(r.prNumber).padEnd(5)} [${r.kind}]`);
    for (const f of r.touched) console.log(`        · ${f}`);
  }
  console.log(line);
  console.log('  Suggested "Configure Applications" values (paste into the wizard):');
  console.log(`    Repository URL   : ${repoUrl}.git`);
  console.log(`    VCS provider     : GitHub`);
  console.log(`    Tracking mode    : Commit range`);
  console.log(`    App 1 name/regex : frontend   ^frontend/`);
  console.log(`      env paths      : .env.prod`);
  console.log(`      migration paths: (none)`);
  console.log(`    App 2 name/regex : backend    ^backend/`);
  console.log(`      env paths      : .env.prod, config/env.yml`);
  console.log(`      migration paths: migrations/`);
  console.log(line);
  console.log('  Next steps:');
  console.log(`    1. In the app, open "Configure Applications", point it at the repo`);
  console.log(`       above, add the frontend + backend apps with the values shown.`);
  console.log(`    2. Ensure the project code is "${code}" (PR titles embed ${code}-###).`);
  console.log(`    3. Create a ${ticketType} ticket with dynamic fields:`);
  console.log(`         branch           = ${branch}`);
  console.log(`         deployedCommitId = ${deployedCommitId}`);
  console.log(`         newCommitId      = ${newCommitId}`);
  console.log(`    4. Dev tickets need Ticket rows with those xyneIds in the workspace,`);
  console.log(`       OR run the backend (dev) with RELEASE_AUTOSTUB_MISSING_TICKETS=1`);
  console.log(`       so missing dev tickets are auto-stubbed during analysis.`);
  console.log(`${line}\n`);
}

// ---------- entry ----------
(async () => {
  if (!TOKEN) die('GITHUB_TOKEN (or GH_TOKEN) env var is required. export GITHUB_TOKEN=ghp_xxx');
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
