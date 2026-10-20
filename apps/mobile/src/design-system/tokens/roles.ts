/**
 * The semantic roles a palette defines - meaning, not location.
 */

export const SEMANTIC_ROLES = [
  'background',
  'foreground',
  /** Secondary text: message preview, timestamp. */
  'muted',
  /** Tertiary text, quieter than `muted`: message time, member count. */
  'subtle',
  /** Hairline borders: cards, the thread hook line. */
  'outline',
  /** A mention of someone else, and the surface behind it. */
  'mention',
  'mention-surface',
  /** A mention of the viewer, and the surface behind it. */
  'mention-self',
  'mention-self-surface',
  /** The viewer's own avatar fill. */
  'identity-self',
  /** A raised block on the background: the active filter chip. */
  'surface',
  /**
   * A surface that floats *above* the screen rather than sitting on it — a
   * context menu, a popover. Distinct from `surface`, which is a block
   * within the page; this one has to read as lifted off it.
   */
  'surface-raised',
  /** Unread badge, and anything that has to read as "new". */
  'accent',
  'accent-foreground',
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/** `Record`, not `Partial` - a palette missing a role is a compile error. */
export type RoleValues = Record<SemanticRole, string>;

/** Namespaced so these can share Uniwind's `light` and `dark` themes with classic design without either being able to collide with the other. */
export const ROLE_PREFIX = '--color-spaces-';

export function cssVar(role: SemanticRole): string {
  return `${ROLE_PREFIX}${role}`;
}
