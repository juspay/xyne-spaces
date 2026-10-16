/** Runs against a disposable database on a LOCAL PostgreSQL instance only.
 * FEED_TEST_ADMIN_URL=postgresql://...@127.0.0.1:5433/postgres node tests/feed.integration.mjs
 * Uses real PostgreSQL, Express, and feed routes; source-chat and object storage are fixtures.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'package.json'));
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const supertest = require('supertest');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const url = new URL(process.env.FEED_TEST_ADMIN_URL ?? '');
assert(
  ['127.0.0.1', 'localhost'].includes(url.hostname),
  'This runner only accepts local PostgreSQL.'
);
const admin = new Pool({ connectionString: url.href });
const database = `feed_test_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE DATABASE "${database}"`);
url.pathname = `/${database}`;
const pool = new Pool({ connectionString: url.href });
const temp = await mkdtemp(resolve(tmpdir(), 'feed-api-test-'));
const files = new Map([['original/image', Buffer.from('feed image bytes')]]);
const users = [
  { id: 'alice', workspaceId: 'workspace1', name: 'Alice', role: 'MEMBER' },
  { id: 'bob', workspaceId: 'workspace1', name: 'Bob', role: 'MEMBER' },
  { id: 'admin', workspaceId: 'workspace1', name: 'Admin', role: 'ADMIN' },
  {
    id: 'outsider',
    workspaceId: 'workspace2',
    name: 'Outsider',
    role: 'MEMBER',
  },
];
const message = {
  messageId: 'message1',
  conversationId: 'conversation1',
  senderId: 'alice',
  workspaceId: 'workspace1',
  content: '<p>Private launch photo</p>',
  createdAt: new Date('2026-10-14T10:00:00Z'),
  isDeleted: false,
  isSent: true,
  msgType: 'USER',
  visibleTo: null,
  sender: { id: 'alice', name: 'Alice', displayName: null },
};
const attachment = {
  id: 'attachment1',
  workspaceId: 'workspace1',
  entityId: 'message1',
  entityType: 'CHAT',
  conversationId: 'conversation1',
  originalFilename: 'photo.png',
  mimetype: 'image/png',
  size: files.get('original/image').length,
  url: 'original/image',
  uploadStatus: 'COMPLETED',
  metadata: null,
};
const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
const mockedModels = {
  user: {
    findFirst: async ({ where }) => {
      const user = users.find((u) => u.id === where.id && u.workspaceId === where.workspaceId);
      return user ? { ...user, workspace: { name: 'Design' } } : null;
    },
  },
  conversation: {
    findFirst: async ({ where }) =>
      where.conversationId === 'conversation1' && where.workspaceId === 'workspace1'
        ? {
            conversationId: 'conversation1',
            channelId: 'private1',
            channel: {
              workspaceId: 'workspace1',
              visibility: 'PRIVATE',
              scopeType: 'DM',
            },
          }
        : null,
  },
  channelParticipant: {
    findFirst: async ({ where }) => (where.userId === 'alice' ? { id: 'member1' } : null),
  },
  message: {
    findFirst: async () => message,
    findMany: async ({ where }) =>
      !message.isDeleted && (!where.messageId || where.messageId.in.includes(message.messageId))
        ? [message]
        : [],
  },
  messageAttachment: { findMany: async () => [attachment] },
};
const db = new Proxy(prisma, {
  get(target, key) {
    if (typeof key === 'string' && key in mockedModels) return mockedModels[key];
    return Reflect.get(target, key, target);
  },
});
const storage = {
  getFileMetadata: async (path) => ({ size: files.get(path)?.length }),
  createReadStream: async (path, range) => {
    const bytes = files.get(path);
    if (!bytes) throw Error('Missing object');
    return Readable.from(range ? bytes.subarray(range.start, range.end + 1) : bytes);
  },
  uploadStreamToPath: async (stream, { path }) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    files.set(path, Buffer.concat(chunks));
  },
  deleteFile: async (path) => {
    files.delete(path);
  },
};
globalThis.__feedTest = { db, storage };
try {
  await pool.query(
    'CREATE SCHEMA non_zero; CREATE TABLE users (id text primary key, name text, "displayName" text)'
  );
  for (const user of users)
    await pool.query('INSERT INTO users (id,name) VALUES ($1,$2)', [user.id, user.name]);
  await pool.query(
    await readFile(
      resolve(root, 'prisma/migrations/20261014120000_workspace_feed/migration.sql'),
      'utf8'
    )
  );
  await symlink(resolve(root, 'node_modules'), resolve(temp, 'node_modules'));
  await build({
    entryPoints: [resolve(root, 'src/routes/feed.ts')],
    outfile: resolve(temp, 'feed.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'fixtures',
        setup(builder) {
          const fixtures = {
            '@xyne/storage': 'export const normalizeStoragePath=(path)=>path;',
            './base':
              'export const rawQuery=(_tables,_reason,fn)=>fn(); export const transaction=(_tables,_reason,client,fn)=>client.$transaction(fn);',
            '../database/client': 'export const db=globalThis.__feedTest.db;',
            '../services/storage/index':
              'export const storageService=globalThis.__feedTest.storage; export const getStorageService=()=>storageService;',
            '../config/env': 'export const config={gcs:{transcriptionBucketName:"test"}};',
            '../services/attachmentAccessService':
              'export const assertAttachmentAccess=async (_a,user)=>({ok:user==="alice"});',
            '../utils/logger': 'export const logger={error:console.error,warn:console.warn};',
          };
          builder.onResolve({ filter: /.*/ }, (args) =>
            fixtures[args.path] ? { path: args.path, namespace: 'fixture' } : undefined
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: fixtures[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  process.env.WORKSPACE_FEED_ENABLED = 'true';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = users.find((u) => u.id === req.headers['x-test-user']);
    next();
  });
  app.use('/api/feed', require(resolve(temp, 'feed.cjs')).default);
  const api = supertest(app);
  const base = '/api/feed/workspaces/workspace1';
  const get = (path, user = 'alice') => api.get(base + path).set('x-test-user', user);
  const post = (path, body, user = 'alice') =>
    api
      .post(base + path)
      .set('x-test-user', user)
      .send(body);
  await get('/posts', 'outsider').expect(403);
  await get('/source/conversation1', 'bob').expect(403);
  const preview = (await get('/source/conversation1?selected=message1').expect(200)).body;
  assert.equal(preview.messages[0].media[0].filename, 'photo.png');
  const publication = {
    body: 'A new milestone',
    requestId: randomUUID(),
    conversationId: 'conversation1',
    messageIds: ['message1'],
    revisions: { message1: preview.messages[0].revision },
    confirmWorkspacePublication: true,
  };
  await post('/posts', {
    ...publication,
    confirmWorkspacePublication: false,
  }).expect(400);
  await post('/posts', {
    ...publication,
    revisions: { message1: 'stale' },
  }).expect(409);
  await post('/posts', publication, 'bob').expect(403);
  const first = (await post('/posts', publication).expect(201)).body;
  const retry = (await post('/posts', publication).expect(200)).body;
  assert.equal(first.id, retry.id);
  const feed = (await get('/posts', 'bob').expect(200)).body;
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].excerpts[0].text, 'Private launch photo');
  assert(!JSON.stringify(feed).includes('original/image'));
  assert(!JSON.stringify(feed).includes('private1'));
  const mediaId = feed.posts[0].excerpts[0].media[0].id;
  files.delete('original/image'); // Published copy survives deletion of original bytes.
  const media = await get(`/media/${mediaId}`, 'bob').expect(200);
  assert.equal(media.body.toString(), 'feed image bytes');
  await get(`/media/${mediaId}`, 'outsider').expect(403);
  const partial = await get(`/media/${mediaId}`, 'bob').set('Range', 'bytes=0-3').expect(206);
  assert.equal(partial.body.toString(), 'feed');
  await get(`/media/${mediaId}`, 'bob').set('Range', 'bytes=999-').expect(416);
  await api
    .patch(base + `/posts/${first.id}`)
    .set('x-test-user', 'bob')
    .send({ body: 'forged edit' })
    .expect(403);
  await api
    .patch(base + `/posts/${first.id}`)
    .set('x-test-user', 'alice')
    .send({ body: 'Updated' })
    .expect(200);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      api
        .put(base + `/posts/${first.id}/like`)
        .set('x-test-user', 'bob')
        .send({ liked: true })
        .expect(200)
    )
  );
  assert.equal((await get('/posts', 'bob')).body.posts[0].likeCount, 1);
  const commentBody = { body: 'Great work', requestId: randomUUID() };
  const comment = (await post(`/posts/${first.id}/comments`, commentBody, 'bob').expect(200)).body;
  await post(`/posts/${first.id}/comments`, commentBody, 'bob').expect(200);
  assert.equal((await get(`/posts/${first.id}/comments`)).body.comments.length, 1);
  await api
    .patch(base + `/posts/${first.id}/comments/${comment.id}`)
    .set('x-test-user', 'alice')
    .send({ body: 'forged comment edit' })
    .expect(404);
  await post(`/posts/${first.id}/report`, { reason: 'Sensitive material' }, 'bob').expect(200);
  await get('/reports', 'bob').expect(403);
  assert.equal((await get('/reports', 'admin').expect(200)).body.length, 1);
  await api
    .delete(base + `/posts/${first.id}`)
    .set('x-test-user', 'bob')
    .expect(403);
  await api
    .delete(base + `/posts/${first.id}`)
    .set('x-test-user', 'admin')
    .expect(200);
  await get(`/media/${mediaId}`, 'bob').expect(404);
  await get(`/posts/${first.id}/comments`, 'bob').expect(404);
  assert.equal((await get('/posts')).body.posts.length, 0);
  assert.equal(files.size, 0);
  console.log(
    'PASS: migration, tenant isolation, source access, consent/revision checks, publication retries, copied media, range reads, ownership, concurrent likes, comment retries, reports, and deletion.'
  );
} finally {
  await prisma.$disconnect();
  await pool.end();
  await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
  await rm(temp, { recursive: true, force: true });
  delete globalThis.__feedTest;
}
