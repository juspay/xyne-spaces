import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveChatBubbleContentTokens,
  type ChatBubbleContentTokens,
} from '@/src/theme/chatBubbleContentTokens';
import { CHAT_BUBBLE_DARK_COLORS, CHAT_BUBBLE_LIGHT_COLORS } from '@/src/theme/chatBubbleTheme';

const TOKEN_KEYS: (keyof ChatBubbleContentTokens)[] = [
  'ambientAccentColor',
  'ambientActionBg',
  'ambientMentionBg',
  'ambientMentionText',
  'rootTextUser',
  'rootMetaUser',
  'rootAccentUser',
  'linkColorUser',
  'embeddedBgUser',
  'embeddedTitleUser',
  'embeddedMutedUser',
  'mentionOtherBgUser',
  'mentionOtherTextUser',
  'mentionSelfBgUser',
  'mentionSelfTextUser',
  'mentionSelfBgOther',
  'mentionSelfTextOther',
];

// Default chat bubble colours (see DEFAULT_CHAT_BUBBLE_OPTION in chatBubbleTheme).
const DEFAULT_LIGHT_BG = '#d8fdd2';
const DEFAULT_DARK_BG = '#134d37';
const ATTENTION_MENTION_BG = '#d6a21f';

describe('deriveChatBubbleContentTokens', () => {
  it('always returns a complete token set of non-empty string values', () => {
    for (const [bg, theme] of [
      ['#3b82f6', 'light'],
      ['#3b82f6', 'dark'],
      ['', 'light'],
      ['not-a-color', 'dark'],
    ] as const) {
      const tokens = deriveChatBubbleContentTokens(bg, theme);
      for (const key of TOKEN_KEYS) {
        assert.equal(typeof tokens[key], 'string', `${key} should be a string for ${bg}/${theme}`);
        assert.ok(tokens[key].length > 0, `${key} should be non-empty for ${bg}/${theme}`);
      }
    }
  });

  it('is deterministic for identical inputs', () => {
    assert.deepEqual(
      deriveChatBubbleContentTokens('#3b82f6', 'light'),
      deriveChatBubbleContentTokens('#3b82f6', 'light'),
    );
    assert.deepEqual(
      deriveChatBubbleContentTokens(DEFAULT_DARK_BG, 'dark'),
      deriveChatBubbleContentTokens(DEFAULT_DARK_BG, 'dark'),
    );
  });

  describe('unparseable background falls back to brand defaults', () => {
    it('light theme defaults', () => {
      const tokens = deriveChatBubbleContentTokens('nonsense', 'light');
      assert.equal(tokens.ambientAccentColor, '#1b8755');
      assert.equal(tokens.ambientActionBg, '#1b8755');
      assert.equal(tokens.rootTextUser, '#111827');
      assert.equal(tokens.linkColorUser, '#1B8755');
      assert.equal(tokens.mentionSelfBgUser, ATTENTION_MENTION_BG);
    });

    it('dark theme defaults', () => {
      const tokens = deriveChatBubbleContentTokens('', 'dark');
      assert.equal(tokens.ambientAccentColor, '#21c063');
      // Dark default keeps a saturated accent but a darker action fill.
      assert.equal(tokens.ambientActionBg, '#1b8755');
      assert.equal(tokens.rootTextUser, '#ffffff');
      assert.equal(tokens.linkColorUser, '#21C063');
    });
  });

  it('picks a readable root text colour based on bubble luminance', () => {
    // Dark bubble -> light text; light bubble -> dark text.
    const darkBubble = deriveChatBubbleContentTokens('#111827', 'light');
    assert.equal(darkBubble.rootTextUser, 'rgba(255, 255, 255, 1)');

    const lightBubble = deriveChatBubbleContentTokens('#ffffff', 'light');
    assert.equal(lightBubble.rootTextUser, 'rgba(17, 24, 39, 1)');
  });

  it('expands 3-digit hex and accepts rgb() input without throwing', () => {
    const short = deriveChatBubbleContentTokens('#fff', 'light');
    const long = deriveChatBubbleContentTokens('#ffffff', 'light');
    assert.deepEqual(short, long);

    const rgb = deriveChatBubbleContentTokens('rgb(255, 0, 0)', 'light');
    const hex = deriveChatBubbleContentTokens('#ff0000', 'light');
    assert.deepEqual(rgb, hex);
  });

  it('uses a desaturated slate accent for grayscale bubbles', () => {
    // s === 0 hits the grayscale branch of accentFromBubble.
    const light = deriveChatBubbleContentTokens('#808080', 'light');
    assert.equal(light.ambientActionBg, '#4b5563');

    const dark = deriveChatBubbleContentTokens('#808080', 'dark');
    assert.equal(dark.ambientActionBg, '#6b7280');
    assert.equal(dark.ambientAccentColor, '#d1d5db');
  });

  describe('default bubble colour swaps in curated mention overrides', () => {
    it('light default', () => {
      const tokens = deriveChatBubbleContentTokens(DEFAULT_LIGHT_BG, 'light');
      assert.equal(tokens.ambientMentionBg, '#EEF2FF');
      assert.equal(tokens.mentionOtherBgUser, '#EEF2FF');
      assert.equal(tokens.mentionSelfBgUser, '#FDE378');
      assert.equal(tokens.mentionSelfTextUser, '#6A5200');
    });

    it('dark default', () => {
      const tokens = deriveChatBubbleContentTokens(DEFAULT_DARK_BG, 'dark');
      assert.equal(tokens.ambientMentionBg, '#2B3357');
      assert.equal(tokens.mentionOtherBgUser, '#1C5A47');
      assert.equal(tokens.mentionOtherTextUser, '#9FE3C9');
      assert.equal(tokens.mentionSelfBgUser, '#6B5618');
    });
  });

  it('uses the attention mention colour for non-default bubbles', () => {
    const tokens = deriveChatBubbleContentTokens('#3b82f6', 'light');
    assert.equal(tokens.mentionSelfBgUser, ATTENTION_MENTION_BG);
    assert.equal(tokens.mentionSelfBgOther, ATTENTION_MENTION_BG);
  });
});

