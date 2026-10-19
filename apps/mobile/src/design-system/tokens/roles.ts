/**
 * The semantic roles a palette defines - meaning, not location.
 */

export const SEMANTIC_ROLES = ['background', 'foreground'] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/** `Record`, not `Partial` - a palette missing a role is a compile error. */
export type RoleValues = Record<SemanticRole, string>;

/** Namespaced so these can share Uniwind's `light` and `dark` themes with classic design without either being able to collide with the other. */
export const ROLE_PREFIX = '--color-spaces-';

export function cssVar(role: SemanticRole): string {
  return `${ROLE_PREFIX}${role}`;
}
