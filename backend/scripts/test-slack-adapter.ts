/**
 * Integration test for the Slack-compatible adapter.
 *
 * Run from backend/ directory:
 *
 *   # Step 1 — Test against real Slack API:
 *   SLACK_TOKEN=xoxb-... CHANNEL_ID=C0123456 TARGET_USER_ID=U0123456 npx tsx scripts/test-slack-adapter.ts
 *
 *   # Step 2 — Test against Xyne's Slack adapter (same script, different creds):
 *   SLACK_TOKEN=<xyne-jwt> BASE_URL=http://localhost:3000/api/apps/slack CHANNEL_ID=<xyne-channel-id> TARGET_USER_ID=<xyne-user-id> npx tsx scripts/test-slack-adapter.ts
 *
 *   Optional:
 *     SKIP=files,usergroups   — comma-separated test names to skip
 *
 *   Note: BASE_URL must NOT have a trailing slash.
 */

import { WebClient, LogLevel } from '@slack/web-api';

const TOKEN = "";
const BASE_URL = "";
const CHANNEL_ID = "";
const TARGET_USER_ID = "";
const SKIP = new Set((process.env.SKIP ?? '').split(',').map(s => s.trim()).filter(Boolean));

if (!TOKEN) { console.error('SLACK_TOKEN required'); process.exit(1); }
if (!CHANNEL_ID) { console.error('CHANNEL_ID required'); process.exit(1); }

const clientOpts: Record<string, unknown> = { token: TOKEN, logLevel: LogLevel.ERROR };
if (BASE_URL) {
  (clientOpts as any).slackApiUrl = BASE_URL;
}
const client = new WebClient(TOKEN, clientOpts as any);

const isXyne = !!BASE_URL;

// ── Helpers ─────────────────────────────────────────────────────────

interface TestResult { name: string; pass: boolean; detail: string; duration: number }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<string>) {
  if (SKIP.has(name)) {
    results.push({ name, pass: true, detail: 'SKIPPED', duration: 0 });
    return;
  }
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail, duration: Date.now() - start });
  } catch (err: any) {
    const msg = err?.data?.error ?? err?.message ?? String(err);
    results.push({ name, pass: false, detail: msg, duration: Date.now() - start });
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ── Tests ───────────────────────────────────────────────────────────

let postedTs: string | undefined;

// 1. chat.postMessage — basic
await run('chat.postMessage', async () => {
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: `[test] hello — ${new Date().toISOString()}`,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  assert(typeof res.channel === 'string', 'channel present');
  postedTs = res.ts;
  return `ts=${res.ts} channel=${res.channel}`;
});

// 2. chat.postMessage — thread reply
await run('chat.postMessage (thread)', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '[test] thread reply',
    thread_ts: postedTs,
  });
  assert(res.ok === true, 'ok');
  return `ts=${res.ts} thread_ts=${(res.message as any)?.thread_ts}`;
});

// 3. chat.postMessage — blocks
await run('chat.postMessage (blocks)', async () => {
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Bold test* from blocks' } },
    ],
    text: 'fallback text',
  });
  assert(res.ok === true, 'ok');
  return `ts=${res.ts}`;
});

// 4. chat.update
await run('chat.update', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const res = await client.chat.update({
    channel: CHANNEL_ID,
    ts: postedTs!,
    text: `[test] updated — ${new Date().toISOString()}`,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string', 'ts present');
  return `ts=${res.ts}`;
});

// 5. conversations.history
await run('conversations.history', async () => {
  const res = await client.conversations.history({ channel: CHANNEL_ID, limit: 5 });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.messages), 'messages array');
  assert(res.messages!.length > 0, 'at least 1 message');
  const first = res.messages![0];
  assert(typeof first.ts === 'string', 'msg.ts');
  assert(typeof first.text === 'string', 'msg.text');
  return `${res.messages!.length} messages, has_more=${(res as any).has_more}`;
});

// 6. conversations.replies
await run('conversations.replies', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const res = await client.conversations.replies({ channel: CHANNEL_ID, ts: postedTs!, limit: 10 });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.messages), 'messages array');
  assert(res.messages!.length >= 1, 'at least 1 reply');
  return `${res.messages!.length} messages in thread`;
});

