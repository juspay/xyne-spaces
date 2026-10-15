import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyUploadResultsToAttachments,
  getFirstUploadFailure,
} from '@/src/components/input-composer/utils/attachments';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import {
  assertAttachmentCountWithinLimit,
  getAttachmentRejectionReason,
  getRemainingAttachmentSlots,
  MAX_COMPOSER_ATTACHMENT_COUNT,
} from '@/src/components/input-composer/utils/attachmentPolicy';

const attachment = (over: Partial<ComposerAttachment>): ComposerAttachment =>
  ({ attachmentId: 'a1', status: 'uploading', ...over }) as unknown as ComposerAttachment;

describe('applyUploadResultsToAttachments', () => {
  it('marks matched attachments uploaded or failed', () => {
    const out = applyUploadResultsToAttachments(
      [attachment({ attachmentId: 'a1' }), attachment({ attachmentId: 'a2' })],
      [
        { success: true, attachmentId: 'a1' },
        { success: false, attachmentId: 'a2', error: 'boom' },
      ],
    );

    assert.equal(out[0]?.status, 'uploaded');
    assert.equal(out[0]?.error, undefined);
    assert.equal(out[1]?.status, 'failed');
    assert.equal(out[1]?.error, 'boom');
  });

  it('leaves attachments without a matching result untouched', () => {
    const input = attachment({ attachmentId: 'a3', status: 'uploading' });
    const out = applyUploadResultsToAttachments(
      [input],
      [{ success: true, attachmentId: 'other' }],
    );
    assert.deepEqual(out[0], input);
  });
});

describe('getFirstUploadFailure', () => {
  it('returns the error of the first failed result', () => {
    assert.equal(
      getFirstUploadFailure([
        { success: true, attachmentId: 'a1' },
        { success: false, attachmentId: 'a2', error: 'first' },
        { success: false, attachmentId: 'a3', error: 'second' },
      ]),
      'first',
    );
  });

  it('returns undefined when everything succeeded', () => {
    assert.equal(getFirstUploadFailure([{ success: true, attachmentId: 'a1' }]), undefined);
  });
});

describe('attachment policy', () => {
  it('allows up to ten total attachments and reports remaining slots', () => {
    assertAttachmentCountWithinLimit(8, 2);
    assert.equal(getRemainingAttachmentSlots(8), 2);
    assert.equal(MAX_COMPOSER_ATTACHMENT_COUNT, 10);
  });

  it('rejects an over-limit selection instead of silently dropping files', () => {
    assert.throws(() => assertAttachmentCountWithinLimit(9, 2), /at most 10 files at a time/);
    assert.equal(getRemainingAttachmentSlots(10), 0);
  });

  it('rejects dangerous extensions and files larger than one gigabyte', () => {
    assert.match(
      getAttachmentRejectionReason({ originalFilename: 'payload.exe', size: 1 }) ?? '',
      /not allowed for security reasons/,
    );
    assert.equal(
      getAttachmentRejectionReason({
        originalFilename: 'large.mp4',
        size: 1024 * 1024 * 1024 + 1,
      }),
      'File size exceeds 1 GB',
    );
  });
});
