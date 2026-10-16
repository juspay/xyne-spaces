import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getChatKeyboardGeometry, includesChatComposerBottomSafeArea } from './chatKeyboardConfig';

describe('chat keyboard geometry', () => {
  it('keeps list and dock keyboard offsets on one geometry contract', () => {
    const geometry = getChatKeyboardGeometry(24);

    assert.equal(geometry.listOffset, 24);
    assert.deepEqual(geometry.stickyOffset, { closed: 0, opened: 24 });
  });

  it('clamps an invalid negative safe-area offset to zero', () => {
    const geometry = getChatKeyboardGeometry(-1);

    assert.equal(geometry.listOffset, 0);
    assert.deepEqual(geometry.stickyOffset, { closed: 0, opened: 0 });
  });

  it('falls back to zero for an unavailable safe-area offset', () => {
    const geometry = getChatKeyboardGeometry(Number.NaN);

    assert.equal(geometry.listOffset, 0);
    assert.deepEqual(geometry.stickyOffset, { closed: 0, opened: 0 });
  });

  it('removes the safe-area offset for an embedded host', () => {
    const geometry = getChatKeyboardGeometry(24, 'embedded');

    assert.equal(geometry.listOffset, 0);
    assert.deepEqual(geometry.stickyOffset, { closed: 0, opened: 0 });
  });

  it('only screen-owned surfaces include the composer bottom safe area', () => {
    assert.equal(includesChatComposerBottomSafeArea('screen'), true);
    assert.equal(includesChatComposerBottomSafeArea('embedded'), false);
  });
});
