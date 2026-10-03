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

import { classifyUpload } from './upload';

describe('classifyUpload', () => {
  it('allows a fig file', () => {
    expect(classifyUpload('application/octet-stream', 'design.fig')).toBe('allowed');
  });

  it('still blocks a Windows executable', () => {
    expect(classifyUpload('application/octet-stream', 'setup.exe')).toBe('blocked');
  });

  it('still rejects an extension outside the allow list', () => {
    expect(classifyUpload('application/octet-stream', 'archive.rpm')).toBe('not-allowlisted');
  });
});
