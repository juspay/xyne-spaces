import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composerAttachmentKind,
  composerAttachmentLabel,
  composerAttachmentPhase,
} from '@/src/features/conversation/model/composer-attachments';

describe('composerAttachmentKind', () => {
  it('draws pictures and videos as tiles', () => {
    assert.equal(composerAttachmentKind('image/png'), 'image');
    assert.equal(composerAttachmentKind('video/mp4'), 'video');
  });

  it('draws everything else as a file chip', () => {
    assert.equal(composerAttachmentKind('application/pdf'), 'file');
    assert.equal(composerAttachmentKind(''), 'file');
  });
});

describe('composerAttachmentPhase', () => {
  it('counts a chip still on the device as uploading', () => {
    assert.equal(composerAttachmentPhase('local'), 'uploading');
    assert.equal(composerAttachmentPhase('uploading'), 'uploading');
  });

  it('tells a failed upload from a finished one', () => {
    assert.equal(composerAttachmentPhase('failed'), 'failed');
    assert.equal(composerAttachmentPhase('uploaded'), 'ready');
  });
});

describe('composerAttachmentLabel', () => {
  it('names the kind and the file', () => {
    assert.equal(composerAttachmentLabel('image', 'ready', 'beach.jpg'), 'Photo, beach.jpg');
    assert.equal(composerAttachmentLabel('file', 'ready', 'plan.pdf'), 'File, plan.pdf');
  });

  it('says when it is still going up or failed', () => {
    assert.equal(composerAttachmentLabel('video', 'uploading', 'a.mp4'), 'Video, a.mp4, uploading');
    assert.equal(
      composerAttachmentLabel('image', 'failed', 'b.png'),
      'Photo, b.png, upload failed',
    );
  });
});
