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
const TARGET_USER_EMAIL = "";
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
let fileUploadTs: string | undefined;
let threadFileUploadTs: string | undefined;

// 1. chat.postMessage — basic + response shape
await run('chat.postMessage', async () => {
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: `[test] hello — ${new Date().toISOString()}`,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  assert(typeof res.channel === 'string', 'channel present');
  // response shape: must match Slack spec
  const msg = res.message as any;
  assert(typeof msg?.ts === 'string' && msg.ts === res.ts, 'message.ts matches top-level ts');
  assert(msg?.type === 'message', 'message.type=message');
  assert(typeof msg?.bot_id === 'string', 'message.bot_id present');
  assert(!('thread_ts' in msg), 'message must NOT contain thread_ts for non-reply');
  postedTs = res.ts;
  return `ts=${res.ts} channel=${res.channel}`;
});

// 2. chat.postMessage — thread reply (ts from step 1 used as thread_ts)
await run('chat.postMessage (thread reply)', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '[test] thread reply',
    thread_ts: postedTs,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  // response shape: thread replies also must NOT have thread_ts in message
  const msg = res.message as any;
  assert(typeof msg?.ts === 'string' && msg.ts === res.ts, 'message.ts matches top-level ts');
  assert(!('thread_ts' in msg), 'message must NOT contain thread_ts even for thread reply');
  return `ts=${res.ts} (reply to ${postedTs})`;
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

// 4. chat.postMessage — Slack formatting in plain text
await run('chat.postMessage (formatting)', async () => {
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: [
      '[test] formatting body',
      '*bold text*',
      '_italic text_',
      '~strikethrough text~',
      '<u>underline html fallback</u>',
      '`inline code`',
      '```',
      'const adapter = "slack-compatible";',
      'console.log(adapter);',
      '```',
      '<https://example.com/slack-adapter|labeled link>',
      'https://example.com/plain-link',
      '- bullet one',
      '- bullet two',
      '1. ordered one',
      '2. ordered two',
      '> quoted line',
    ].join('\n'),
    mrkdwn: true,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  return `ts=${res.ts}`;
});

// 5. chat.postMessage — Slack formatting inside blocks
await run('chat.postMessage (block formatting)', async () => {
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '[test] block formatting fallback',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*Bold* _italic_ ~strike~ `inline code` <u>underline html fallback</u>',
            '<https://example.com/block-link|block labeled link>',
            '- block bullet one',
            '- block bullet two',
            '```',
            'function blockFormatting() {',
            '  return "ok";',
            '}',
            '```',
          ].join('\n'),
        },
      },
    ],
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  return `ts=${res.ts}`;
});

// 6. chat.postMessage — Slack mentions from returned IDs
if (TARGET_USER_ID) {
  await run('chat.postMessage (mentions)', async () => {
    const res = await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `[test] mention body — user=<@${TARGET_USER_ID}> channel=<#${CHANNEL_ID}|adapter-test> broadcast=<!channel> here=<!here>`,
      mrkdwn: true,
    });
    assert(res.ok === true, 'ok');
    assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
    return `ts=${res.ts}`;
  });
} else {
  results.push({ name: 'chat.postMessage (mentions)', pass: true, detail: 'SKIPPED (no TARGET_USER_ID)', duration: 0 });
}

// 7. chat.postMessage — Slack mentions inside blocks
if (TARGET_USER_ID) {
  await run('chat.postMessage (block mentions)', async () => {
    const res = await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `[test] block mention fallback for <@${TARGET_USER_ID}>`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Mention block:* <@${TARGET_USER_ID}> please check <#${CHANNEL_ID}|adapter-test>`,
          },
        },
      ],
    });
    assert(res.ok === true, 'ok');
    assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
    return `ts=${res.ts}`;
  });
} else {
  results.push({ name: 'chat.postMessage (block mentions)', pass: true, detail: 'SKIPPED (no TARGET_USER_ID)', duration: 0 });
}

// 8. chat.postMessage — Slack mentions inside attachments
if (TARGET_USER_ID) {
  await run('chat.postMessage (attachment mentions)', async () => {
    const res = await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: '[test] attachment mention fallback',
      attachments: [
        {
          color: 'warning',
          pretext: `Attention <@${TARGET_USER_ID}>`,
          title: 'Adapter mention test',
          text: `Please review <#${CHANNEL_ID}|adapter-test>. <!here>`,
          fields: [
            {
              title: 'Owner',
              value: `<@${TARGET_USER_ID}>`,
              short: true,
            },
          ],
        },
      ],
    });
    assert(res.ok === true, 'ok');
    assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
    return `ts=${res.ts}`;
  });
} else {
  results.push({ name: 'chat.postMessage (attachment mentions)', pass: true, detail: 'SKIPPED (no TARGET_USER_ID)', duration: 0 });
}

