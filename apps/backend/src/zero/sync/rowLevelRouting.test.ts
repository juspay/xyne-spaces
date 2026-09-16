import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedRowLevel, routeDelta, projectDeltaForUser, type RowLevelMeta } from './rowLevelRouting';
import { rowKey, type CompactedRow, type Row, type StreamDiff } from './streamState';

const META: RowLevelMeta = {
  rootTable: 'draft_messages',
  routeColumn: 'userId',
  childLinks: [{ childTable: 'message_attachments', childColumn: 'entityId', parentColumn: 'id' }],
};
const PK = { draft_messages: ['id'], message_attachments: ['id'] } as const;

const cr = (tableName: string, row: Row): CompactedRow => ({ tableName, row });
const put = (tableName: string, row: Row) => ({ key: rowKey(tableName, row, PK), tableName, row });
const diff = (over: Partial<StreamDiff>): StreamDiff => ({ upserts: [], deletes: [], cleared: false, ...over });

// ── seed ──────────────────────────────────────────────────────────────────────────────────────────

test('seedRowLevel: roots own themselves; related follow their parent; orphan related dropped', () => {
  const rows = [
    cr('draft_messages', { id: 'D1', userId: 'U1' }),
    cr('draft_messages', { id: 'D2', userId: 'U2' }),
    cr('message_attachments', { id: 'A1', entityId: 'D1' }), // → U1 (via D1)
    cr('message_attachments', { id: 'A9', entityId: 'DX' }), // orphan (no parent) → dropped
  ];
  const { ownerMap, buckets } = seedRowLevel(rows, META, PK);
  assert.equal(ownerMap.get('draft_messages:D1'), 'U1');
  assert.equal(ownerMap.get('draft_messages:D2'), 'U2');
  assert.equal(ownerMap.get('message_attachments:A1'), 'U1');
  assert.equal(ownerMap.has('message_attachments:A9'), false);
  assert.deepEqual(buckets.get('U1')?.map((c) => c.row.id).sort(), ['A1', 'D1']);
  assert.deepEqual(buckets.get('U2')?.map((c) => c.row.id), ['D2']);
});

// ── routeDelta: puts ────────────────────────────────────────────────────────────────────────────

test('routeDelta: a root put routes to its owner and indexes the row', () => {
  const owner = new Map<string, string>();
  const r = routeDelta(diff({ upserts: [put('draft_messages', { id: 'D3', userId: 'U1' })] }), owner, META, PK);
  assert.deepEqual(r.perUser.get('U1')?.upserts.map((u) => u.row.id), ['D3']);
  assert.equal(owner.get('draft_messages:D3'), 'U1');
  assert.equal(r.unroutablePuts, 0);
});

test('routeDelta: a related put resolves its parent from the SAME delta (roots processed first)', () => {
  const owner = new Map<string, string>();
  const r = routeDelta(
    diff({
      upserts: [
        put('message_attachments', { id: 'A4', entityId: 'D4' }), // listed before its parent
        put('draft_messages', { id: 'D4', userId: 'U2' }),
      ],
    }),
    owner,
    META,
    PK,
  );
  assert.deepEqual(r.perUser.get('U2')?.upserts.map((u) => u.row.id).sort(), ['A4', 'D4']);
  assert.equal(r.unroutablePuts, 0);
  assert.equal(owner.get('message_attachments:A4'), 'U2');
});

test('routeDelta: a related put resolves its parent from a PRIOR delta (live map)', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const r = routeDelta(diff({ upserts: [put('message_attachments', { id: 'A2', entityId: 'D1' })] }), owner, META, PK);
  assert.deepEqual(r.perUser.get('U1')?.upserts.map((u) => u.row.id), ['A2']);
});

test('routeDelta: a related put whose parent is unknown is DROPPED fail-closed', () => {
  const owner = new Map<string, string>();
  const r = routeDelta(diff({ upserts: [put('message_attachments', { id: 'A3', entityId: 'DZ' })] }), owner, META, PK);
  assert.equal(r.perUser.size, 0);
  assert.equal(r.unroutablePuts, 1);
  assert.equal(owner.has('message_attachments:A3'), false);
});

// ── routeDelta: deletes (R-2: PK-only, routed via the owner map) ────────────────────────────────

test('routeDelta: a delete routes via the owner map and forgets the key', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const r = routeDelta(diff({ deletes: ['draft_messages:D1'] }), owner, META, PK);
  assert.deepEqual(r.perUser.get('U1')?.deletes, ['draft_messages:D1']);
  assert.equal(owner.has('draft_messages:D1'), false);
  assert.equal(r.unroutableDels, 0);
});

test('routeDelta: a delete with no map entry is DROPPED fail-closed (never broadcast)', () => {
  const owner = new Map<string, string>();
  const r = routeDelta(diff({ deletes: ['draft_messages:DZZ'] }), owner, META, PK);
  assert.equal(r.perUser.size, 0);
  assert.equal(r.unroutableDels, 1);
});

// ── routeDelta: owner change (defensive — owner columns immutable in practice) ───────────────────

test('routeDelta: a root owner change emits delete-to-old + put-to-new and counts the change', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const r = routeDelta(diff({ upserts: [put('draft_messages', { id: 'D1', userId: 'U2' })] }), owner, META, PK);
  assert.deepEqual(r.perUser.get('U1')?.deletes, ['draft_messages:D1']);
  assert.deepEqual(r.perUser.get('U2')?.upserts.map((u) => u.row.id), ['D1']);
  assert.equal(owner.get('draft_messages:D1'), 'U2');
  assert.equal(r.ownerChanges, 1);
});

test('routeDelta: a root put with a null routeColumn is UNROUTABLE (not a "null" owner bucket)', () => {
  const owner = new Map<string, string>();
  const r = routeDelta(diff({ upserts: [put('draft_messages', { id: 'D7', userId: null })] }), owner, META, PK);
  assert.equal(r.perUser.size, 0);
  assert.equal(r.unroutablePuts, 1);
  assert.equal(owner.has('draft_messages:D7'), false);
});

test('routeDelta: a same-owner re-put does NOT count as an owner change', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const r = routeDelta(diff({ upserts: [put('draft_messages', { id: 'D1', userId: 'U1' })] }), owner, META, PK);
  assert.equal(r.ownerChanges, 0);
});

// ── projectDeltaForUser (resume, read-only) ─────────────────────────────────────────────────────

test('projectDeltaForUser: a put-only range projects the user slice without mutating the map', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const d = diff({
    upserts: [put('draft_messages', { id: 'D5', userId: 'U1' }), put('draft_messages', { id: 'D6', userId: 'U2' })],
  });
  const slice = projectDeltaForUser(d, owner, META, PK, 'U1');
  assert.deepEqual(slice?.upserts.map((u) => u.row.id), ['D5']);
  assert.equal(owner.has('draft_messages:D5'), false); // read-only — not indexed
});

test('projectDeltaForUser: an unroutable delete in the range returns null (→ snapshot fallback)', () => {
  const owner = new Map<string, string>(); // D1 already deleted since sinceOffset → not in map
  const slice = projectDeltaForUser(diff({ deletes: ['draft_messages:D1'] }), owner, META, PK, 'U1');
  assert.equal(slice, null);
});

test('projectDeltaForUser: a routable delete projects to the owning user', () => {
  const owner = new Map([['draft_messages:D1', 'U1']]);
  const slice = projectDeltaForUser(diff({ deletes: ['draft_messages:D1'] }), owner, META, PK, 'U1');
  assert.deepEqual(slice?.deletes, ['draft_messages:D1']);
});
