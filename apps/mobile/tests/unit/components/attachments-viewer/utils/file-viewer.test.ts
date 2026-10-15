import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAttachmentFileCategory,
  getAttachmentMediaKind,
  parseCsvRows,
  resolveAttachmentMimeType,
  sanitizeCacheFileName,
} from '@/src/components/attachments-viewer/utils/file-viewer';

describe('file-viewer / resolveAttachmentMimeType', () => {
  it('trusts a specific server mimetype and trims it', () => {
    assert.equal(resolveAttachmentMimeType('image/png', 'a.png'), 'image/png');
    assert.equal(resolveAttachmentMimeType('  image/png  ', 'a.bin'), 'image/png');
  });

  it('derives the mimetype from the extension when the server mime is generic', () => {
    assert.equal(
      resolveAttachmentMimeType('application/octet-stream', 'report.xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.equal(resolveAttachmentMimeType('binary/octet-stream', 'a.PDF'), 'application/pdf');
    assert.equal(resolveAttachmentMimeType('', 'photo.jpeg'), 'image/jpeg');
  });

  it('treats the generic mime check as case-insensitive', () => {
    assert.equal(resolveAttachmentMimeType('APPLICATION/OCTET-STREAM', 'a.csv'), 'text/csv');
  });

  it('falls back to octet-stream when nothing can be derived', () => {
    assert.equal(resolveAttachmentMimeType('', 'noextension'), 'application/octet-stream');
    assert.equal(resolveAttachmentMimeType(null, 'a.unknownext'), 'application/octet-stream');
    assert.equal(resolveAttachmentMimeType(undefined, undefined), 'application/octet-stream');
  });
});

describe('file-viewer / getAttachmentFileCategory', () => {
  it('classifies media by mime prefix', () => {
    assert.equal(getAttachmentFileCategory('image/png', 'a.png'), 'image');
    assert.equal(getAttachmentFileCategory('video/mp4', 'a.mp4'), 'video');
    assert.equal(getAttachmentFileCategory('audio/mpeg', 'a.mp3'), 'audio');
  });

  it('classifies video by extension when the server mime is generic', () => {
    assert.equal(getAttachmentFileCategory('application/octet-stream', 'clip.mp4'), 'video');
    assert.equal(getAttachmentFileCategory('', 'holiday.MOV'), 'video');
    assert.equal(getAttachmentFileCategory('binary/octet-stream', 'a.webm'), 'video');
  });

  it('classifies pdf, csv and html by mime or extension', () => {
    assert.equal(getAttachmentFileCategory('application/pdf', null), 'pdf');
    assert.equal(getAttachmentFileCategory('', 'a.pdf'), 'pdf');
    assert.equal(getAttachmentFileCategory('text/csv', null), 'csv');
    assert.equal(getAttachmentFileCategory('', 'rows.csv'), 'csv');
    assert.equal(getAttachmentFileCategory('text/html', null), 'html');
    assert.equal(getAttachmentFileCategory('', 'page.htm'), 'html');
  });

  it('marks office documents as unsupported', () => {
    assert.equal(getAttachmentFileCategory('application/msword', 'a.doc'), 'unsupported');
    assert.equal(getAttachmentFileCategory('', 'sheet.xlsx'), 'unsupported');
    assert.equal(
      getAttachmentFileCategory(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'deck.pptx',
      ),
      'unsupported',
    );
  });

  it('classifies code by extension or mime', () => {
    assert.equal(getAttachmentFileCategory('', 'main.ts'), 'code');
    assert.equal(getAttachmentFileCategory('application/json', 'data.json'), 'code');
    assert.equal(getAttachmentFileCategory('text/x-python', 'run'), 'code');
  });

  it('classifies plain text and falls back to unsupported', () => {
    assert.equal(getAttachmentFileCategory('text/plain', 'a.txt'), 'text');
    assert.equal(getAttachmentFileCategory('', 'server.log'), 'text');
    assert.equal(getAttachmentFileCategory('application/zip', 'a.zip'), 'unsupported');
  });
});

describe('file-viewer / getAttachmentMediaKind', () => {
  it('treats desktop and mobile videos as video even when mime is generic', () => {
    assert.equal(getAttachmentMediaKind('video/mp4', 'from-phone.mp4'), 'video');
    assert.equal(getAttachmentMediaKind('video/webm', 'from-desktop.webm'), 'video');
    assert.equal(getAttachmentMediaKind('video/quicktime', 'clip.mov'), 'video');
    assert.equal(getAttachmentMediaKind('application/octet-stream', 'clip.mp4'), 'video');
    assert.equal(getAttachmentMediaKind('', 'holiday.MOV'), 'video');
  });

  it('returns image or null for non-video attachments', () => {
    assert.equal(getAttachmentMediaKind('image/png', 'a.png'), 'image');
    assert.equal(getAttachmentMediaKind('application/pdf', 'a.pdf'), null);
    assert.equal(getAttachmentMediaKind('application/octet-stream', 'data.bin'), null);
  });
});

describe('file-viewer / parseCsvRows', () => {
  it('splits rows and cells and trims whitespace', () => {
    assert.deepEqual(parseCsvRows('a, b\r\nc ,d'), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles a single row without newline', () => {
    assert.deepEqual(parseCsvRows('x,y,z'), [['x', 'y', 'z']]);
  });
});

describe('file-viewer / sanitizeCacheFileName', () => {
  it('falls back to "attachment" for empty or blank input', () => {
    assert.equal(sanitizeCacheFileName(undefined), 'attachment');
    assert.equal(sanitizeCacheFileName(null), 'attachment');
    assert.equal(sanitizeCacheFileName('   '), 'attachment');
  });

  it('replaces illegal path characters and whitespace with underscores', () => {
    assert.equal(sanitizeCacheFileName('a/b:c*.txt'), 'a_b_c_.txt');
    assert.equal(sanitizeCacheFileName('my file.png'), 'my_file.png');
  });

  it('replaces control characters', () => {
    assert.equal(sanitizeCacheFileName('a\u0001b.txt'), 'a_b.txt');
    assert.equal(sanitizeCacheFileName('a\tb'), 'a_b');
  });
});
