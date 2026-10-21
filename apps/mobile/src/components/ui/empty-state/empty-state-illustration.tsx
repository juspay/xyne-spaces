import { type ReactElement } from 'react';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

import { useSelectedChatBubbleContentTokens } from '@/src/theme/useSelectedChatBubbleContentTokens';

import { ensureContrast } from '@/src/theme/accent-contrast';

/**
 * Flat, outline-free illustrations for list empty states.
 *
 * House rules, so the set stays one family:
 * - 112x84 canvas, no strokes. One bold subject per drawing, filling most of the
 *   canvas — no card-and-filler-bars scaffolding behind it.
 * - The subject itself carries the accent (`A`). `S` is a supporting shape that
 *   gives depth, and `K` knocks a hole back to the screen background — so `K`
 *   must track `--color-tabs-screen`.
 * - Marks that exist as type (`@`, `#`) are set as real glyphs rather than
 *   approximated with arcs; nothing else reads as unambiguously.
 *
 * `S`, `D` and `K` are theme tokens and `A` follows the user's chosen chat
 * bubble colour, so one asset serves light, dark and every bubble choice.
 */

type Tone = 'S' | 'A' | 'K';

type Shape =
  | { t: 'r'; c: Tone; x: number; y: number; w: number; h: number; rx: number }
  | { t: 'c'; c: Tone; cx: number; cy: number; r: number }
  | { t: 'p'; c: Tone; d: string; tf?: string }
  | { t: 'g'; c: Tone; x: number; y: number; size: number; glyph: string };

const r = (c: Tone, x: number, y: number, w: number, h: number, rx: number): Shape => ({
  t: 'r',
  c,
  x,
  y,
  w,
  h,
  rx,
});
const o = (c: Tone, cx: number, cy: number, radius: number): Shape => ({
  t: 'c',
  c,
  cx,
  cy,
  r: radius,
});
const p = (c: Tone, d: string, tf?: string): Shape => ({ t: 'p', c, d, ...(tf ? { tf } : {}) });

/** Glyph centred on (cx, cy); the baseline offset approximates cap height. */
const g = (c: Tone, cx: number, cy: number, size: number, glyph: string): Shape => ({
  t: 'g',
  c,
  x: cx,
  y: cy + size * 0.35,
  size,
  glyph,
});

/** The bookmark, shifted left to leave room for a status badge. */
const BOOKMARK_BADGED_PATH =
  'M24 8 h40 a10 10 0 0 1 10 10 v54 l-30 -20 l-30 20 V18 a10 10 0 0 1 10 -10 z';

/** Lucide's phone outline, closed so it fills cleanly. */
const PHONE_PATH =
  'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z';

export type EmptyIllustrationName =
  | 'channels'
  | 'channelMentions'
  | 'channelStarred'
  | 'dms'
  | 'dmUnread'
  | 'dmGroups'
  | 'calls'
  | 'callsUpcoming'
  | 'callsMissed'
  | 'activityAll'
  | 'activityMentions'
  | 'activityReplies'
  | 'activityReactions'
  | 'activityTickets'
  | 'activityGroupMentions'
  | 'activityActionable'
  | 'activityFyi'
  | 'threads'
  | 'bookmarks'
  | 'bookmarkReminders'
  | 'bookmarkComplete';

