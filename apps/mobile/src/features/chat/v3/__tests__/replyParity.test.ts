import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('v3 reply and thread parity', (): void => {
  it('keeps the v2 parent-preview surface and compact emoji geometry', (): void => {
    const card = read('../rows/parts/ParentPreviewCard.tsx');

    assert.match(card, /bg-conversation-composer-forwarded-bg-other/);
    assert.match(card, /style=\{\{ height: 18, overflow: 'hidden' \}\}/);
  });
});
