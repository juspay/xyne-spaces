import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeEmailAttachmentSelection,
  getEmailAttachmentUploadPath,
  MAX_EMAIL_ATTACHMENT_FILES,
  parseEmailAttachmentUploadBody,
  parseEmailAttachmentUploadError,
  requireCompleteEmailAttachmentUpload,
  selectEmailAttachments,
  uploadedMailboxAttachmentIds,
} from '@/src/features/xyne-desks/detail/components/mailbox-reply/mailbox-reply.attachments';

type PickedFile = {
  attachmentId: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  localUri: string;
  source: 'file';
  status: 'local';
};

function picked(overrides: Partial<PickedFile> = {}): PickedFile {
  return {
    attachmentId: 'client-1',
    originalFilename: 'note.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    localUri: 'file://note.pdf',
    source: 'file',
    status: 'local',
    ...overrides,
  };
}

describe('getEmailAttachmentUploadPath', () => {
  it('uses the channel upload route for compose', () => {
    assert.equal(
      getEmailAttachmentUploadPath({ composerMode: 'compose', channelId: 'desk-1' }),
      '/email/channels/desk-1/upload-attachments',
    );
  });

  it('uses the conversation upload route for reply', () => {
    assert.equal(
      getEmailAttachmentUploadPath({
        composerMode: 'reply',
        conversationId: 'conv-1',
      }),
      '/email/conv-1/upload-attachments',
    );
  });

  it('rejects compose without a channel', () => {
    assert.throws(
      () => getEmailAttachmentUploadPath({ composerMode: 'compose', channelId: '  ' }),
      /Desk is still loading/,
    );
  });

  it('rejects reply without a conversation', () => {
    assert.throws(
      () => getEmailAttachmentUploadPath({ composerMode: 'reply' }),
      /Reply details are still loading/,
    );
  });
});

describe('selectEmailAttachments', () => {
  it('drops files over 25MB and extra files past the 10-file cap', () => {
    const selection = selectEmailAttachments(8, [
      picked({ attachmentId: 'a', originalFilename: 'ok.pdf', size: 1024 }),
      picked({
        attachmentId: 'b',
        originalFilename: 'huge.pdf',
        size: 26 * 1024 * 1024,
      }),
      picked({ attachmentId: 'c', originalFilename: 'third.pdf', size: 2048 }),
      picked({ attachmentId: 'd', originalFilename: 'fourth.pdf', size: 2048 }),
    ]);

    assert.deepEqual(
      selection.accepted.map(file => file.originalFilename),
      ['ok.pdf', 'third.pdf'],
    );
    assert.deepEqual(selection.skippedTooLarge, ['huge.pdf']);
    assert.equal(selection.droppedForCount, 1);
  });

  it('describes skipped files with the dashboard copy', () => {
    const message = describeEmailAttachmentSelection({
      accepted: [],
      skippedTooLarge: ['huge.pdf'],
      droppedForCount: 2,
    });

    assert.match(message ?? '', /Skipped 1 file over 25MB: huge\.pdf/);
    assert.match(
      message ?? '',
      new RegExp(
        `You can attach at most ${MAX_EMAIL_ATTACHMENT_FILES} files per email\\. Dropped 2`,
      ),
    );
  });
});

describe('email attachment upload parsing', () => {
  it('reads attachment ids and failures from the upload JSON', () => {
    const parsed = parseEmailAttachmentUploadBody(
      JSON.stringify({
        success: true,
        attachmentIds: ['att-1', 'att-2'],
        failures: [{ filename: 'bad.pdf', error: 'too large' }],
      }),
    );

    assert.deepEqual(parsed.attachmentIds, ['att-1', 'att-2']);
    assert.deepEqual(parsed.failures, [{ filename: 'bad.pdf', error: 'too large' }]);
  });

  it('requires a complete upload before returning ids', () => {
    assert.deepEqual(
      requireCompleteEmailAttachmentUpload(1, {
        attachmentIds: ['att-1'],
        failures: [],
      }),
      ['att-1'],
    );

    assert.throws(
      () =>
        requireCompleteEmailAttachmentUpload(2, {
          attachmentIds: ['att-1'],
          failures: [],
        }),
      /expected 2, got 1/,
    );

    assert.throws(
      () =>
        requireCompleteEmailAttachmentUpload(1, {
          attachmentIds: ['att-1'],
          failures: [{ filename: 'bad.pdf', error: 'denied' }],
        }),
      /bad\.pdf: denied/,
    );
  });

  it('surfaces API error copy for failed uploads', () => {
    assert.equal(
      parseEmailAttachmentUploadError(
        400,
        JSON.stringify({ error: 'Attachment exceeds the 25MB per-file limit.' }),
      ),
      'Attachment exceeds the 25MB per-file limit.',
    );
    assert.equal(
      parseEmailAttachmentUploadError(401, 'not-json'),
      'You need to sign in again before attaching files.',
    );
  });
});

describe('uploadedMailboxAttachmentIds', () => {
  it('returns only finished server ids', () => {
    assert.deepEqual(
      uploadedMailboxAttachmentIds([
        {
          clientId: '1',
          serverId: 'att-1',
          originalFilename: 'a.pdf',
          mimetype: 'application/pdf',
          size: 1,
          localUri: 'file://a.pdf',
          status: 'uploaded',
        },
        {
          clientId: '2',
          serverId: null,
          originalFilename: 'b.pdf',
          mimetype: 'application/pdf',
          size: 1,
          localUri: 'file://b.pdf',
          status: 'uploading',
        },
      ]),
      ['att-1'],
    );
  });
});
