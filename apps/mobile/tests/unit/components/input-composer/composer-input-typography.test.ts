import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING,
  COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE,
  COMPOSER_INPUT_ATTACHMENT_ICON_SIZE,
  COMPOSER_INPUT_FONT_SIZE,
  COMPOSER_INPUT_INLINE_EMOJI_SIZE,
  COMPOSER_INPUT_LINE_HEIGHT,
  COMPOSER_INPUT_TEXT_GAP,
  COMPOSER_INPUT_EXPANDED_MAX_HEIGHT,
  COMPOSER_SEND_BUTTON_SIZE,
  COMPOSER_SEND_DISABLED_OPACITY,
  COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH,
  PLACEHOLDER_MAX_LENGTH,
  COMPOSER_INPUT_COLLAPSED_TRAILING_INSET,
  composerInputLeadingInset,
  composerInputTrailingInset,
  composerSendOpacity,
} from '@/src/components/input-composer/composer-input-typography';

describe('composer input typography constants', () => {
  it('pins the shared typography values', () => {
    assert.equal(COMPOSER_INPUT_FONT_SIZE, 16);
    assert.equal(COMPOSER_INPUT_LINE_HEIGHT, 18);
    assert.equal(COMPOSER_INPUT_ATTACHMENT_ICON_SIZE, 24);
    assert.equal(COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING, 4);
    assert.equal(COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE, 32);
    assert.equal(COMPOSER_SEND_BUTTON_SIZE, 32);
    assert.equal(COMPOSER_SEND_DISABLED_OPACITY, 0.4);
    assert.equal(COMPOSER_INPUT_TEXT_GAP, 6);
    assert.equal(COMPOSER_INPUT_COLLAPSED_TRAILING_INSET, 8);
    assert.equal(COMPOSER_INPUT_EXPANDED_MAX_HEIGHT, 96);
    assert.equal(COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH, 180);
    assert.equal(PLACEHOLDER_MAX_LENGTH, 20);
  });

  it('keeps the inline emoji within the line box', () => {
    assert.equal(COMPOSER_INPUT_INLINE_EMOJI_SIZE, COMPOSER_INPUT_FONT_SIZE);
    assert.ok(COMPOSER_INPUT_INLINE_EMOJI_SIZE <= COMPOSER_INPUT_LINE_HEIGHT);
  });

  it('exposes only positive, finite measurements', () => {
    const values = [
      COMPOSER_INPUT_FONT_SIZE,
      COMPOSER_INPUT_LINE_HEIGHT,
      COMPOSER_INPUT_INLINE_EMOJI_SIZE,
      COMPOSER_INPUT_ATTACHMENT_ICON_SIZE,
      COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING,
      COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE,
      COMPOSER_SEND_BUTTON_SIZE,
      COMPOSER_SEND_DISABLED_OPACITY,
      COMPOSER_INPUT_TEXT_GAP,
      COMPOSER_INPUT_COLLAPSED_TRAILING_INSET,
      COMPOSER_INPUT_EXPANDED_MAX_HEIGHT,
      COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH,
      PLACEHOLDER_MAX_LENGTH,
    ];
    for (const value of values) {
      assert.equal(Number.isFinite(value), true);
      assert.ok(value > 0);
    }
  });

  it('derives the leading text inset from the attachment hit target', () => {
    assert.equal(
      COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE,
      COMPOSER_INPUT_ATTACHMENT_ICON_SIZE + COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING * 2,
    );
  });

  it('keeps send the same size as the attachment hit target', () => {
    assert.equal(COMPOSER_SEND_BUTTON_SIZE, COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE);
  });

  it('dims send when ineligible instead of hiding it', () => {
    assert.equal(composerSendOpacity(true), 1);
    assert.equal(composerSendOpacity(false), COMPOSER_SEND_DISABLED_OPACITY);
    assert.ok(composerSendOpacity(false) > 0);
  });

  it('uses the remaining width when collapsed, and the full width when focused', () => {
    const leading = COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE + COMPOSER_INPUT_TEXT_GAP;
    assert.equal(composerInputLeadingInset(false, true), leading);
    assert.equal(composerInputLeadingInset(true, true), 0);
    assert.equal(composerInputLeadingInset(false, false), 0);
    assert.equal(composerInputLeadingInset(true, false), 0);
    assert.equal(composerInputTrailingInset(false), COMPOSER_INPUT_COLLAPSED_TRAILING_INSET);
    assert.equal(composerInputTrailingInset(true), 0);
  });
});
