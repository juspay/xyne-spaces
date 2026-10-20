import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  avatarBadgeSize,
  avatarCornerBadgeSize,
  avatarGap,
  avatarLayout,
  avatarRadius,
  groupFaceSize,
} from '@/src/ui/avatar/avatar.geometry';

const SIZE = 48;

describe('avatarLayout', () => {
  it('draws a single face filling the slot, with nothing to cut', () => {
    const { faces, countBubble } = avatarLayout(SIZE, { isGroup: false });
    assert.equal(faces.length, 1);
    assert.deepEqual(faces[0]?.rect, {
      x: 0,
      y: 0,
      width: SIZE,
      height: SIZE,
      radius: avatarRadius(SIZE),
    });
    assert.deepEqual(faces[0]?.holes, []);
    assert.equal(countBubble, null);
  });

  it('stacks the front face right of the back one, inside the slot', () => {
    const [back, front] = avatarLayout(SIZE, { isGroup: true }).faces;
    const faceSize = groupFaceSize(SIZE);
    assert.equal(back?.rect.x, 0);
    assert.equal(front?.rect.x, SIZE - faceSize);
    assert.equal((front?.rect.x ?? 0) + (front?.rect.width ?? 0), SIZE);
  });

  it('cuts the front face out of the back one, grown by the gap', () => {
    const [back] = avatarLayout(SIZE, { isGroup: true }).faces;
    const gap = avatarGap(SIZE);
    const faceSize = groupFaceSize(SIZE);
    // Back sits at the origin, so its local coordinates are the slot's.
    assert.deepEqual(back?.holes[0], {
      x: SIZE - faceSize - gap,
      y: -gap,
      width: faceSize + gap * 2,
      height: faceSize + gap * 2,
      radius: avatarRadius(faceSize) + gap,
    });
  });

  it('hangs the count bubble past the front face top-right corner and cuts it from both faces', () => {
    const { faces, countBubble } = avatarLayout(SIZE, { isGroup: true });
    const badge = avatarBadgeSize(SIZE);
    const gap = avatarGap(SIZE);
    assert.ok(countBubble);
    assert.equal(countBubble.width, badge);
    assert.equal(countBubble.radius, badge / 2);
    assert.ok(countBubble.x + countBubble.width > SIZE, 'overhangs the right edge');
    assert.ok(countBubble.y < 0, 'overhangs the top edge');

    const front = faces[1];
    assert.deepEqual(front?.holes, [
      {
        x: countBubble.x - gap - (front?.rect.x ?? 0),
        y: countBubble.y - gap,
        width: badge + gap * 2,
        height: badge + gap * 2,
        radius: badge / 2 + gap,
      },
    ]);
    assert.equal(faces[0]?.holes.length, 2);
  });

  it('cuts a corner badge into a single face, hanging past its bottom-right corner', () => {
    const { faces, cornerBadge } = avatarLayout(SIZE, { isGroup: false, hasCornerBadge: true });
    const diameter = avatarCornerBadgeSize(SIZE);
    assert.ok(cornerBadge);
    assert.equal(cornerBadge.width, diameter);
    assert.equal(cornerBadge.radius, diameter / 2);
    assert.ok(cornerBadge.x + diameter > SIZE, 'overhangs the right edge');
    assert.ok(cornerBadge.y + diameter > SIZE, 'overhangs the bottom edge');
    // The badge is its own hole, with no extra gap.
    assert.deepEqual(faces[0]?.holes, [cornerBadge]);
  });

  it('cuts the corner badge out of both faces of a group, beside the count bubble', () => {
    const { faces, cornerBadge, countBubble } = avatarLayout(SIZE, {
      isGroup: true,
      hasCornerBadge: true,
    });
    assert.ok(cornerBadge && countBubble);
    assert.ok(cornerBadge.y > countBubble.y + countBubble.height, 'sits below the bubble');
    const [back, front] = faces;
    assert.equal(back?.holes.length, 3);
    assert.equal(front?.holes.length, 2);
    assert.deepEqual(front?.holes[1], { ...cornerBadge, x: cornerBadge.x - (front?.rect.x ?? 0) });
  });

  it('leaves the corner badge out unless asked for', () => {
    assert.equal(avatarLayout(SIZE, { isGroup: true }).cornerBadge, null);
    assert.equal(avatarLayout(SIZE, { isGroup: false }).cornerBadge, null);
  });
});
