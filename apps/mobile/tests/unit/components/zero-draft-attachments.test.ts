import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { zeroDraftAttachmentsToComposerAttachments } from '@/src/components/input-composer/utils/zero-draft-attachments';

describe('zeroDraftAttachmentsToComposerAttachments', () => {
  it('maps synced draft attachments into uploaded composer attachments', () => {
    const mapped = zeroDraftAttachmentsToComposerAttachments([
      {
        id: 'a1',
        originalFilename: 'photo.png',
        mimetype: 'image/png',
        size: 12,
        width: 10,
        height: 20,
        url: 'storage/a1',
        thumbnailUrl: 'storage/a1-thumb',
        isDeleted: false,
      },
    ]);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.attachmentId, 'a1');
    assert.equal(mapped[0]?.status, 'uploaded');
    assert.equal(mapped[0]?.originalFilename, 'photo.png');
    assert.equal(mapped[0]?.width, 10);
    assert.equal(mapped[0]?.localUri, '');
  });

  it('drops deleted attachments', () => {
    const mapped = zeroDraftAttachmentsToComposerAttachments([
      {
        id: 'gone',
        originalFilename: 'x.png',
        mimetype: 'image/png',
        size: 1,
        isDeleted: true,
      },
    ]);
    assert.deepEqual(mapped, []);
  });
});
