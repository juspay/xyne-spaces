import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONTENT_FADE_EDGE_DP,
  contentFadeGradient,
} from '@/src/components/fade/content-fade-gradient';
import { withAlpha } from '@/src/utils/color';

const COLOR = '#000000';
// Mirror the module's private alpha ramp so expectations stay in lock-step.
const [a0, a1, a2, a3] = [0, 0x60 / 285, 0xb0 / 285, 0xe8 / 285].map(a => withAlpha(COLOR, a));

describe('contentFadeGradient', () => {
  it('exposes the default edge size', () => {
    assert.equal(CONTENT_FADE_EDGE_DP, 48);
  });

  it('builds a bottom fade that ramps up to a solid tail', () => {
    const zoneHeight = 192;
    const edgeEnd = 48 / zoneHeight;
    const third = edgeEnd / 3;

    const { colors, locations } = contentFadeGradient(COLOR, 'bottom', zoneHeight);
    assert.deepEqual(colors, [a0, a1, a2, a3, a3]);
    assert.deepEqual(locations, [0, third, third * 2, edgeEnd, 1]);
  });

  it('builds a top fade that mirrors the bottom fade', () => {
    const zoneHeight = 192;
    const edgeEnd = 48 / zoneHeight;
    const third = edgeEnd / 3;

    const { colors, locations } = contentFadeGradient(COLOR, 'top', zoneHeight);
    assert.deepEqual(colors, [a3, a3, a2, a1, a0]);
    assert.deepEqual(locations, [0, 1 - edgeEnd, 1 - third * 2, 1 - third, 1]);
  });

  it('clamps the edge to the zone height when the zone is shorter than the edge', () => {
    const { locations } = contentFadeGradient(COLOR, 'bottom', 30);
    // edge = min(48, 30) = 30, so edgeEnd = 1 and the ramp fills the whole zone.
    assert.deepEqual(locations, [0, 1 / 3, 2 / 3, 1, 1]);
  });

  it('keeps a minimum edge of one device pixel', () => {
    const zoneHeight = 100;
    const { locations } = contentFadeGradient(COLOR, 'bottom', zoneHeight, 0);
    const edgeEnd = 1 / zoneHeight;
    assert.deepEqual(locations, [0, edgeEnd / 3, (edgeEnd / 3) * 2, edgeEnd, 1]);
  });

  it('respects a custom edge size', () => {
    const zoneHeight = 200;
    const edgeEnd = 24 / zoneHeight;
    const third = edgeEnd / 3;
    const { locations } = contentFadeGradient(COLOR, 'bottom', zoneHeight, 24);
    assert.deepEqual(locations, [0, third, third * 2, edgeEnd, 1]);
  });
});
