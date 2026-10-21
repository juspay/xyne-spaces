import { DEFAULT_CHAT_BUBBLE_OPTION } from '@/src/theme/chatBubbleTheme';

export type ChatBubbleContentTokens = {
  ambientAccentColor: string;
  ambientActionBg: string;
  ambientMentionBg: string;
  ambientMentionText: string;
  rootTextUser: string;
  rootMetaUser: string;
  rootAccentUser: string;
  linkColorUser: string;
  embeddedBgUser: string;
  embeddedTitleUser: string;
  embeddedMutedUser: string;
  mentionOtherBgUser: string;
  mentionOtherTextUser: string;
  mentionSelfBgUser: string;
  mentionSelfTextUser: string;
  mentionSelfBgOther: string;
  mentionSelfTextOther: string;
};

type RGB = {
  r: number;
  g: number;
  b: number;
};

type HSL = {
  h: number;
  s: number;
  l: number;
};

const ATTENTION_MENTION_BG = '#d6a21f';
const ATTENTION_MENTION_TEXT = '#251700';

type MentionColorOverrides = Pick<
  ChatBubbleContentTokens,
  | 'ambientMentionBg'
  | 'ambientMentionText'
  | 'mentionOtherBgUser'
  | 'mentionOtherTextUser'
  | 'mentionSelfBgUser'
  | 'mentionSelfTextUser'
  | 'mentionSelfBgOther'
  | 'mentionSelfTextOther'
>;

const getDefaultBubbleMentionOverrides = (theme: string): MentionColorOverrides =>
  theme === 'dark'
    ? {
        mentionOtherBgUser: '#1C5A47',
        mentionOtherTextUser: '#9FE3C9',
        mentionSelfBgUser: '#6B5618',
        mentionSelfTextUser: '#FFE08A',
        ambientMentionBg: '#2B3357',
        ambientMentionText: '#B8C4FF',
        mentionSelfBgOther: '#5B4A16',
        mentionSelfTextOther: '#FFE08A',
      }
    : {
        mentionOtherBgUser: '#EEF2FF',
        mentionOtherTextUser: '#4453A6',
        mentionSelfBgUser: '#FDE378',
        mentionSelfTextUser: '#6A5200',
        ambientMentionBg: '#EEF2FF',
        ambientMentionText: '#4453A6',
        mentionSelfBgOther: '#FFF1B8',
        mentionSelfTextOther: '#6A5200',
      };

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const rgba = ({ r, g, b }: RGB, alpha: number): string =>
  `rgba(${clampChannel(r)}, ${clampChannel(g)}, ${clampChannel(b)}, ${alpha})`;

const parseHexColor = (value: string): RGB | null => {
  const hex = value.trim().replace(/^#/, '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : hex;

  if (normalized.length !== 6) return null;

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
};

const parseRgbColor = (value: string): RGB | null => {
  const match = value
    .trim()
    .match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)$/i);

  if (!match) return null;

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);

  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    ? { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) }
    : null;
};

const parseColor = (value: string): RGB | null => {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return parseHexColor(trimmed);
  return parseRgbColor(trimmed);
};

const rgbToHsl = ({ r, g, b }: RGB): HSL => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === red) {
    h = ((green - blue) / delta) % 6;
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }

  return { h: (h * 60 + 360) % 360, s, l };
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToRgb = ({ h, s, l }: HSL): RGB => {
  if (s === 0) {
    const value = clampChannel(l * 255);
    return { r: value, g: value, b: value };
  }

  const normalizedHue = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: clampChannel(hueToRgb(p, q, normalizedHue + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, normalizedHue) * 255),
    b: clampChannel(hueToRgb(p, q, normalizedHue - 1 / 3) * 255),
  };
};

