import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('useReadCursor', (): void => {
  it('flushes markChannelAsViewed on leave, background, and viewing', (): void => {
    const hook = readFileSync(
      fileURLToPath(new URL('../read/useReadCursor.ts', import.meta.url)),
      'utf8',
    );
    const screen = readFileSync(
      fileURLToPath(new URL('../screens/ChatChannelScreen.tsx', import.meta.url)),
      'utf8',
    );
    const action = readFileSync(
      fileURLToPath(new URL('../overlays/onAction.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/markChannelAsViewed/.test(hook), true);
    assert.equal(/AppState/.test(hook), true);
    assert.equal(/conversationId/.test(hook), true);
    assert.equal(/onBeforeMarkUnread/.test(hook), true);
    assert.equal(/onMarkUnreadFailure/.test(hook), true);
    assert.equal(/useReadCursor/.test(screen), true);
    assert.equal(/noteVisible/.test(screen), true);
    assert.equal(/useMarkChannelAsViewed/.test(screen), false);
    assert.equal(/onBeforeMarkUnread/.test(action), true);
    assert.equal(/features\/chat\/v2/.test(hook + screen), false);
  });
});
