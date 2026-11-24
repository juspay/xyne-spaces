import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mediaMetadata, photoGridLayout } from '@/src/features/conversation/model/photo-grid';

describe('photoGridLayout for one photo', () => {
  it('keeps a wide photo its shape across the full 300', () => {
    const layout = photoGridLayout(1, 1.6, 317);
    assert.deepEqual([layout.width, layout.height], [300, 187.5]);
    assert.equal(layout.cropFromTop, false);
  });

  it('cuts a very wide photo at 2:1', () => {
    const layout = photoGridLayout(1, 4, 317);
    assert.deepEqual([layout.width, layout.height], [300, 150]);
  });

  it('cuts a tall photo at 4:5, 300 high, from the top', () => {
    const layout = photoGridLayout(1, 9 / 19.5, 317);
    assert.deepEqual([layout.width, layout.height], [240, 300]);
    assert.equal(layout.cropFromTop, true);
  });

  it('falls back to 4:3 when the size is unknown', () => {
    const layout = photoGridLayout(1, null, 317);
    assert.deepEqual([layout.width, layout.height], [300, 225]);
  });

  it('shrinks with a narrow body', () => {
    const layout = photoGridLayout(1, 1, 200);
    assert.deepEqual([layout.width, layout.height], [200, 200]);
  });
});

describe('photoGridLayout for several photos', () => {
  it('puts two squares side by side, 3 apart', () => {
    const layout = photoGridLayout(2, 0.5, 317);
    assert.equal(layout.height, 148.5);
    assert.deepEqual(layout.cells[1], { left: 151.5, top: 0, width: 148.5, height: 148.5 });
  });

  it('puts three as one large and two stacked', () => {
    const layout = photoGridLayout(3, null, 317);
    assert.equal(layout.height, 200);
    assert.deepEqual(layout.cells[0], { left: 0, top: 0, width: 198, height: 200 });
    assert.deepEqual(layout.cells[1], { left: 201, top: 0, width: 99, height: 98.5 });
    assert.deepEqual(layout.cells[2], { left: 201, top: 101.5, width: 99, height: 98.5 });
  });

  it('makes four a 2 × 2 square with no count', () => {
    const layout = photoGridLayout(4, null, 317);
    assert.deepEqual([layout.width, layout.height, layout.overflowCount], [300, 300, 0]);
    assert.deepEqual(layout.cells[3], { left: 151.5, top: 151.5, width: 148.5, height: 148.5 });
  });

  it('shows four of six and counts the other two', () => {
    const layout = photoGridLayout(6, null, 317);
    assert.equal(layout.cells.length, 4);
    assert.equal(layout.overflowCount, 2);
  });

  it('draws nothing for no photos', () => {
    assert.deepEqual(photoGridLayout(0, null, 317).cells, []);
  });
});

describe('mediaMetadata', () => {
  it('reads the size, length and thumbnail', () => {
    assert.deepEqual(
      mediaMetadata({ width: 1600, height: 1000, duration: 42, thumbUri: 'file://t' }),
      {
        aspectRatio: 1.6,
        durationSeconds: 42,
        thumbUri: 'file://t',
      },
    );
  });

  it('ignores missing or unusable fields', () => {
    assert.deepEqual(mediaMetadata(null), {
      aspectRatio: null,
      durationSeconds: null,
      thumbUri: null,
    });
    assert.deepEqual(mediaMetadata({ width: 10, height: 0, duration: 'x', thumbUri: '' }), {
      aspectRatio: null,
      durationSeconds: null,
      thumbUri: null,
    });
  });
});
