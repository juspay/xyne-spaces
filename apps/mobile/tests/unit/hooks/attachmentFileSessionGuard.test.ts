import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const hookSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useMtlsAttachmentFile.ts'),
  'utf8',
);
const videoSource = readFileSync(resolve(process.cwd(), 'src/hooks/useMtlsVideoStream.ts'), 'utf8');

describe('attachment file session guards', () => {
  it('scopes downloads and in-flight requests to the current auth session', () => {
    assert.match(hookSource, /createAttachmentCacheScope\(/);
    assert.match(hookSource, /getString\(USER_ID_KEY\)/);
    assert.match(hookSource, /getActiveWorkspaceId\(\)/);
    assert.match(hookSource, /getAuthSessionGeneration\(\)/);
    assert.match(hookSource, /buildAttachmentInflightKey\(scope, attachmentId, filename\)/);
    assert.match(
      hookSource,
      /buildAttachmentResourceUrl\(API_BASE_URL, attachmentId, 'download'\)/,
    );
    assert.match(hookSource, /clearMtlsAttachmentCache/);
    assert.match(hookSource, /ATTACHMENT_CACHE_NONCE_KEY/);
    assert.match(hookSource, /isValidAttachmentId\(attachmentId\)/);
    assert.match(hookSource, /AttachmentSessionUnavailableError/);
    assert.match(hookSource, /deleteCachedFile\(localPath\)/);
    assert.match(hookSource, /if \(requestId !== requestIdRef\.current\)/);
    assert.match(hookSource, /if \(getAuthSessionGeneration\(\) !== startedGeneration\)/);
  });

  it('leaves video streaming on its existing generation guard', () => {
    assert.match(videoSource, /buildAttachmentResourceUrl\(API_BASE_URL, attachmentId, 'stream'\)/);
    assert.match(
      videoSource,
      /if \(!mounted \|\| getAuthSessionGeneration\(\) !== sessionGeneration\) return/,
    );
  });
});
