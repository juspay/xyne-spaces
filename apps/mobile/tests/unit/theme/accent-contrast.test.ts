import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_GRAPHIC_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastBetween,
  contrastRatio,
  ensureContrast,
  isDarkSurface,
  parseHexColor,
  readableTextOn,
  withAlpha,
} from '@/src/theme/accent-contrast';

describe('accent-contrast constants', () => {
  it('exposes the WCAG contrast floors', () => {
    assert.equal(MIN_GRAPHIC_CONTRAST, 3);
    assert.equal(MIN_TEXT_CONTRAST, 4.5);
  });
});

describe('parseHexColor', () => {
  it('parses 6-digit hex with and without a leading hash', () => {
    assert.deepEqual(parseHexColor('#ffffff'), { r: 255, g: 255, b: 255 });
    assert.deepEqual(parseHexColor('000000'), { r: 0, g: 0, b: 0 });
  });

  it('expands 3-digit shorthand hex', () => {
    assert.deepEqual(parseHexColor('#f00'), { r: 255, g: 0, b: 0 });
    assert.deepEqual(parseHexColor('0f0'), { r: 0, g: 255, b: 0 });
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    assert.deepEqual(parseHexColor('  #AABBCC  '), { r: 170, g: 187, b: 204 });
  });

  it('returns null for malformed input', () => {
    assert.equal(parseHexColor('#12'), null);
    assert.equal(parseHexColor('ff00'), null);
    assert.equal(parseHexColor('#gggggg'), null);
    assert.equal(parseHexColor('nope'), null);
  });
});

describe('contrastRatio / contrastBetween', () => {
  it('reports 21:1 for black against white', () => {
    const white = parseHexColor('#ffffff');
    const black = parseHexColor('#000000');
    assert.ok(white && black);
    assert.ok(Math.abs(contrastRatio(white, black) - 21) < 1e-6);
  });

  it('reports 1:1 for a colour against itself', () => {
    const grey = parseHexColor('#808080');
    assert.ok(grey);
    assert.equal(contrastRatio(grey, grey), 1);
  });

  it('contrastBetween mirrors contrastRatio for parseable hex', () => {
    assert.ok(Math.abs(contrastBetween('#ffffff', '#000000') - 21) < 1e-6);
  });

  it('contrastBetween degrades to 1 when a colour cannot be parsed', () => {
    assert.equal(contrastBetween('zzz', '#000000'), 1);
    assert.equal(contrastBetween('#000000', 'zzz'), 1);
  });
});

describe('isDarkSurface', () => {
  it('classifies near-black as dark and near-white as light', () => {
    assert.equal(isDarkSurface('#000000'), true);
    assert.equal(isDarkSurface('#111827'), true);
    assert.equal(isDarkSurface('#ffffff'), false);
  });

  it('treats unparseable colours as not dark', () => {
    assert.equal(isDarkSurface('nope'), false);
  });
});

describe('readableTextOn', () => {
  it('returns white on a dark background and near-black on a light one', () => {
    assert.equal(readableTextOn('#000000'), '#ffffff');
    assert.equal(readableTextOn('#ffffff'), '#111827');
  });

  it('falls back to white when the background cannot be parsed', () => {
    assert.equal(readableTextOn('nope'), '#ffffff');
  });
});

describe('withAlpha', () => {
  it('emits an rgba string, expanding shorthand hex', () => {
    assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
    assert.equal(withAlpha('#0f0', 0.25), 'rgba(0, 255, 0, 0.25)');
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    assert.equal(withAlpha('nope', 0.5), 'nope');
  });
});

describe('ensureContrast', () => {
  it('returns the colour unchanged when it already clears the floor', () => {
    assert.equal(ensureContrast('#ffffff', '#000000'), '#ffffff');
  });

  it('returns the colour unchanged when either colour is unparseable', () => {
    assert.equal(ensureContrast('nope', '#000000'), 'nope');
    assert.equal(ensureContrast('#ffffff', 'nope'), '#ffffff');
  });

  it('darkens a low-contrast accent on a light surface until it passes', () => {
    const result = ensureContrast('#bbbbbb', '#ffffff', MIN_GRAPHIC_CONTRAST);
    assert.notEqual(result, '#bbbbbb');
    assert.ok(contrastBetween(result, '#ffffff') >= MIN_GRAPHIC_CONTRAST - 1e-9);
  });
});