// The derivation above is pure, so results are cached. These cover the cache itself: the
// behavioural assertions live in the suite above and must keep passing through it.
describe('deriveChatBubbleContentTokens memoization', () => {
  it('returns the identical reference for a repeated (colour, theme) pair', () => {
    assert.equal(
      deriveChatBubbleContentTokens('#2d68ea', 'light'),
      deriveChatBubbleContentTokens('#2d68ea', 'light'),
    );
  });

  it('keys on theme as well as colour', () => {
    const light = deriveChatBubbleContentTokens('#2d68ea', 'light');
    const dark = deriveChatBubbleContentTokens('#2d68ea', 'dark');

    assert.notEqual(light, dark);
    assert.notDeepEqual(light, dark);
  });

  it('keys on colour as well as theme', () => {
    const a = deriveChatBubbleContentTokens(DEFAULT_LIGHT_BG, 'light');
    const b = deriveChatBubbleContentTokens('#2d68ea', 'light');

    assert.notEqual(a, b);
    assert.notDeepEqual(a, b);
  });

  it('stays stable across the whole palette in both themes', () => {
    for (const [index, lightColor] of CHAT_BUBBLE_LIGHT_COLORS.entries()) {
      const darkColor = CHAT_BUBBLE_DARK_COLORS[index] as string;

      assert.equal(
        deriveChatBubbleContentTokens(lightColor, 'light'),
        deriveChatBubbleContentTokens(lightColor, 'light'),
      );
      assert.equal(
        deriveChatBubbleContentTokens(darkColor, 'dark'),
        deriveChatBubbleContentTokens(darkColor, 'dark'),
      );
    }
  });

  it('survives cache eviction without returning stale or wrong values', () => {
    const before = deriveChatBubbleContentTokens('#2d68ea', 'light');

    // Push past the cache ceiling with distinct synthetic colours.
    for (let index = 0; index < 400; index += 1) {
      const channel = (index % 256).toString(16).padStart(2, '0');
      deriveChatBubbleContentTokens(`#${channel}${channel}${channel}`, 'light');
    }

    // The reference may have been evicted, but the derived values must be unchanged.
    assert.deepEqual(deriveChatBubbleContentTokens('#2d68ea', 'light'), before);
  });
});
