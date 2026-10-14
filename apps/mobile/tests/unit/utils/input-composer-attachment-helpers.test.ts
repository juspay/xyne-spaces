import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeCanSend,
  computeHasComposerContent,
  isPendingAttachment,
  isUploadedAttachment,
} from '@/src/components/input-composer/input-composer-attachment-helpers';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';

const att = (status: ComposerAttachment['status']): ComposerAttachment =>
  ({ status }) as unknown as ComposerAttachment;

describe('isUploadedAttachment', () => {
  it('is true only for uploaded', () => {
    assert.equal(isUploadedAttachment(att('uploaded')), true);
    assert.equal(isUploadedAttachment(att('uploading')), false);
    assert.equal(isUploadedAttachment(att('local')), false);
    assert.equal(isUploadedAttachment(att('failed')), false);
  });
});

describe('isPendingAttachment', () => {
  it('is true for uploading and local', () => {
    assert.equal(isPendingAttachment(att('uploading')), true);
    assert.equal(isPendingAttachment(att('local')), true);
  });

  it('is false for uploaded and failed', () => {
    assert.equal(isPendingAttachment(att('uploaded')), false);
    assert.equal(isPendingAttachment(att('failed')), false);
  });
});

describe('computeCanSend', () => {
  it('allows sending with non-empty text and no attachments', () => {
    assert.equal(computeCanSend('hi', [], false, false), true);
  });

  it('blocks sending when text is only whitespace and nothing is uploaded', () => {
    assert.equal(computeCanSend('   ', [], false, false), false);
  });

  it('allows sending with an uploaded attachment and empty text', () => {
    assert.equal(computeCanSend('', [att('uploaded')], false, false), true);
  });

  it('blocks sending while an attachment is still pending', () => {
    assert.equal(computeCanSend('hi', [att('uploading')], false, false), false);
  });

  it('blocks sending while already sending or mutating attachments', () => {
    assert.equal(computeCanSend('hi', [], true, false), false);
    assert.equal(computeCanSend('hi', [], false, true), false);
  });
});

describe('computeHasComposerContent', () => {
  it('is true with non-empty text', () => {
    assert.equal(computeHasComposerContent('hi', []), true);
  });

  it('is true with any attachment even when text is empty', () => {
    assert.equal(computeHasComposerContent('', [att('failed')]), true);
  });

  it('is false with whitespace-only text and no attachments', () => {
    assert.equal(computeHasComposerContent('   ', []), false);
    assert.equal(computeHasComposerContent('', []), false);
  });
});
