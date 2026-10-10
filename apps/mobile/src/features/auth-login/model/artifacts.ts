/**
 * The decorative feed behind the headline.
 *
 * Pure content: a frozen snapshot of a Spaces channel, never fetched and never interactive. The
 * avatars point at a public placeholder service until the Figma assets are bundled — swapping
 * them is a change to this file alone.
 */

export type ArtifactAuthor =
  | { kind: 'person'; name: string; avatarUrl: string }
  | { kind: 'agent'; name: string; tone: 'coral' | 'amber' };

export type ArtifactReaction = { emoji: string; count: number };

export type ArtifactCard = {
  id: string;
  author: ArtifactAuthor;
  /** Relationship line under the name, e.g. `mentioned #product-launch`. */
  verb?: string;
  channel?: string;
  time?: string;
  /** Leading `@name` pill on the first body line. */
  mention?: string;
  body?: string;
  /** Collapsed agent reasoning row, shown instead of a body. */
  thinking?: string;
  reactions?: ArtifactReaction[];
  /** Continuation text rendered dimmer, as if the card were cut off by the fade. */
  trailing?: string;
  /** Vertical rule down the avatar gutter, marking a thread. */
  threadLine?: boolean;
  /** Small `@` glyph clipped to the avatar's lower-left corner. */
  mentionBadge?: boolean;
};

const NINA_AVATAR = 'https://i.pravatar.cc/120?img=47';
const NINA_AVATAR_ALT = 'https://i.pravatar.cc/120?img=45';

export const LOGIN_ARTIFACTS: readonly ArtifactCard[] = [
  {
    id: 'nina-mention',
    author: { kind: 'person', name: 'Nina', avatarUrl: NINA_AVATAR },
    verb: 'mentioned',
    channel: '#product-launch',
    time: '4:52 pm',
    mention: '@Daksh',
    body: 'can you review the launch checklist before Friday? Xyne Doctor has already filled in most of it.',
    mentionBadge: true,
  },
  {
    id: 'claw-question',
    author: { kind: 'agent', name: 'Xyne Claw', tone: 'coral' },
    verb: 'asked',
    channel: '#product-launch',
    time: '5:10 pm',
    body: 'I drafted two versions of the launch announcement. Should I share the short one or the detailed one?',
    mentionBadge: true,
  },
  {
    id: 'architect-thinking',
    author: { kind: 'agent', name: 'Xyne Architect', tone: 'amber' },
    time: '2:10 pm',
    thinking: 'Thinking 3s',
  },
  {
    id: 'nina-thanks',
    author: { kind: 'person', name: 'Nina', avatarUrl: NINA_AVATAR_ALT },
    time: '2:23 pm',
    body: 'thank you',
    reactions: [
      { emoji: '❤️', count: 2 },
      { emoji: '👍', count: 2 },
      { emoji: '✅', count: 1 },
    ],
    trailing: 'updated the spec — the payment ID belongs to the payment, not to each',
    threadLine: true,
  },
];
