import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VideoPlayer } from 'expo-video';

import { safePause, safePlay } from '@/src/utils/safeVideoPlayer';

const makePlayer = (impl: { pause?: () => void; play?: () => void }): VideoPlayer =>
  ({
    pause: impl.pause ?? (() => undefined),
    play: impl.play ?? (() => undefined),
  }) as unknown as VideoPlayer;

describe('safePause', () => {
  it('calls player.pause() on a healthy player', () => {
    let called = 0;
    safePause(makePlayer({ pause: () => (called += 1) }));
    assert.equal(called, 1);
  });

  it('swallows the error when the shared object is already released', () => {
    const player = makePlayer({
      pause: () => {
        throw new Error('shared object released');
      },
    });
    assert.doesNotThrow(() => safePause(player));
  });
});

describe('safePlay', () => {
  it('calls player.play() on a healthy player', () => {
    let called = 0;
    safePlay(makePlayer({ play: () => (called += 1) }));
    assert.equal(called, 1);
  });

  it('swallows the error when the shared object is already released', () => {
    const player = makePlayer({
      play: () => {
        throw new Error('shared object released');
      },
    });
    assert.doesNotThrow(() => safePlay(player));
  });
});
