import {
  AGENT_ACTOR_TYPES,
  NO_ACTOR_FILTER,
  USER_ACTOR_TYPES,
  type ActivityActorFilter,
} from '../domain/activityActorFilter';

/** Whose activities the feed shows: everyone, people only, or agents only. */
export type ActivityActorKind = 'all' | 'user' | 'agent';

/** Condensed leaves attachments out of a row; Detailed draws them. */
export type ActivityViewMode = 'condensed' | 'detailed';

/**
 * What the person has chosen about the feed, as opposed to which tab chip is
 * showing. Mirrors the dashboard's controls one for one.
 */
export type ActivityPreferences = {
  readonly unreadOnly: boolean;
  readonly actorKind: ActivityActorKind;
  /** One actor of that kind, or `null` for any. Reset when the kind changes. */
  readonly actorUserId: string | null;
  /** Swaps the chips from Mentions/Replies/… to Actionable/FYI. */
  readonly actionable: boolean;
  readonly viewMode: ActivityViewMode;
};

export const DEFAULT_ACTIVITY_PREFERENCES: ActivityPreferences = {
  unreadOnly: false,
  actorKind: 'all',
  actorUserId: null,
  actionable: false,
  viewMode: 'detailed',
};

/** The query-side filter the preferences stand for. */
export function actorFilterFrom(
  preferences: Pick<ActivityPreferences, 'actorKind' | 'actorUserId'>,
): ActivityActorFilter {
  if (preferences.actorKind === 'all') return NO_ACTOR_FILTER;
  const types = preferences.actorKind === 'user' ? USER_ACTOR_TYPES : AGENT_ACTOR_TYPES;
  return preferences.actorUserId !== null ? { types, id: preferences.actorUserId } : { types };
}

/** How many controls differ from their defaults; drives the button's badge. */
export function countActiveFilters(preferences: ActivityPreferences): number {
  let count = 0;
  if (preferences.unreadOnly) count += 1;
  if (preferences.actorKind !== 'all') count += 1;
  if (preferences.actionable) count += 1;
  return count;
}