// 9. chat.update
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

// 10. conversations.history
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

// 11. conversations.replies
await run('conversations.replies', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const res = await client.conversations.replies({ channel: CHANNEL_ID, ts: postedTs!, limit: 10 });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.messages), 'messages array');
  assert(res.messages!.length >= 1, 'at least 1 reply');
  return `${res.messages!.length} messages in thread`;
});

// 12. conversations.info
await run('conversations.info', async () => {
  const res = await client.conversations.info({ channel: CHANNEL_ID });
  assert(res.ok === true, 'ok');
  const ch = res.channel!;
  assert(typeof ch.id === 'string', 'id');
  assert(typeof ch.name === 'string', 'name');
  return `id=${ch.id} name=${ch.name} is_channel=${ch.is_channel} is_private=${ch.is_private} members=${ch.num_members}`;
});

// 13. conversations.list
await run('conversations.list', async () => {
  const res = await client.conversations.list({ limit: 5 });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.channels) && res.channels!.length > 0, 'channels non-empty');
  const ch = res.channels![0];
  assert(typeof ch.id === 'string' && typeof ch.name === 'string', 'channel fields');
  return `${res.channels!.length} channels, first=${ch.name}`;
});

// 14. conversations.list — type filter
await run('conversations.list (private)', async () => {
  const res = await client.conversations.list({ limit: 3, types: 'private_channel' });
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.channels), 'channels array');
  const allPrivate = res.channels!.every((c: any) => c.is_private);
  return `${res.channels!.length} channels, all_private=${allPrivate}`;
});

// 15. conversations.open
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

// 16. users.info
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

// 17. users.lookupByEmail
if (TARGET_USER_EMAIL) {
  await run('users.lookupByEmail', async () => {
    const res = await client.users.lookupByEmail({ email: TARGET_USER_EMAIL! });
    assert(res.ok === true, 'ok');
    const u = res.user!;
    assert(typeof u.id === 'string' && typeof u.name === 'string', 'user fields');
    assert(u.id === TARGET_USER_ID, 'id matches');
    return `id=${u.id} name=${u.name} is_bot=${u.is_bot}`;
  });
} else {
  results.push({ name: 'users.lookupByEmail', pass: true, detail: 'SKIPPED (no TARGET_USER_EMAIL)', duration: 0 });
}

// 18. usergroups.list
await run('usergroups.list', async () => {
  const res = await client.usergroups.list();
  assert(res.ok === true, 'ok');
  assert(Array.isArray(res.usergroups), 'usergroups array');
  return `${res.usergroups!.length} groups`;
});

// 19. files.uploadV2 (modern 3-step flow — works on both real Slack and Xyne)
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
  // grab the file message ts from history; use `oldest=postedTs` so we only
  // see messages posted after the initial chat.postMessage, making the lookup
  // stable even if other messages arrive between the upload and the fetch.
  const hist = await client.conversations.history({ channel: CHANNEL_ID, oldest: postedTs, limit: 10 });
  fileUploadTs = hist.messages?.at(-1)?.ts; // oldest message in the window = the file upload
  assert(typeof fileUploadTs === 'string' && fileUploadTs.length > 0, 'fileUploadTs found');
  return `uploaded via v2, fileUploadTs=${fileUploadTs}`;
});

// 20. files.uploadV2 — upload file as thread reply (uses ts from test 1)
await run('files.upload (in thread)', async () => {
  assert(!!postedTs, 'need ts from postMessage');
  const content = `thread file — ${new Date().toISOString()}`;
  const res = await client.files.uploadV2({
    channel_id: CHANNEL_ID,
    thread_ts: postedTs!,
    content,
    filename: 'thread-file.txt',
    title: 'Thread File Upload',
    initial_comment: '[test] file upload in thread',
  });
  assert(res.ok === true, 'ok');
  const replies = await client.conversations.replies({
    channel: CHANNEL_ID,
    ts: postedTs!,
    limit: 10,
  });
  threadFileUploadTs = replies.messages?.at(-1)?.ts;
  const lastReply = replies.messages?.at(-1) as any;
  assert(typeof threadFileUploadTs === 'string' && threadFileUploadTs.length > 0, 'thread file upload ts found');
  assert(lastReply?.thread_ts === postedTs, 'reply thread_ts matches parent post ts');
  return `uploaded in thread of ${postedTs}, ts=${threadFileUploadTs}`;
});

