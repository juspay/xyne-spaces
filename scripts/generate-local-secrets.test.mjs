import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('local LiveKit sample credentials are replaced once; custom credentials survive', () => {
  const root = mkdtempSync(join(tmpdir(), 'xyne-secrets-'));
  const backend = join(root, 'apps/backend');
  mkdirSync(backend, { recursive: true });
  const path = join(backend, '.env.local');
  const run = () => execFileSync(process.execPath, ['scripts/generate-local-secrets.mjs', '--livekit'], {
    env: { ...process.env, XYNE_REPO_ROOT: root },
  });
  try {
    writeFileSync(path, 'LIVEKIT_API_KEY=devkey\nLIVEKIT_API_SECRET=devsecret\n');
    run();
    const generated = readFileSync(path, 'utf8');
    assert.match(generated, /^LIVEKIT_API_KEY=[a-f0-9]{32}$/m);
    assert.match(generated, /^LIVEKIT_API_SECRET=[a-f0-9]{64}$/m);
    run();
    assert.equal(readFileSync(path, 'utf8'), generated);
    writeFileSync(path, 'LIVEKIT_API_KEY=custom-key\nLIVEKIT_API_SECRET=custom-secret\n');
    run();
    assert.match(readFileSync(path, 'utf8'), /^LIVEKIT_API_KEY=custom-key\nLIVEKIT_API_SECRET=custom-secret\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
