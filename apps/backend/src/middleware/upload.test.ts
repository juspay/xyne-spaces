// upload.ts imports the storage engine, DB client and @xyne/shared at load time. None
// of them is used by the extension verdict, and the workspace packages ship ESM that
// ts-jest does not transform, so they are stubbed here.
jest.mock('../services/storage', () => ({ storageService: {} }));
jest.mock('../database/client', () => ({ db: {} }));
jest.mock('@xyne/shared', () => ({ AttachmentUploadStatus: {}, isHeicBuffer: () => false }));

import { classifyUpload } from './upload';

describe('classifyUpload', () => {
  it('allows .sarif static-analysis reports', () => {
    expect(classifyUpload('application/sarif+json', 'codeql-results.sarif')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'Semgrep.SARIF')).toBe('allowed');
  });

  it('still allows .json and refuses unknown extensions', () => {
    expect(classifyUpload('application/json', 'report.json')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'payload.qqq')).toBe('not-allowlisted');
  });
});
