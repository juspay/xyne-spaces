import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redirectSystemPath } from '@/app/+native-intent';

const redirect = (path: string): string => redirectSystemPath({ path, initial: true });

describe('redirectSystemPath', (): void => {
  it('hands scoped chat and call links to the root Linking handler', (): void => {
    // An empty result tells Expo Router to ignore the URL. Anything else routes it,
    // and since no route file matches a scoped path, the stack would open on
    // Unmatched Route while the root handler opened the same link a second time.
    assert.equal(
      redirect(
        'https://spaces.xyne.juspay.net/cmove4qwc00rwd8fujw25xgnf' +
          '/chat/dir/cmqb57emo02xmh4qh14wrqs5y' +
          '#origin=282a528a-ffa0-430d-8b3b-8b2004cfe648',
      ),
      '',
    );
    assert.equal(redirect('https://spaces.xyne.juspay.net/chat/dir/channel-1'), '');
    assert.equal(redirect('https://spaces.xyne.juspay.net/org-9/ws-1/chat/dir/channel-1'), '');
    assert.equal(
      redirect(
        'https://spaces.xyne.juspay.net/00000000-0000-4000-8000-000000000001' +
          '/chat/dir/cmmw4b63v0q6z575f2x8teulu/cms91mfbf058nx4zkjfe419tg/cms91mfbs058qx4zk9mimdz5h' +
          '?selectedTab=details',
      ),
      '',
    );
    assert.equal(redirect('https://spaces.xyne.juspay.net/ws-1/call/call-9'), '');
    assert.equal(redirect('https://spaces.xyne.juspay.net/org-9/ws-1/call/call-9'), '');
  });

  it('handles the custom scheme, whose host carries the first path segment', (): void => {
    assert.equal(redirect('xyne-spaces://chat/dir/channel-1'), '');
  });

  it('leaves the Microsoft auth callback and unrelated paths alone', (): void => {
    assert.equal(redirect('https://spaces.xyne.juspay.net/auth/microsoft/callback'), '/login');
    const unrelated = 'https://spaces.xyne.juspay.net/apps/downloads';
    assert.equal(redirect(unrelated), unrelated);
    // Deeper than the org + workspace shape: not a link this app claims.
    const tooDeep = 'https://spaces.xyne.juspay.net/a/b/c/chat/dir/channel-1';
    assert.equal(redirect(tooDeep), tooDeep);
  });
});
