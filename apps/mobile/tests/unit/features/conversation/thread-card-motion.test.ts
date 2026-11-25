import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blendThreadCardRect,
  rubberBand,
  threadCardDragDismisses,
  threadCardMorphContentOpacity,
  threadCardMorphOpacity,
  threadCardScrimOpacity,
} from '@/src/features/conversation/model/thread-card-motion';
import {
  clearThreadCardSource,
  getThreadCardSource,
  setThreadCardSource,
} from '@/src/features/conversation/model/thread-card-source-store';

describe('blendThreadCardRect', () => {
  const strip = { x: 60, y: 150, width: 370, height: 46 };
  const card = { x: 10, y: 82, width: 420, height: 820 };

  it('is the strip at 0 and the card at 1', () => {
    assert.deepEqual(blendThreadCardRect(strip, card, 0), strip);
    assert.deepEqual(blendThreadCardRect(strip, card, 1), card);
  });

  it('moves every edge in step', () => {
    assert.deepEqual(blendThreadCardRect(strip, card, 0.5), {
      x: 35,
      y: 116,
      width: 395,
      height: 433,
    });
  });
});

describe('threadCardMorphOpacity', () => {
  it('fades in over the first share of the grow, then stays opaque', () => {
    assert.equal(threadCardMorphOpacity(0, 0.25), 0);
    assert.equal(threadCardMorphOpacity(0.125, 0.25), 0.5);
    assert.equal(threadCardMorphOpacity(0.25, 0.25), 1);
    assert.equal(threadCardMorphOpacity(0.9, 0.25), 1);
  });

  it('is opaque when there is no fade', () => {
    assert.equal(threadCardMorphOpacity(0, 0), 1);
  });
});

describe('threadCardMorphContentOpacity', () => {
  it('stays hidden while the card is small, then shows over the span', () => {
    assert.equal(threadCardMorphContentOpacity(0, 0.3, 0.3), 0);
    assert.equal(threadCardMorphContentOpacity(0.3, 0.3, 0.3), 0);
    assert.ok(Math.abs(threadCardMorphContentOpacity(0.45, 0.3, 0.3) - 0.5) < 1e-9);
    assert.equal(threadCardMorphContentOpacity(0.6, 0.3, 0.3), 1);
    assert.equal(threadCardMorphContentOpacity(1, 0.3, 0.3), 1);
  });

  it('switches at the point when there is no span', () => {
    assert.equal(threadCardMorphContentOpacity(0.2, 0.3, 0), 0);
    assert.equal(threadCardMorphContentOpacity(0.3, 0.3, 0), 1);
  });
});

describe('rubberBand', () => {
  it('gives nothing at or before the edge', () => {
    assert.equal(rubberBand(0, 24), 0);
    assert.equal(rubberBand(-10, 24), 0);
  });

  it('grows less the further it goes and never passes the limit', () => {
    const near = rubberBand(20, 24);
    const far = rubberBand(400, 24);
    assert.ok(near > 0 && near < 20);
    assert.ok(far > near && far < 24);
  });
});

describe('threadCardDragDismisses', () => {
  it('closes past a quarter of the card, capped at the max distance', () => {
    assert.equal(threadCardDragDismisses(150, 0, 400, 160, 900), true);
    assert.equal(threadCardDragDismisses(90, 0, 400, 160, 900), false);
    assert.equal(threadCardDragDismisses(160, 0, 2000, 160, 900), true);
  });

  it('closes on a fast flick down', () => {
    assert.equal(threadCardDragDismisses(20, 1200, 800, 160, 900), true);
  });

  it('stays when the finger is moving back up', () => {
    assert.equal(threadCardDragDismisses(150, -300, 400, 160, 900), false);
  });
});

describe('threadCardScrimOpacity', () => {
  it('follows the progress at rest and fades as the card is dragged away', () => {
    assert.equal(threadCardScrimOpacity(1, 0, 800), 1);
    assert.equal(threadCardScrimOpacity(0.5, 0, 800), 0.5);
    assert.equal(threadCardScrimOpacity(1, 400, 800), 0.5);
    assert.equal(threadCardScrimOpacity(1, -40, 800), 1);
  });
});

describe('thread card source store', () => {
  const rect = { x: 1, y: 2, width: 3, height: 4 };

  it('gives the strip back while it is fresh, and the same frame on every read', () => {
    clearThreadCardSource();
    setThreadCardSource(rect, 1000);
    assert.deepEqual(getThreadCardSource(2000, 1500), rect);
    assert.deepEqual(getThreadCardSource(2000, 1500), rect);
  });

  it('forgets a strip tapped too long ago', () => {
    setThreadCardSource(rect, 1000);
    assert.equal(getThreadCardSource(2000, 3001), null);
  });

  it('is empty once cleared', () => {
    setThreadCardSource(rect, 1000);
    clearThreadCardSource();
    assert.equal(getThreadCardSource(2000, 1000), null);
  });
});