// 21. chat.postMessage — follow-up reply on file upload thread (uses ts from test 19)
await run('chat.postMessage (follow-up on file thread)', async () => {
  assert(!!fileUploadTs, 'need fileUploadTs from files.upload');
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '[test] follow-up reply on file upload message',
    thread_ts: fileUploadTs,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  const msg = res.message as any;
  assert(typeof msg?.ts === 'string' && msg.ts === res.ts, 'message.ts matches top-level ts');
  assert(!('thread_ts' in msg), 'message must NOT contain thread_ts');
  return `ts=${res.ts} (follow-up on file ${fileUploadTs})`;
});

// 22. files.uploadV2 — upload another file as reply to file upload message
await run('files.upload (follow-up on file thread)', async () => {
  assert(!!fileUploadTs, 'need fileUploadTs from files.upload');
  const content = `file-on-file-thread — ${new Date().toISOString()}`;
  const res = await client.files.uploadV2({
    channel_id: CHANNEL_ID,
    thread_ts: fileUploadTs!,
    content,
    filename: 'file-thread-followup.txt',
    title: 'File Thread Follow-up Upload',
    initial_comment: '[test] file upload reply on file thread',
  });
  assert(res.ok === true, 'ok');
  return `uploaded in thread of file ${fileUploadTs}`;
});

// 23. chat.postMessage — follow-up reply on thread-file upload message
await run('chat.postMessage (follow-up on thread file)', async () => {
  assert(!!threadFileUploadTs, 'need threadFileUploadTs from files.upload in thread');
  const res = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '[test] follow-up reply on thread file upload message',
    thread_ts: threadFileUploadTs,
  });
  assert(res.ok === true, 'ok');
  assert(typeof res.ts === 'string' && res.ts.length > 0, 'ts non-empty');
  return `ts=${res.ts} (follow-up on thread file ${threadFileUploadTs})`;
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

if (isXyne) {
  await run('error: msg_too_long', async () => {
    try {
      await client.chat.postMessage({ channel: CHANNEL_ID, text: 'x'.repeat(10001) });
      throw new Error('Should have thrown');
    } catch (err: any) {
      const code = err?.data?.error ?? err?.message;
      assert(code === 'msg_too_long' || code?.includes('msg_too_long'), `expected msg_too_long, got: ${code}`);
      return `error=${code}`;
    }
  });

  await run('error: postMessage invalid thread_ts', async () => {
    try {
      await client.chat.postMessage({
        channel: CHANNEL_ID,
        text: '[test] invalid thread',
        thread_ts: 'NONEXISTENT_THREAD_TS',
      });
      throw new Error('Should have thrown');
    } catch (err: any) {
      const code = err?.data?.error ?? err?.message;
      assert(code === 'thread_not_found' || code?.includes('thread_not_found'), `expected thread_not_found, got: ${code}`);
      return `error=${code}`;
    }
  });

  await run('error: files.upload invalid thread_ts', async () => {
    try {
      await client.files.uploadV2({
        channel_id: CHANNEL_ID,
        thread_ts: 'NONEXISTENT_THREAD_TS',
        content: 'invalid-thread-file',
        filename: 'invalid-thread.txt',
        title: 'Invalid Thread Upload',
      });
      throw new Error('Should have thrown');
    } catch (err: any) {
      const code = err?.data?.error ?? err?.message;
      assert(code === 'thread_not_found' || code?.includes('thread_not_found'), `expected thread_not_found, got: ${code}`);
      return `error=${code}`;
    }
  });
} else {
  results.push({ name: 'error: msg_too_long', pass: true, detail: 'SKIPPED (Xyne-specific 10k cap)', duration: 0 });
  results.push({ name: 'error: postMessage invalid thread_ts', pass: true, detail: 'SKIPPED (Xyne-specific)', duration: 0 });
  results.push({ name: 'error: files.upload invalid thread_ts', pass: true, detail: 'SKIPPED (Xyne-specific)', duration: 0 });
}

await run('error: lookupByEmail not found', async () => {
  try {
    await client.users.lookupByEmail({ email: 'nonexistent.user@example.com' });
    throw new Error('Should have thrown');
  } catch (err: any) {
    const code = err?.data?.error ?? err?.message;
    assert(code === 'users_not_found' || code?.includes('users_not_found'), `expected users_not_found, got: ${code}`);
    return `error=${code}`;
  }
});

await run('error: lookupByEmail invalid email', async () => {
  try {
    await client.users.lookupByEmail({ email: 'not-an-email' });
    throw new Error('Should have thrown');
  } catch (err: any) {
    const code = err?.data?.error ?? err?.message;
    assert(code === 'invalid_arguments' || code?.includes('invalid'), `expected validation error, got: ${code}`);
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
