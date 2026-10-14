import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activeAttachmentsOf,
  hasSoftDeletedAttachmentsOnly,
  isActiveAttachment,
} from '@/src/utils/activeAttachments';

describe('activeAttachments', () => {
  it('filters soft-deleted attachments', () => {
    assert.equal(isActiveAttachment({ isDeleted: true }), false);
    assert.deepEqual(
      activeAttachmentsOf([
        { id: 'keep', isDeleted: false },
        { id: 'gone', isDeleted: true },
      ]),
      [{ id: 'keep', isDeleted: false }],
    );
    assert.equal(hasSoftDeletedAttachmentsOnly([{ id: 'gone', isDeleted: true }]), true);
  });
});
