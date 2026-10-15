import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHAT_BUBBLE_COLOR_VARS,
  CHAT_BUBBLE_DARK_COLORS,
  CHAT_BUBBLE_LIGHT_COLORS,
  CHAT_BUBBLE_OPTIONS,
  CHAT_BUBBLE_PICKER_OPTIONS,
  DEFAULT_CHAT_BUBBLE_COLOR_VAR,
  DEFAULT_CHAT_BUBBLE_OPTION,
  getChatBubblePatternColor,
  getChatBubblePatternOpacity,
  isChatBubbleColorVar,
} from '@/src/theme/chatBubbleTheme';

describe('chat bubble color var constants', () => {
  it('declares 38 unique, correctly-prefixed color vars', () => {
    assert.equal(CHAT_BUBBLE_COLOR_VARS.length, 38);
    assert.equal(new Set(CHAT_BUBBLE_COLOR_VARS).size, 38);
    for (const varName of CHAT_BUBBLE_COLOR_VARS) {
      assert.match(varName, /^--color-chat-message-bubble-\d+$/);
    }
  });

  it('defaults to the first color var', () => {
    assert.equal(DEFAULT_CHAT_BUBBLE_COLOR_VAR, CHAT_BUBBLE_COLOR_VARS[0]);
    assert.equal(DEFAULT_CHAT_BUBBLE_COLOR_VAR, '--color-chat-message-bubble-1');
  });

  it('keeps light and dark palettes aligned with the color vars', () => {
    assert.equal(CHAT_BUBBLE_LIGHT_COLORS.length, CHAT_BUBBLE_COLOR_VARS.length);
    assert.equal(CHAT_BUBBLE_DARK_COLORS.length, CHAT_BUBBLE_COLOR_VARS.length);
  });
});

describe('CHAT_BUBBLE_OPTIONS', () => {
  it('pairs every color var with its light/dark color at the matching index', () => {
    assert.equal(CHAT_BUBBLE_OPTIONS.length, 38);
    CHAT_BUBBLE_OPTIONS.forEach((option, index) => {
      assert.equal(option.index, index);
      assert.equal(option.varName, CHAT_BUBBLE_COLOR_VARS[index]);
      assert.equal(option.lightColor, CHAT_BUBBLE_LIGHT_COLORS[index]);
      assert.equal(option.darkColor, CHAT_BUBBLE_DARK_COLORS[index]);
    });
  });

  it('exposes a picker subset of only even indices', () => {
    const evenIndices = CHAT_BUBBLE_OPTIONS.filter(option => option.index % 2 === 0);
    assert.equal(CHAT_BUBBLE_PICKER_OPTIONS.length, evenIndices.length);
    for (const option of CHAT_BUBBLE_PICKER_OPTIONS) {
      assert.equal(option.index % 2, 0);
    }
  });

  it('describes the default option consistently with the first palette entry', () => {
    assert.equal(DEFAULT_CHAT_BUBBLE_OPTION.index, 0);
    assert.equal(DEFAULT_CHAT_BUBBLE_OPTION.varName, DEFAULT_CHAT_BUBBLE_COLOR_VAR);
    assert.equal(DEFAULT_CHAT_BUBBLE_OPTION.lightColor, CHAT_BUBBLE_LIGHT_COLORS[0]);
    assert.equal(DEFAULT_CHAT_BUBBLE_OPTION.darkColor, CHAT_BUBBLE_DARK_COLORS[0]);
  });
});

describe('getChatBubblePatternColor', () => {
  it('returns the themed background pattern color for the default var', () => {
    assert.equal(
      getChatBubblePatternColor({
        bubbleColor: '#123456',
        colorVar: DEFAULT_CHAT_BUBBLE_COLOR_VAR,
        theme: 'light',
      }),
      '#7a766d',
    );
    assert.equal(
      getChatBubblePatternColor({
        bubbleColor: '#123456',
        colorVar: DEFAULT_CHAT_BUBBLE_COLOR_VAR,
        theme: 'dark',
      }),
      '#6f7780',
    );
  });

  it('returns the bubble color unchanged for a non-default var', () => {
    assert.equal(
      getChatBubblePatternColor({
        bubbleColor: '#abcdef',
        colorVar: '--color-chat-message-bubble-5',
        theme: 'dark',
      }),
      '#abcdef',
    );
  });
});

describe('getChatBubblePatternOpacity', () => {
  it('uses a lower opacity for the default var in dark mode', () => {
    assert.equal(
      getChatBubblePatternOpacity({ colorVar: DEFAULT_CHAT_BUBBLE_COLOR_VAR, theme: 'dark' }),
      0.44,
    );
    assert.equal(
      getChatBubblePatternOpacity({ colorVar: '--color-chat-message-bubble-5', theme: 'dark' }),
      0.6,
    );
  });

  it('uses a constant opacity in light mode regardless of var', () => {
    assert.equal(
      getChatBubblePatternOpacity({ colorVar: DEFAULT_CHAT_BUBBLE_COLOR_VAR, theme: 'light' }),
      0.34,
    );
    assert.equal(
      getChatBubblePatternOpacity({ colorVar: '--color-chat-message-bubble-9', theme: 'light' }),
      0.34,
    );
  });
});

describe('isChatBubbleColorVar', () => {
  it('accepts every declared color var', () => {
    for (const varName of CHAT_BUBBLE_COLOR_VARS) {
      assert.equal(isChatBubbleColorVar(varName), true);
    }
  });

  it('rejects unknown strings and non-string values', () => {
    assert.equal(isChatBubbleColorVar('--color-chat-message-bubble-99'), false);
    assert.equal(isChatBubbleColorVar('not-a-var'), false);
    assert.equal(isChatBubbleColorVar(''), false);
    assert.equal(isChatBubbleColorVar(null), false);
    assert.equal(isChatBubbleColorVar(undefined), false);
    assert.equal(isChatBubbleColorVar(1), false);
    assert.equal(isChatBubbleColorVar({}), false);
  });
});
