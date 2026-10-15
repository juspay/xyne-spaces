import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IncomingSharePayload } from '@/src/features/share-target/nativeShareTarget';
import {
  fileNameFromUri,
  isLocalFileUri,
  normalizeIncomingSharePayload,
  sanitizeShareText,
} from '@/src/features/share-target/sharePayload';

const payload = (over: Partial<IncomingSharePayload> = {}): IncomingSharePayload => ({
  id: 'share-1',
  source: 'ios',
  receivedAt: 1,
  files: [],
  ...over,
});

describe('sanitizeShareText', (): void => {
  it('removes local file uri lines from shared text', (): void => {
    const uri = 'file:///private/var/mobile/tmp/documents/Abhinav_s_Resume.pdf';
    assert.equal(sanitizeShareText(`caption\n${uri}`), 'caption');
    assert.equal(sanitizeShareText(uri), '');
  });

  it('keeps normal text and http links', (): void => {
    assert.equal(sanitizeShareText('hello'), 'hello');
    assert.equal(sanitizeShareText('see https://example.com/doc'), 'see https://example.com/doc');
  });
});

describe('normalizeIncomingSharePayload', (): void => {
  it('recovers a lone file uri into files when the native payload has no files', (): void => {
    const uri =
      'file:///private/var/mobile/tmp/documents/C0366E9F-A6C8-45B4-8B6E-1396D36ED014/Abhinav_s_Resume_7_5_Web___AI___Sol___SysDes.pdf';
    const normalized = normalizeIncomingSharePayload(
      payload({
        text: uri,
        files: [],
      }),
    );
    assert.equal(normalized.text, '');
    assert.equal(normalized.files.length, 1);
    assert.equal(normalized.files[0]?.uri, uri);
    assert.equal(normalized.files[0]?.type, 'application/pdf');
    assert.equal(normalized.files[0]?.name, 'Abhinav_s_Resume_7_5_Web___AI___Sol___SysDes.pdf');
  });

  it('sanitizes text but keeps existing files', (): void => {
    const normalized = normalizeIncomingSharePayload(
      payload({
        text: 'file:///tmp/leak.pdf\ncaption',
        files: [
          {
            uri: 'file:///group/share/resume.pdf',
            name: 'resume.pdf',
            type: 'application/pdf',
            size: 10,
          },
        ],
      }),
    );
    assert.equal(normalized.text, 'caption');
    assert.equal(normalized.files.length, 1);
  });

  it('recovers file uri lines when text also has a caption', (): void => {
    const uri = 'file:///tmp/report.pdf';
    const normalized = normalizeIncomingSharePayload(
      payload({
        text: `notes before send\n${uri}`,
        files: [],
      }),
    );
    assert.equal(normalized.text, 'notes before send');
    assert.equal(normalized.files.length, 1);
    assert.equal(normalized.files[0]?.uri, uri);
  });
});

describe('fileNameFromUri', (): void => {
  it('decodes the last path segment', (): void => {
    assert.equal(fileNameFromUri('file:///tmp/My%20Doc.pdf'), 'My Doc.pdf');
    assert.equal(isLocalFileUri('file:///tmp/a.pdf'), true);
  });
});
