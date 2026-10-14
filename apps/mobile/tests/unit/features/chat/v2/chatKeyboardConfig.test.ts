import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHAT_COMPOSER_SURFACE_BOTTOM_GAP,
  getChatComposerBottomPadding,
  getChatKeyboardGeometry,
  getChatKeyboardStickyOffset,
  includesChatComposerBottomSafeArea,
} from '@/src/features/chat/v2/chatKeyboardConfig';

describe('getChatComposerBottomPadding', () => {
  it('adds the safe-area inset to the surface gap when requested', () => {
    assert.equal(getChatComposerBottomPadding(34, true), 34 + CHAT_COMPOSER_SURFACE_BOTTOM_GAP);
  });

  it('uses only the surface gap when the safe area is excluded', () => {
    assert.equal(getChatComposerBottomPadding(34, false), CHAT_COMPOSER_SURFACE_BOTTOM_GAP);
  });

  it('degrades to the surface gap when the inset is zero', () => {
    assert.equal(getChatComposerBottomPadding(0, true), CHAT_COMPOSER_SURFACE_BOTTOM_GAP);
  });
});

describe('includesChatComposerBottomSafeArea', () => {
  it('includes the safe area for screen mode only', () => {
    assert.equal(includesChatComposerBottomSafeArea('screen'), true);
    assert.equal(includesChatComposerBottomSafeArea('embedded'), false);
  });
});

describe('getChatKeyboardStickyOffset', () => {
  it('opens to the inset and closes to zero', () => {
    assert.deepEqual(getChatKeyboardStickyOffset(20), { closed: 0, opened: 20 });
  });
});

describe('getChatKeyboardGeometry', () => {
  it('passes the inset through in screen mode', () => {
    assert.deepEqual(getChatKeyboardGeometry(34, 'screen'), {
      listOffset: 34,
      stickyOffset: { closed: 0, opened: 34 },
    });
  });

  it('defaults to screen mode', () => {
    assert.deepEqual(getChatKeyboardGeometry(34), {
      listOffset: 34,
      stickyOffset: { closed: 0, opened: 34 },
    });
  });

  it('zeroes the offset in embedded mode', () => {
    assert.deepEqual(getChatKeyboardGeometry(34, 'embedded'), {
      listOffset: 0,
      stickyOffset: { closed: 0, opened: 0 },
    });
  });

  it('never returns a negative list offset', () => {
    assert.deepEqual(getChatKeyboardGeometry(-5, 'screen'), {
      listOffset: 0,
      stickyOffset: { closed: 0, opened: 0 },
    });
  });

  it('guards against a non-finite inset', () => {
    assert.deepEqual(getChatKeyboardGeometry(Number.POSITIVE_INFINITY, 'screen'), {
      listOffset: 0,
      stickyOffset: { closed: 0, opened: 0 },
    });
  });
});
