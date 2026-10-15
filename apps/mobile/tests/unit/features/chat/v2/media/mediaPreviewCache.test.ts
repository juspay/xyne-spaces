import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'src/features/chat/v2/media/mediaPreviewCache.ts'),
  'utf8',
);

describe('media preview session ownership', () => {
  it('does not let an older request publish after logout or replacement', () => {
    assert.match(source, /type QueuedMediaPreviewRequest/);
    assert.match(source, /activeRequestIds = new Set<number>\(\)/);
    assert.match(source, /snapshotGenerations = new Map<string, number>\(\)/);
    assert.match(source, /inflightRequestIds\.get\(key\) === request\.requestId/);
    assert.match(source, /getAuthSessionGeneration\(\) === request\.generation/);
    assert.match(source, /getAuthSessionGeneration\(\) !== request\.generation/);
    assert.match(source, /if \(!ownsCompletion\(\)\) return;/);
  });

  it('writes previews below a generation-owned directory', () => {
    assert.match(source, /\/g\$\{generation\}\/\$\{attachmentId\}\.jpg/);
    assert.match(source, /getAuthSessionGeneration\(\) !== generation/);
    assert.match(source, /activeRequestIds\.clear\(\)/);
    assert.match(source, /inflightRequestIds\.clear\(\)/);
    assert.match(source, /snapshotGenerations\.get\(key\) !== generation/);
    assert.match(source, /const currentSnapshot = snapshots\.get\(key\)/);
    assert.match(source, /hasCurrentQueuedRequest/);
  });
});
