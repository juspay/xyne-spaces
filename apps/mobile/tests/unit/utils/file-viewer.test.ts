import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getAttachmentFileCategory,
  parseCsvRows,
  resolveAttachmentMimeType,
  sanitizeCacheFileName,
} from '@/src/components/attachments-viewer/utils/file-viewer';

describe('resolveAttachmentMimeType', () => {
  it('trusts and trims a specific server mimetype', () => {
    assert.equal(resolveAttachmentMimeType('image/png'), 'image/png');
    assert.equal(resolveAttachmentMimeType('  image/png  '), 'image/png');
  });

  it('derives from the filename extension when mime is missing', () => {
    assert.equal(resolveAttachmentMimeType('', 'photo.JPG'), 'image/jpeg');
    assert.equal(resolveAttachmentMimeType(null, 'doc.pdf'), 'application/pdf');
  });

  it('derives from the filename when mime is a generic octet-stream', () => {
    assert.equal(
      resolveAttachmentMimeType('application/octet-stream', 'sheet.xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.equal(resolveAttachmentMimeType('binary/octet-stream', 'a.csv'), 'text/csv');
  });

  it('falls back to application/octet-stream for unknown/absent extensions', () => {
    assert.equal(resolveAttachmentMimeType('', 'file.unknownext'), 'application/octet-stream');
    assert.equal(resolveAttachmentMimeType(null, null), 'application/octet-stream');
  });
});

describe('getAttachmentFileCategory', () => {
  it('classifies by mime prefix', () => {
    assert.equal(getAttachmentFileCategory('image/png'), 'image');
    assert.equal(getAttachmentFileCategory('video/mp4'), 'video');
    assert.equal(getAttachmentFileCategory('audio/mpeg'), 'audio');
  });

  it('classifies video by extension when the server mime is generic', () => {
    assert.equal(getAttachmentFileCategory('application/octet-stream', 'clip.mp4'), 'video');
    assert.equal(getAttachmentFileCategory('', 'holiday.MOV'), 'video');
  });

  it('classifies pdf / csv / html by mime or filename', () => {
    assert.equal(getAttachmentFileCategory('application/pdf'), 'pdf');
    assert.equal(getAttachmentFileCategory('', 'report.PDF'), 'pdf');
    assert.equal(getAttachmentFileCategory('text/csv'), 'csv');
    assert.equal(getAttachmentFileCategory('', 'data.csv'), 'csv');
    assert.equal(getAttachmentFileCategory('text/html'), 'html');
    assert.equal(getAttachmentFileCategory('', 'page.htm'), 'html');
  });

  it('treats office documents as unsupported (no in-app preview)', () => {
    assert.equal(getAttachmentFileCategory('', 'notes.docx'), 'unsupported');
    assert.equal(
      getAttachmentFileCategory(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
      'unsupported',
    );
    assert.equal(getAttachmentFileCategory('application/msword'), 'unsupported');
  });

  it('classifies code and text', () => {
    assert.equal(getAttachmentFileCategory('', 'main.ts'), 'code');
    assert.equal(getAttachmentFileCategory('application/json'), 'code');
    assert.equal(getAttachmentFileCategory('text/plain'), 'text');
    assert.equal(getAttachmentFileCategory('', 'server.log'), 'text');
  });

  it('returns unsupported for unknown types', () => {
    assert.equal(getAttachmentFileCategory('application/zip', 'a.zip'), 'unsupported');
  });
});

describe('parseCsvRows', () => {
  it('splits rows and trims cells', () => {
    assert.deepEqual(parseCsvRows('a, b\nc,d'), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF line endings', () => {
    assert.deepEqual(parseCsvRows('x,y\r\nz,w'), [
      ['x', 'y'],
      ['z', 'w'],
    ]);
  });

  it('returns a single empty cell for an empty string', () => {
    assert.deepEqual(parseCsvRows(''), [['']]);
  });
});

describe('sanitizeCacheFileName', () => {
  it('falls back to "attachment" for empty/blank input', () => {
    assert.equal(sanitizeCacheFileName(undefined), 'attachment');
    assert.equal(sanitizeCacheFileName(null), 'attachment');
    assert.equal(sanitizeCacheFileName('   '), 'attachment');
  });

  it('replaces whitespace with underscores', () => {
    assert.equal(sanitizeCacheFileName('my file.png'), 'my_file.png');
  });

  it('replaces path-unsafe characters with underscores', () => {
    assert.equal(sanitizeCacheFileName('a/b:c*d?.png'), 'a_b_c_d_.png');
  });

  it('replaces control characters', () => {
    assert.equal(sanitizeCacheFileName('a\tb'), 'a_b');
  });
});
