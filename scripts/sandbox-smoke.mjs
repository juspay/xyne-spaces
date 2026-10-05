#!/usr/bin/env node
/**
 * Post-deploy smoke check for a deployed environment (sandbox by default).
 * Run by .github/workflows/sandbox-smoke.yml; no dependencies beyond Node 22's built-in fetch.
 *
 * Logs in as the test account, runs read checks (GET only) and, when SMOKE_CHANNEL_ID is set,
 * write checks confined to that private channel: send, reply, reaction, image upload. Each run
 * leaves two messages + one reply there (there is no REST delete), so use a channel kept for this.
 *
 * Env:
 *   SMOKE_SESSION_ID       `user_session_id` cookie from a one-time browser login on this
 *                          environment; exchanged for a fresh token via /api/v2/auth/refresh-session.
 *                          Lasts SESSION_EXPIRY_DAYS (180 by default) unless that session logs out.
 *   SMOKE_CHANNEL_ID       Optional private test channel for the write checks
 *   SMOKE_EXPECTED_BRANCH  Optional, e.g. "release-20261005"; must match the /api/health version
 *   SMOKE_BASE_URL         Default: sandbox
 *
 * Usage: SMOKE_SESSION_ID=... SMOKE_CHANNEL_ID=... node scripts/sandbox-smoke.mjs
 * Exits 1 if any check fails. Writes a Markdown summary to GITHUB_STEP_SUMMARY when set.
 */
import { appendFileSync } from 'node:fs';

const BASE_URL = (process.env.SMOKE_BASE_URL || 'https://spaces.sandbox.xyne.juspay.net').replace(
  /\/+$/,
  ''
);
const EXPECTED_BRANCH = process.env.SMOKE_EXPECTED_BRANCH?.trim() || '';
const SESSION_ID = process.env.SMOKE_SESSION_ID?.trim() || '';
const CHANNEL_ID = process.env.SMOKE_CHANNEL_ID?.trim() || '';
const TIMEOUT_MS = 15_000;
const ATTACHMENT_READY_WAIT_MS = 20_000;

// Simple "this page of data loads" checks: [name, path].
const READ_CHECKS = [
  ['DM list', '/api/users/me/dms'],
  ['Channel list', '/api/channels/publish-targets'],
  ['User search', '/api/users/search?q=a'],
  ['My threads', '/api/conversations/threads?limit=5'],
  ['Recent conversations', '/api/conversations/recent-visited'],
  ['Notifications', '/api/notifications?limit=5'],
  ['Call recordings', '/api/calls/recordings?limit=5'],
];
const WRITE_CHECKS = [
  'Send message',
  'Read message back',
  'Reply in thread',
  'Reaction add + remove',
  'Image upload + download',
];
const AUTH_CHECKS = ['Current user', ...READ_CHECKS.map(([name]) => name), ...WRITE_CHECKS];

// A real 1×1 PNG: the upload pipeline checks file content, not just the extension.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** @type {Array<{ name: string, status: 'pass' | 'fail' | 'skip', detail: string, ms: number }>} */
const results = [];
const cookies = new Map();

class CheckError extends Error {}

async function check(name, fn) {
  const started = Date.now();
  try {
    results.push({ name, status: 'pass', detail: await fn(), ms: Date.now() - started });
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'fail', detail, ms: Date.now() - started });
    return false;
  }
}

function skip(names, detail) {
  for (const name of names) results.push({ name, status: 'skip', detail, ms: 0 });
}

// Credentials are only ever sent to Xyne's own HTTPS hosts, so a mistyped or
// malicious SMOKE_BASE_URL can't collect the session cookie.
function isTrustedHost(baseUrl) {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    return protocol === 'https:' && hostname.endsWith('.xyne.juspay.net');
  } catch {
    return false;
  }
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size > 0) {
    headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair = ''] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return response;
}

