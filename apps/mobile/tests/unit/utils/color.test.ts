import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha } from '@/src/utils/color';

test('withAlpha: converts valid 6-digit hex to rgba', () => {
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(withAlpha('#00ff00', 1), 'rgba(0, 255, 0, 1)');
  assert.equal(withAlpha('#0000ff', 0), 'rgba(0, 0, 255, 0)');
});

test('withAlpha: handles uppercase hex', () => {
  assert.equal(withAlpha('#FF0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(withAlpha('#AABBCC', 0.3), 'rgba(170, 187, 204, 0.3)');
});

test('withAlpha: returns fallback for null/undefined/empty', () => {
  assert.equal(withAlpha(null, 0.5), 'transparent');
  assert.equal(withAlpha(undefined, 0.5), 'transparent');
  assert.equal(withAlpha('', 0.5), 'transparent');
  assert.equal(withAlpha('   ', 0.5), 'transparent');
});

test('withAlpha: returns original value for non-hex color', () => {
  assert.equal(withAlpha('red', 0.5), 'red');
  assert.equal(withAlpha('rgb(0,0,0)', 0.5), 'rgb(0,0,0)');
  assert.equal(withAlpha('#fff', 0.5), '#fff');
  assert.equal(withAlpha('#1234567', 0.5), '#1234567');
});

test('withAlpha: uses custom fallback', () => {
  assert.equal(withAlpha(null, 0.5, 'inherit'), 'inherit');
  assert.equal(withAlpha('', 0.5, 'rgba(0,0,0,0)'), 'rgba(0,0,0,0)');
});

test('withAlpha: trims whitespace before parsing', () => {
  assert.equal(withAlpha('  #ff0000  ', 0.5), 'rgba(255, 0, 0, 0.5)');
});
