import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  categorizeAttachments,
  formatFileSize,
  getFileExtension,
  isImageFile,
  isMediaFile,
  isVideoFile,
  truncateFileName,
  type MessageAttachment,
} from '@/src/components/chat/message/message-attachments.utils';

const attachment = (
  overrides: Partial<MessageAttachment> & { mimetype: string },
): MessageAttachment =>
  ({
    id: 'a1',
    originalFilename: 'file.bin',
    size: 0,
    ...overrides,
  }) as MessageAttachment;

describe('isImageFile / isVideoFile / isMediaFile', () => {
  it('classifies image mime types', () => {
    assert.equal(isImageFile('image/png'), true);
    assert.equal(isImageFile('video/mp4'), false);
    assert.equal(isImageFile('application/pdf'), false);
  });

  it('classifies video mime types', () => {
    assert.equal(isVideoFile('video/quicktime'), true);
    assert.equal(isVideoFile('image/png'), false);
  });

  it('treats both images and videos as media, others not', () => {
    assert.equal(isMediaFile('image/gif'), true);
    assert.equal(isMediaFile('video/webm'), true);
    assert.equal(isMediaFile('application/pdf'), false);
    assert.equal(isMediaFile('audio/mp3'), false);
  });
});

describe('getFileExtension', () => {
  it('resolves from the MIME map first', () => {
    assert.equal(getFileExtension('application/pdf'), 'PDF');
    assert.equal(getFileExtension('image/jpeg'), 'JPG');
    assert.equal(getFileExtension('application/json'), 'JSON');
  });

  it('falls back to the filename extension for unknown mime types', () => {
    assert.equal(getFileExtension('application/x-unknown', 'archive.tar.gz'), 'GZ');
    assert.equal(getFileExtension('application/x-unknown', 'photo.HEIC'), 'HEIC');
  });

  it('returns FILE when the mime is unknown and there is no usable extension', () => {
    assert.equal(getFileExtension('application/x-unknown'), 'FILE');
    // a filename with no dot yields no distinct extension -> FILE
    assert.equal(getFileExtension('application/x-unknown', 'README'), 'FILE');
  });
});

describe('formatFileSize', () => {
  it('handles zero and negative sizes', () => {
    assert.equal(formatFileSize(0), '0 B');
    assert.equal(formatFileSize(-1), 'Unknown size');
  });

  it('formats bytes with no decimals', () => {
    assert.equal(formatFileSize(512), '512 B');
  });

  it('uses one decimal below 10 units and zero decimals at/above 10', () => {
    assert.equal(formatFileSize(1024), '1.0 KB');
    assert.equal(formatFileSize(1536), '1.5 KB');
    assert.equal(formatFileSize(10 * 1024), '10 KB');
  });

  it('scales into MB and GB', () => {
    assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
    assert.equal(formatFileSize(1024 * 1024 * 1024), '1.0 GB');
  });
});

describe('truncateFileName', () => {
  it('returns the name unchanged when within the limit', () => {
    assert.equal(truncateFileName('short.txt'), 'short.txt');
  });

  it('preserves the extension while truncating the base name', () => {
    const out = truncateFileName('averylongfilename_document.pdf', 20);
    assert.equal(out, 'averylongfile....pdf');
    assert.equal(out.length, 20);
    assert.ok(out.endsWith('.pdf'));
  });

  it('truncates with a plain ellipsis when there is no extension', () => {
    const out = truncateFileName('averylongfilenamewithoutextension', 20);
    assert.equal(out, 'averylongfilenamewithoutextension'.slice(0, 17) + '...');
    assert.ok(out.endsWith('...'));
    assert.equal(out.length, 20);
  });

  it('falls back to ...extension when the extension itself exceeds the budget', () => {
    assert.equal(truncateFileName('x.abcdefghij', 8), '....abcdefghij');
  });
});

describe('categorizeAttachments', () => {
  it('splits media (images/videos) from other files, preserving order', () => {
    const input = [
      attachment({ id: 'img', mimetype: 'image/png' }),
      attachment({ id: 'doc', mimetype: 'application/pdf' }),
      attachment({ id: 'vid', mimetype: 'video/mp4' }),
      attachment({ id: 'zip', mimetype: 'application/zip' }),
    ];
    const { media, files } = categorizeAttachments(input);
    assert.deepEqual(
      media.map(m => m.id),
      ['img', 'vid'],
    );
    assert.deepEqual(
      files.map(f => f.id),
      ['doc', 'zip'],
    );
  });

  it('returns empty buckets for an empty input', () => {
    const { media, files } = categorizeAttachments([]);
    assert.deepEqual(media, []);
    assert.deepEqual(files, []);
  });
});
