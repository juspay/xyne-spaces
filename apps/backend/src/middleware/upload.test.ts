jest.mock('@/config/env', () => ({
  config: { uploads: { archiveScreening: 'shadow' } },
}));
jest.mock('../database/client', () => ({ db: {} }));
jest.mock('../services/storage', () => ({ storageService: {} }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@xyne/shared', () => ({
  AttachmentUploadStatus: { FAILED: 'FAILED' },
  isHeicBuffer: jest.fn(() => false),
}));

import { Readable } from 'node:stream';
import { __screenExecutableContentForTest, classifyUpload } from './upload';

describe('classifyUpload', () => {
  it('allows a fig file', () => {
    expect(classifyUpload('application/octet-stream', 'design.fig')).toBe('allowed');
  });

  it('allows Zip-headed fig content through upload screening', async () => {
    const content = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    expect(classifyUpload('application/octet-stream', 'design.fig')).toBe('allowed');
    const screened = await __screenExecutableContentForTest(
      Readable.from([content]),
      'design.fig',
      'application/octet-stream',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of screened) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  it('still blocks a Windows executable', () => {
    expect(classifyUpload('application/octet-stream', 'setup.exe')).toBe('blocked');
  });

  it('still rejects an extension outside the allow list', () => {
    expect(classifyUpload('application/octet-stream', 'archive.rpm')).toBe('not-allowlisted');
  });
});