const rgbToHex = ({ r, g, b }: RGB): string =>
  `#${[r, g, b].map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

const isDefaultBubbleColor = (background: RGB, theme: string): boolean => {
  const defaultColor =
    theme === 'dark' ? DEFAULT_CHAT_BUBBLE_OPTION.darkColor : DEFAULT_CHAT_BUBBLE_OPTION.lightColor;
  return rgbToHex(background).toLowerCase() === defaultColor.toLowerCase();
};

const toLinear = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const luminance = ({ r, g, b }: RGB): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

const contrast = (a: RGB, b: RGB): number => {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

const accentFromBubble = (background: RGB, theme: string, usage: 'text' | 'action'): RGB => {
  const isLight = theme === 'light';
  const hsl = rgbToHsl(background);

  if (hsl.s < 0.08) {
    return isLight
      ? { r: 75, g: 85, b: 99 }
      : usage === 'action'
        ? { r: 107, g: 114, b: 128 }
        : { r: 209, g: 213, b: 219 };
  }

  return hslToRgb({
    h: hsl.h,
    s: Math.min(0.9, Math.max(hsl.s, 0.48)),
    l: usage === 'action' ? (isLight ? 0.36 : 0.42) : isLight ? 0.36 : 0.68,
  });
};

const ambientTokensFromAccent = (
  accent: RGB,
  action: RGB,
  theme: string,
): Pick<
  ChatBubbleContentTokens,
  'ambientAccentColor' | 'ambientActionBg' | 'ambientMentionBg' | 'ambientMentionText'
> => ({
  ambientAccentColor: rgbToHex(accent),
  ambientActionBg: rgbToHex(action),
  ambientMentionBg: rgba(accent, theme === 'light' ? 0.14 : 0.22),
  ambientMentionText: rgbToHex(accent),
});

const computeChatBubbleContentTokens = (
  bubbleBg: string,
  theme: string,
): ChatBubbleContentTokens => {
  const background = parseColor(bubbleBg);
  const black = { r: 17, g: 24, b: 39 };
  const white = { r: 255, g: 255, b: 255 };

  if (!background) {
    const isLight = theme === 'light';
    const ambientAccent = isLight ? { r: 27, g: 135, b: 85 } : { r: 33, g: 192, b: 99 };
    const ambientAction = isLight ? ambientAccent : { r: 27, g: 135, b: 85 };

    return {
      ...ambientTokensFromAccent(ambientAccent, ambientAction, theme),
      rootTextUser: isLight ? '#111827' : '#ffffff',
      rootMetaUser: isLight ? 'rgba(17, 24, 39, 0.58)' : 'rgba(255, 255, 255, 0.72)',
      rootAccentUser: isLight ? 'rgba(17, 24, 39, 0.7)' : 'rgba(255, 255, 255, 0.86)',
      linkColorUser: isLight ? '#1B8755' : '#21C063',
      embeddedBgUser: isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.13)',
      embeddedTitleUser: isLight ? '#111827' : '#ffffff',
      embeddedMutedUser: isLight ? 'rgba(17, 24, 39, 0.56)' : 'rgba(255, 255, 255, 0.66)',
      mentionOtherBgUser: isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)',
      mentionOtherTextUser: isLight ? '#111827' : '#ffffff',
      mentionSelfBgUser: ATTENTION_MENTION_BG,
      mentionSelfTextUser: ATTENTION_MENTION_TEXT,
      mentionSelfBgOther: ATTENTION_MENTION_BG,
      mentionSelfTextOther: ATTENTION_MENTION_TEXT,
    };
  }

  const text = contrast(background, white) >= contrast(background, black) ? white : black;
  const textIsDark = text === black;
  const ambientAccent = accentFromBubble(background, theme, 'text');
  const ambientAction = accentFromBubble(background, theme, 'action');
  const defaultMentionOverrides = isDefaultBubbleColor(background, theme)
    ? getDefaultBubbleMentionOverrides(theme)
    : null;

  return {
    ...ambientTokensFromAccent(ambientAccent, ambientAction, theme),
    ...(defaultMentionOverrides
      ? {
          ambientMentionBg: defaultMentionOverrides.ambientMentionBg,
          ambientMentionText: defaultMentionOverrides.ambientMentionText,
        }
      : {}),
    rootTextUser: rgba(text, 1),
    rootMetaUser: rgba(text, textIsDark ? 0.58 : 0.72),
    rootAccentUser: rgba(text, textIsDark ? 0.7 : 0.86),
    linkColorUser: rgbToHex(ambientAccent),
    embeddedBgUser: textIsDark ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.13)',
    embeddedTitleUser: rgba(text, textIsDark ? 0.88 : 0.94),
    embeddedMutedUser: rgba(text, textIsDark ? 0.56 : 0.66),
    mentionOtherBgUser:
      defaultMentionOverrides?.mentionOtherBgUser ??
      (textIsDark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.18)'),
    mentionOtherTextUser: defaultMentionOverrides?.mentionOtherTextUser ?? rgba(text, 1),
    mentionSelfBgUser: defaultMentionOverrides?.mentionSelfBgUser ?? ATTENTION_MENTION_BG,
    mentionSelfTextUser: defaultMentionOverrides?.mentionSelfTextUser ?? ATTENTION_MENTION_TEXT,
    mentionSelfBgOther: defaultMentionOverrides?.mentionSelfBgOther ?? ATTENTION_MENTION_BG,
    mentionSelfTextOther: defaultMentionOverrides?.mentionSelfTextOther ?? ATTENTION_MENTION_TEXT,
  };
};

// Pure function of (bubbleBg, theme), so results are cacheable. Callers hit this on every
// dependency change (useSelectedChatBubbleContentTokens has 8 call sites, and the bubble
// preview screen derives tokens for all 19 picker colors), and the body is hex -> RGB -> HSL
// -> contrast math that is wasteful to repeat.
const MAX_CACHED_CONTENT_TOKENS = 256;
const contentTokensCache = new Map<string, ChatBubbleContentTokens>();

export const deriveChatBubbleContentTokens = (
  bubbleBg: string,
  theme: string,
): ChatBubbleContentTokens => {
  const cacheKey = `${bubbleBg}|${theme}`;
  const cached = contentTokensCache.get(cacheKey);

  if (cached) return cached;

  const tokens = computeChatBubbleContentTokens(bubbleBg, theme);

  // Keys are bounded in practice (38 colors x 2 themes), but callers can pass arbitrary
  // resolved colors, so drop the cache rather than let it grow without limit.
  if (contentTokensCache.size >= MAX_CACHED_CONTENT_TOKENS) contentTokensCache.clear();
  contentTokensCache.set(cacheKey, tokens);

  return tokens;
};