const ILLUSTRATIONS: Record<EmptyIllustrationName, readonly Shape[]> = {
  // A channel is a hash. Nothing else says it as directly.
  channels: [g('A', 56, 42, 64, '#')],

  // A mention inside a conversation: the glyph sits in a speech bubble.
  channelMentions: [
    r('S', 8, 8, 96, 52, 18),
    p('S', 'M28 60 L28 76 L46 60 Z'),
    g('A', 56, 34, 38, '@'),
  ],

  channelStarred: [
    p(
      'A',
      'M56 12 L63.3 31.9 L84.5 32.7 L67.9 45.9 L73.6 66.3 L56 54.5 L38.4 66.3 L44.1 45.9 L27.5 32.7 L48.7 31.9 Z',
    ),
  ],

  // Two bubbles reading as a conversation; the near one is the subject.
  dms: [
    r('S', 44, 30, 60, 36, 14),
    p('S', 'M92 66 L92 79 L80 66 Z'),
    r('A', 6, 6, 70, 42, 16),
    p('A', 'M24 48 L24 62 L38 48 Z'),
  ],

  // Nothing unread — a plain, confident tick.
  dmUnread: [p('A', 'M26 40 L18 48 L42 72 L88 26 L80 18 L42 56 Z')],

  dmGroups: [o('S', 26, 46, 18), o('S', 86, 46, 18), o('K', 56, 40, 26), o('A', 56, 40, 22)],

  calls: [p('A', PHONE_PATH, 'translate(20 6) scale(3.1)')],

  // Upcoming is a clock, not a calendar — the calendar read as "dates", not "next".
  callsUpcoming: [o('A', 56, 42, 31), r('K', 53, 20, 6, 25, 3), r('K', 53, 39, 22, 6, 3)],

  // The universal missed-call mark: an arrow turning back into a corner.
  callsMissed: [p('A', 'M28 68 h30 v-10 h-13 l38 -38 l-7 -7 l-38 38 V38 h-10 z')],

  activityAll: [
    p('A', 'M56 8c-13 0-23 10-23 23v14l-8 10h62l-8-10V31c0-13-10-23-23-23z'),
    r('A', 46, 58, 20, 11, 5.5),
  ],

  // Mentions, plain and large.
  activityMentions: [g('A', 56, 42, 64, '@')],

  activityReplies: [
    p(
      'A',
      'M46 14 L16 40 L46 66 v-16 h16 a20 20 0 0 1 20 20 v10 h12 v-10 a32 32 0 0 0 -32 -32 H46 z',
    ),
  ],

  activityReactions: [
    p('A', 'M56 70 C34 54 22 42 22 32 a14 14 0 0 1 34 -6 a14 14 0 0 1 34 6 c0 10 -12 22 -34 38 z'),
  ],

  activityTickets: [
    p(
      'A',
      'M18 22h76a8 8 0 0 1 8 8v6a8 8 0 0 0 0 16v6a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8v-6a8 8 0 0 0 0-16v-6a8 8 0 0 1 8-8z',
    ),
    r('K', 54, 28, 4, 7, 2),
    r('K', 54, 39, 4, 7, 2),
    r('K', 54, 50, 4, 7, 2),
  ],

  // A mention aimed at a group: people, then the mark.
  activityGroupMentions: [
    o('S', 22, 44, 15),
    o('K', 48, 44, 19),
    o('S', 48, 44, 15),
    g('A', 84, 42, 40, '@'),
  ],

  activityActionable: [
    r('A', 26, 10, 60, 60, 16),
    p('K', 'M44 40 L38 46 L52 62 L78 34 L72 28 L52 50 Z'),
  ],

  activityFyi: [o('A', 56, 42, 32), o('K', 56, 26, 5.5), r('K', 50.5, 36, 11, 26, 5.5)],

  // A reply indented under its parent — the shape of a thread.
  threads: [
    r('A', 6, 6, 64, 30, 13),
    p('A', 'M20 36 L20 48 L32 36 Z'),
    r('S', 42, 46, 64, 30, 13),
    p('S', 'M92 76 L92 83 L83 76 Z'),
  ],

  bookmarks: [
    p('A', 'M32 8 h48 a10 10 0 0 1 10 10 v58 l-34 -22 l-34 22 V18 a10 10 0 0 1 10 -10 z'),
  ],

  // The three bookmark tabs share one subject and differ only by badge, so the
  // screen reads as one place with three states rather than three subjects.
  bookmarkReminders: [
    p('A', BOOKMARK_BADGED_PATH),
    o('K', 82, 56, 20),
    o('A', 82, 56, 16),
    r('K', 80.5, 46, 3, 11, 1.5),
    r('K', 80.5, 54, 10, 3, 1.5),
  ],

  bookmarkComplete: [
    p('A', BOOKMARK_BADGED_PATH),
    o('K', 82, 56, 20),
    o('A', 82, 56, 16),
    p('K', 'M76 56 L72 60 L80 69 L93 54 L89 50 L80 61 Z'),
  ],
};

const ILLUSTRATION_WIDTH = 112;
const ILLUSTRATION_HEIGHT = 84;

type EmptyStateIllustrationProps = {
  name: EmptyIllustrationName;
  /** Rendered width in points; height follows the 4:3 canvas. */
  width?: number;
};

export function EmptyStateIllustration({
  name,
  width = ILLUSTRATION_WIDTH,
}: EmptyStateIllustrationProps): ReactElement {
  // The accent follows Settings → Chat theme → Bubble colour. It uses the derived
  // `ambientActionBg` rather than the bubble colour itself: the palette includes
  // near-white pastels that would disappear against the screen, and this
  // derivation clamps lightness and floors saturation for a solid fill, with a
  // neutral fallback for greys.
  const { tokens } = useSelectedChatBubbleContentTokens();
  const surface = useCSSVariable('--color-tabs-screen') as string;

  const tones: Record<Tone, string> = {
    S: useCSSVariable('--color-accent') as string,
    // That derivation targets the bubble surface, not the screen. Eight of the
    // 38 palette colours land under 3:1 here in light and four in dark, so hold
    // it to the graphic-contrast floor before drawing.
    A: ensureContrast(tokens.ambientActionBg, surface),
    K: surface,
  };

  return (
    <Svg
      width={width}
      height={(width * ILLUSTRATION_HEIGHT) / ILLUSTRATION_WIDTH}
      viewBox={`0 0 ${ILLUSTRATION_WIDTH} ${ILLUSTRATION_HEIGHT}`}
    >
      {ILLUSTRATIONS[name].map((shape, index) => {
        const key = `${name}-${index}`;
        if (shape.t === 'r') {
          return (
            <Rect
              key={key}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              rx={shape.rx}
              fill={tones[shape.c]}
            />
          );
        }
        if (shape.t === 'c') {
          return <Circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} fill={tones[shape.c]} />;
        }
        if (shape.t === 'g') {
          return (
            <SvgText
              key={key}
              x={shape.x}
              y={shape.y}
              fontSize={shape.size}
              fontWeight='700'
              fill={tones[shape.c]}
              textAnchor='middle'
            >
              {shape.glyph}
            </SvgText>
          );
        }
        return (
          <Path
            key={key}
            d={shape.d}
            fill={tones[shape.c]}
            {...(shape.tf ? { transform: shape.tf } : {})}
          />
        );
      })}
    </Svg>
  );
}