// 7. conversations.info
await run('conversations.info', async () => {
  const res = await client.conversations.info({ channel: CHANNEL_ID });
  assert(res.ok === true, 'ok');
  const ch = res.channel!;
  assert(typeof ch.id === 'string', 'id');
  assert(typeof ch.name === 'string', 'name');
  return `id=${ch.id} name=${ch.name} is_channel=${ch.is_channel} is_private=${ch.is_private} members=${ch.num_members}`;
});

// 8. conversations.list
await run('conversations.list', async () => {
  const res = await client.conversations.list({ limit: 5 });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.channels) && res.channels!.length > 0, 'channels non-empty');
  const ch = res.channels![0];
  assert(typeof ch.id === 'string' && typeof ch.name === 'string', 'channel fields');
  return `${res.channels!.length} channels, first=${ch.name}`;
});

// 9. conversations.list — type filter
await run('conversations.list (private)', async () => {
  const res = await client.conversations.list({ limit: 3, types: 'private_channel' });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.channels), 'channels array');
  const allPrivate = res.channels!.every((c: any) => c.is_private);
  return `${res.channels!.length} channels, all_private=${allPrivate}`;
});

// 10. conversations.open
if (TARGET_USER_ID) {
  await run('conversations.open', async () => {
    const res = await client.conversations.open({ users: TARGET_USER_ID });
    assert(res.ok === true, 'ok');
    assert(typeof res.channel?.id === 'string', 'channel.id');
    return `dm_channel=${res.channel!.id}`;
  });
} else {
  results.push({ name: 'conversations.open', pass: true, detail: 'SKIPPED (no TARGET_USER_ID)', duration: 0 });
}

// 11. users.info
if (TARGET_USER_ID) {
  await run('users.info', async () => {
    const res = await client.users.info({ user: TARGET_USER_ID! });
    assert(res.ok === true, 'ok');
    const u = res.user!;
    assert(typeof u.id === 'string' && typeof u.name === 'string', 'user fields');
    return `id=${u.id} name=${u.name} is_bot=${u.is_bot} deleted=${u.deleted}`;
  });
} else {
  results.push({ name: 'users.info', pass: true, detail: 'SKIPPED (no TARGET_USER_ID)', duration: 0 });
}

// 12. usergroups.list
await run('usergroups.list', async () => {
  const res = await client.usergroups.list();
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.usergroups), 'usergroups array');
  return `${res.usergroups!.length} groups`;
});

// 13. files.uploadV2 (modern 3-step flow — works on both real Slack and Xyne)
await run('files.upload', async () => {
  const content = `test file — ${new Date().toISOString()}`;
  const res = await client.files.uploadV2({
    channel_id: CHANNEL_ID,
    content,
    filename: 'test-slack-adapter.txt',
    title: 'Test Upload',
    initial_comment: '[test] file upload v2',
  });
  assert(res.ok === true, 'ok');
  return `uploaded via v2`;
});

// ── Error cases ─────────────────────────────────────────────────────

await run('error: invalid channel', async () => {
  try {
    await client.conversations.info({ channel: 'NONEXISTENT_CHANNEL_12345' });
    throw new Error('Should have thrown');
  } catch (err: any) {
    const code = err?.data?.error ?? err?.message;
    assert(code === 'channel_not_found' || code?.includes('channel_not_found'), `expected channel_not_found, got: ${code}`);
    return `error=${code}`;
  }
});

await run('error: missing text', async () => {
  try {
    await client.chat.postMessage({ channel: CHANNEL_ID, text: '' });
    throw new Error('Should have thrown');
  } catch (err: any) {
    const code = err?.data?.error ?? err?.message;
    return `error=${code}`;
  }
});

// ── Report ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log(`  Slack Adapter Test — ${isXyne ? 'XYNE' : 'REAL SLACK'}`);
console.log(`  Target: ${BASE_URL ?? 'https://slack.com/api'}`);
console.log('='.repeat(70));

let passed = 0, failed = 0, skipped = 0;

for (const r of results) {
  if (r.detail.startsWith('SKIPPED')) {
    skipped++;
    console.log(`  SKIP  ${r.name} — ${r.detail}`);
  } else if (r.pass) {
    passed++;
    console.log(`  PASS  ${r.name} (${r.duration}ms) — ${r.detail}`);
  } else {
    failed++;
    console.log(`  FAIL  ${r.name} (${r.duration}ms) — ${r.detail}`);
  }
}

console.log('='.repeat(70));
console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log('='.repeat(70) + '\n');

if (failed > 0) process.exit(1);
