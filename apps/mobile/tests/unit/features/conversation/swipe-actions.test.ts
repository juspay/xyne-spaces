import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONTINUATION_TOP_OFFSET,
  MESSAGE_AVATAR_SIZE,
  MESSAGE_BODY_LINE_HEIGHT,
  MESSAGE_PADDING_Y,
  SWIPE_ASK_AI_THRESHOLD,
  SWIPE_REPLY_THRESHOLD,
  SWIPE_RUBBER_BAND_FACTOR,
  SWIPE_RUBBER_BAND_MAX,
} from '@/src/features/conversation/constants';
import {
  rubberBand,
  swipeAffordanceTop,
  swipeCommitAction,
  swipeDirections,
  swipeOffset,
  swipeReveal,
  type SwipeRowFacts,
} from '@/src/features/conversation/model/swipe-actions';

const BOTH = { reply: true, askAI: true } as const;
const SENT: SwipeRowFacts = {
  canAct: true,
  isPending: false,
  isDeleted: false,
  isShownInChannel: false,
};

describe('swipeDirections', () => {
  it('opens both ways on a sent message in a room the user can act in', () => {
    assert.deepEqual(swipeDirections(SENT), BOTH);
  });

  it('closes both ways where the user cannot act, or the message is unsent', () => {
    const closed = { reply: false, askAI: false };
    assert.deepEqual(swipeDirections({ ...SENT, canAct: false }), closed);
    assert.deepEqual(swipeDirections({ ...SENT, isPending: true }), closed);
  });

  it('drops reply on a thread reply sent to the room and Ask AI on a deleted message, as the hold menu does', () => {
    assert.deepEqual(swipeDirections({ ...SENT, isShownInChannel: true }), {
      reply: false,
      askAI: true,
    });
    assert.deepEqual(swipeDirections({ ...SENT, isDeleted: true }), { reply: true, askAI: false });
  });
});

describe('rubberBand', () => {
  it('follows the finger up to the threshold', () => {
    assert.equal(rubberBand(0, 64), 0);
    assert.equal(rubberBand(40, 64), 40);
    assert.equal(rubberBand(64, 64), 64);
  });

  it('resists past it, starting at the band factor and never gaining the cap', () => {
    const justPast = rubberBand(65, 64) - 64;
    assert.ok(justPast < 1 && justPast > SWIPE_RUBBER_BAND_FACTOR * 0.9);
    const far = rubberBand(10_000, 64);
    assert.ok(far < 64 + SWIPE_RUBBER_BAND_MAX);
    assert.ok(far > 64 + SWIPE_RUBBER_BAND_MAX * 0.9);
  });

  it('keeps moving the same way as the finger', () => {
    let previous = rubberBand(64, 64);
    for (let distance = 70; distance <= 400; distance += 30) {
      const next = rubberBand(distance, 64);
      assert.ok(next > previous);
      previous = next;
    }
  });
});

describe('swipeOffset', () => {
  it('moves right for reply and left for Ask AI, each with its own band', () => {
    assert.equal(swipeOffset(30, BOTH), 30);
    assert.equal(swipeOffset(-30, BOTH), -30);
    assert.equal(swipeOffset(200, BOTH), rubberBand(200, SWIPE_REPLY_THRESHOLD));
    assert.equal(swipeOffset(-200, BOTH), -rubberBand(200, SWIPE_ASK_AI_THRESHOLD));
  });

  it('stays put in a closed direction', () => {
    assert.equal(swipeOffset(80, { reply: false, askAI: true }), 0);
    assert.equal(swipeOffset(-80, { reply: true, askAI: false }), 0);
  });
});

describe('swipeReveal', () => {
  it('runs from 0 at rest to 1 at the threshold, for the side being uncovered only', () => {
    assert.equal(swipeReveal(0, 'reply-in-thread'), 0);
    assert.equal(swipeReveal(SWIPE_REPLY_THRESHOLD / 2, 'reply-in-thread'), 0.5);
    assert.equal(swipeReveal(SWIPE_REPLY_THRESHOLD * 2, 'reply-in-thread'), 1);
    assert.equal(swipeReveal(-SWIPE_ASK_AI_THRESHOLD / 4, 'ask-ai'), 0.25);
    assert.equal(swipeReveal(-40, 'reply-in-thread'), 0);
    assert.equal(swipeReveal(40, 'ask-ai'), 0);
  });
});

describe('swipeCommitAction', () => {
  it('commits only at or past a threshold', () => {
    assert.equal(swipeCommitAction(0), null);
    assert.equal(swipeCommitAction(SWIPE_REPLY_THRESHOLD - 1), null);
    assert.equal(swipeCommitAction(SWIPE_REPLY_THRESHOLD), 'reply-in-thread');
    assert.equal(swipeCommitAction(-(SWIPE_ASK_AI_THRESHOLD - 1)), null);
    assert.equal(swipeCommitAction(-SWIPE_ASK_AI_THRESHOLD), 'ask-ai');
  });

  it('agrees with the banded offset: a finger past the threshold always commits', () => {
    assert.equal(swipeCommitAction(swipeOffset(500, BOTH)), 'reply-in-thread');
    assert.equal(swipeCommitAction(swipeOffset(-500, BOTH)), 'ask-ai');
    assert.equal(swipeCommitAction(swipeOffset(SWIPE_REPLY_THRESHOLD - 1, BOTH)), null);
  });
});

describe('swipeAffordanceTop', () => {
  it('centres on the avatar of a block’s first message', () => {
    assert.equal(swipeAffordanceTop(false, MESSAGE_AVATAR_SIZE), MESSAGE_PADDING_Y);
    assert.equal(swipeAffordanceTop(false, 36), MESSAGE_PADDING_Y - 2);
  });

  it('centres on the first line of a continuation, which pulls up under the row above', () => {
    assert.equal(
      swipeAffordanceTop(true, 32),
      CONTINUATION_TOP_OFFSET + (MESSAGE_BODY_LINE_HEIGHT - 32) / 2,
    );
  });
});
