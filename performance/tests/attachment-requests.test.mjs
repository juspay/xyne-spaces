import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACHMENT_KINDS,
  buildAttachmentPath,
  selectAttachmentIds,
} from '../k6/attachment-requests.mjs';

test('covers the download and thumbnail retrieval paths', () => {
  assert.deepEqual(ATTACHMENT_KINDS, ['download', 'thumbnail']);
});

test('builds the retrieval path for each kind', () => {
  assert.equal(
    buildAttachmentPath('att-123', 'download'),
    '/api/attachments/att-123/download',
  );
  assert.equal(
    buildAttachmentPath('att-123', 'thumbnail'),
    '/api/attachments/att-123/thumbnail',
  );
});

test('encodes the identifier rather than trusting it', () => {
  assert.equal(
    buildAttachmentPath('a/b c', 'download'),
    '/api/attachments/a%2Fb%20c/download',
  );
});

test('rejects an unknown retrieval kind', () => {
  assert.throws(() => buildAttachmentPath('att-1', 'stream'), /unknown attachment kind/i);
});

test('rejects a missing or empty identifier', () => {
  assert.throws(() => buildAttachmentPath('', 'download'), /identifier/i);
  assert.throws(() => buildAttachmentPath(undefined, 'download'), /identifier/i);
});

test('reads attachment identifiers from the fixture identity', () => {
  assert.deepEqual(selectAttachmentIds({ attachmentIds: ['a', 'b'] }), ['a', 'b']);
});

test('reports no identifiers rather than inventing one', () => {
  // There is no safe default: an invented id would 404 and the run would measure
  // the not-found path instead of retrieval.
  assert.deepEqual(selectAttachmentIds({}), []);
  assert.deepEqual(selectAttachmentIds({ attachmentIds: [] }), []);
  assert.deepEqual(selectAttachmentIds({ attachmentIds: ['', '  '] }), []);
});