/** Sends a request and returns its JSON body, or throws with the status and short server error. */
async function call(method, path, body) {
  const response = await request(path, {
    method,
    ...(body === undefined
      ? {}
      : body instanceof FormData
        ? { body }
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Output can land in public CI logs: report only the server's short error text, never the body.
    const reason = [json.error, json.message].find((v) => typeof v === 'string') ?? '';
    throw new CheckError(`${method} ${path} → ${response.status} ${reason.slice(0, 120)}`.trim());
  }
  return json;
}

function userIdFromJwt(token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  if (!payload?.sub) throw new CheckError('session token has no user id');
  return payload.sub;
}

async function run() {
  console.log(
    `Smoke check against ${BASE_URL}${EXPECTED_BRANCH ? ` (expecting ${EXPECTED_BRANCH})` : ''}\n`
  );

  let version = '';
  await check('Backend health', async () => {
    const { data } = await call('GET', '/api/health');
    version = data?.version ?? '';
    if (data?.status !== 'OK') throw new CheckError(`status is ${data?.status ?? 'missing'}`);
    if (data?.database?.connected !== true) throw new CheckError('database is not connected');
    return `OK, database connected, version ${version || 'unknown'}`;
  });

  if (EXPECTED_BRANCH) {
    await check('Deployed version matches branch', async () => {
      if (!version) throw new CheckError('health did not report a version');
      // Release builds look like "1.454.1-release-20261005.1": match the whole branch name, so
      // "release-202610" can't pass for "release-20261005".
      const escaped = EXPECTED_BRANCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`-${escaped}(\\.|$)`).test(version)) {
        throw new CheckError(`running ${version}, expected a ${EXPECTED_BRANCH} build`);
      }
      return version;
    });
  } else {
    skip(['Deployed version matches branch'], 'no expected branch given');
  }

  await check('Dashboard loads', async () => {
    const response = await request('/');
    const type = response.headers.get('content-type') ?? '';
    await response.arrayBuffer();
    if (!response.ok) throw new CheckError(`GET / → ${response.status}`);
    if (!type.includes('text/html')) throw new CheckError(`expected HTML, got ${type || 'nothing'}`);
    return 'HTML served';
  });

  // ---- Login: exchange the saved session for a fresh token ----

  if (!SESSION_ID) {
    skip(['Session refresh login'], 'SMOKE_SESSION_ID not set');
    skip(AUTH_CHECKS, 'needs login');
    return;
  }
  if (!isTrustedHost(BASE_URL)) {
    results.push({
      name: 'Session refresh login',
      status: 'fail',
      detail: 'refusing to send credentials: base URL must be https://*.xyne.juspay.net',
      ms: 0,
    });
    skip(AUTH_CHECKS, 'login refused');
    return;
  }

  let userId = '';
  const loggedIn = await check('Session refresh login', async () => {
    cookies.set('user_session_id', SESSION_ID);
    const response = await request('/api/v2/auth/refresh-session');
    if (!response.ok) {
      const { message = '' } = await response.json().catch(() => ({}));
      const hint =
        response.status === 401 || response.status === 403
          ? ' — session may have expired or been logged out; copy a fresh user_session_id'
          : response.status >= 500
            ? ' — backend unavailable (restarting or down), not a session problem; retry shortly'
            : '';
      throw new CheckError(`${response.status} ${message}`.trim() + hint);
    }
    // Refresh sets `xyne_ws_<workspaceId>_token` for the session's workspace.
    const tokenCookie = [...cookies].find(([name]) => /^xyne_ws_.+_token$/.test(name));
    if (!tokenCookie) throw new CheckError('refresh succeeded but no workspace token was set');
    cookies.set('xyne_last_workspace', tokenCookie[0].slice('xyne_ws_'.length, -'_token'.length));
    userId = userIdFromJwt(tokenCookie[1]);
    return 'fresh token issued';
  });
  if (!loggedIn) {
    skip(AUTH_CHECKS, 'login failed');
    return;
  }

  // ---- Read checks (GET only, no side effects) ----

  await check('Current user', async () => {
    await call('GET', `/api/users/${encodeURIComponent(userId)}`);
    return 'loaded';
  });
  for (const [name, path] of READ_CHECKS) {
    await check(name, async () => {
      await call('GET', path);
      return 'loaded';
    });
  }

  // ---- Write checks, confined to one private test channel ----

  if (!CHANNEL_ID) {
    skip(WRITE_CHECKS, 'SMOKE_CHANNEL_ID not set');
    return;
  }
  const channelPath = `/api/channels/${encodeURIComponent(CHANNEL_ID)}/conversations`;
  // Unique per run, so read-backs prove we got this run's message and not an older one.
  const marker = `smoke${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const readContent = async (conversationId, messageId) =>
    (
      await call(
        'GET',
        `/api/conversations/${encodeURIComponent(conversationId)}/message/${encodeURIComponent(messageId)}`
      )
    ).content ?? '';

  let conversationId = '';
  let messageId = '';
  const sent = await check('Send message', async () => {
    const body = await call('POST', channelPath, {
      content: `Automated smoke check ${marker} — safe to ignore`,
    });
    conversationId = body.conversationId ?? '';
    messageId = body.initialMessage?.messageId ?? '';
    if (!conversationId || !messageId) throw new CheckError('response had no message id');
    return 'message created';
  });
  if (!sent) {
    skip(WRITE_CHECKS.slice(1), 'send failed');
    return;
  }

  await check('Read message back', async () => {
    if (!(await readContent(conversationId, messageId)).includes(marker)) {
      throw new CheckError('message content did not match');
    }
    return 'content matches';
  });

  await check('Reply in thread', async () => {
    const reply = await call(
      'POST',
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content: `Automated smoke reply ${marker}` }
    );
    if (!reply.messageId || !reply.conversationId) throw new CheckError('reply had no message id');
    if (!(await readContent(reply.conversationId, reply.messageId)).includes(marker)) {
      throw new CheckError('reply content did not match');
    }
    return 'reply saved and read back';
  });

  await check('Reaction add + remove', async () => {
    const path = `/api/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent('👍')}/toggle`;
    const first = await call('POST', path, {});
    const second = await call('POST', path, {});
    if (first.added !== true || second.added !== false) {
      throw new CheckError(`expected add then remove, got ${first.added} then ${second.added}`);
    }
    return 'added and removed';
  });

  await check('Image upload + download', async () => {
    // Same path the chat composer uses for attachments: multipart `files` on a new message.
    const form = new FormData();
    form.append('content', `Automated smoke image ${marker}`);
    form.append('files', new Blob([TINY_PNG], { type: 'image/png' }), `smoke-${marker}.png`);
    const body = await call('POST', channelPath, form);
    const attachmentId = body.initialMessage?.attachments?.[0]?.id;
    if (!attachmentId) throw new CheckError('message created but no attachment was saved');

    // The file can take a moment to finish landing in storage; retry while it is pending.
    const deadline = Date.now() + ATTACHMENT_READY_WAIT_MS;
    for (;;) {
      const download = await request(`/api/attachments/${encodeURIComponent(attachmentId)}/download`);
      const bytes = (await download.arrayBuffer()).byteLength;
      if (download.ok) {
        if (bytes === 0) throw new CheckError('downloaded file was empty');
        return `uploaded and downloaded (${bytes} bytes)`;
      }
      const pending = download.status === 404 || download.status === 503;
      if (!pending || Date.now() > deadline) throw new CheckError(`download → ${download.status}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  });
}

const ICON = { pass: '✅', fail: '❌', skip: '⏭️' };

function report() {
  const failed = results.filter((r) => r.status === 'fail').length;
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.name.padEnd(32)} ${r.detail}${r.ms ? ` (${r.ms}ms)` : ''}`);
  }
  const verdict = failed === 0 ? 'All checks passed' : `${failed} check(s) failed`;
  console.log(`\n${verdict}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results
      .map((r) => `| ${ICON[r.status]} | ${r.name} | ${r.detail.replace(/\|/g, '\\|')} | ${r.ms || ''} |`)
      .join('\n');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Smoke check — ${EXPECTED_BRANCH || BASE_URL}\n\n| | Check | Detail | ms |\n|---|---|---|---|\n${rows}\n\n**${verdict}**\n`
    );
  }
  return failed === 0 ? 0 : 1;
}

run()
  .catch((error) => {
    results.push({ name: 'Smoke runner', status: 'fail', detail: String(error), ms: 0 });
  })
  .finally(() => {
    process.exitCode = report();
  });
