import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLUS_TRAY_DISMISS_DISTANCE,
  PLUS_TRAY_DISMISS_VELOCITY,
} from '@/src/features/conversation/constants';
import { trayDragCloses } from '@/src/features/conversation/model/tray-card';

describe('trayDragCloses', () => {
  it('closes past the distance or on a fling down', () => {
    assert.equal(trayDragCloses(PLUS_TRAY_DISMISS_DISTANCE, 0), true);
    assert.equal(trayDragCloses(10, PLUS_TRAY_DISMISS_VELOCITY), true);
  });

  it('snaps back from a short, slow drag', () => {
    assert.equal(trayDragCloses(PLUS_TRAY_DISMISS_DISTANCE - 1, 0), false);
  });

  it('stays open when flung back up, however far it went', () => {
    assert.equal(
      trayDragCloses(PLUS_TRAY_DISMISS_DISTANCE * 2, -PLUS_TRAY_DISMISS_VELOCITY),
      false,
    );
  });
});
