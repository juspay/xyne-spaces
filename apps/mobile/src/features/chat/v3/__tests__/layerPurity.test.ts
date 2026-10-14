import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const layers = ['intent', 'machine', 'model'] as const;

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
};

describe('C16 layer purity', (): void => {
  it('intent, machine, and model import neither react nor react-native', (): void => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const banned = /from ['"]react(?:-native)?(?:\/.*)?['"]/;
    const hits: string[] = [];
    for (const layer of layers) {
      for (const file of walk(join(root, layer))) {
        const source = readFileSync(file, 'utf8');
        if (banned.test(source)) {
          hits.push(file.slice(root.length));
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});
