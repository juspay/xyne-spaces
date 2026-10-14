import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IncomingSharePayload } from '@/src/features/share-target/nativeShareTarget';
import {
  isLocalFilePathShareText,
  sanitizeIncomingSharePayload,
} from '@/src/features/share-target/sanitizeIncomingSharePayload';

const payload = (overrides: Partial<IncomingSharePayload>): IncomingSharePayload => ({
  id: 'share-1',
  source: 'ios',
  receivedAt: 1,
  files: [],
  ...overrides,
});

describe('sanitizeIncomingSharePayload', () => {
  it('detects file:// and absolute filesystem paths', () => {
    assert.equal(isLocalFilePathShareText('file:///var/mobile/Containers/Data/doc.pdf'), true);
    assert.equal(isLocalFilePathShareText('/private/var/mobile/Containers/Data/doc.pdf'), true);
    assert.equal(isLocalFilePathShareText('https://example.com/doc.pdf'), false);
    assert.equal(isLocalFilePathShareText('Please review this'), false);
    assert.equal(isLocalFilePathShareText('/cc team'), false);
    assert.equal(isLocalFilePathShareText('/tmp/notes.'), false);
  });

  it('strips file path text left by the iOS share extension', () => {
    const next = sanitizeIncomingSharePayload(
      payload({
        text: 'file:///var/mobile/Containers/Shared/AppGroup/doc.pdf',
        files: [
          {
            uri: 'file:///app-group/share-target/x/doc.pdf',
            name: 'doc.pdf',
            type: 'application/pdf',
            size: 12,
          },
        ],
      }),
    );
    assert.equal(next.text, null);
    assert.equal(next.files.length, 1);
  });

  it('keeps real captions and remote links', () => {
    const next = sanitizeIncomingSharePayload(
      payload({
        text: 'Please review\nhttps://example.com/doc.pdf',
      }),
    );
    assert.equal(next.text, 'Please review\nhttps://example.com/doc.pdf');
  });
});
