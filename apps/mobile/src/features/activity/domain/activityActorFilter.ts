import { UserType } from '@xyne/shared';

/**
 * Narrows the feed to what one kind of actor — or one actor — did.
 *
 * The same two query arguments the dashboard sends, and resolved by the same
 * server-side query: actor kind lives on the user, not on the activity, so the
 * filter has to be part of the query for page sizes and cursors to stay
 * meaningful.
 */
export type ActivityActorFilter = {
  /** Actor kinds to keep. `undefined` keeps every kind. */
  readonly types?: readonly UserType[] | undefined;
  /** One actor to keep. Wins over `types`. */
  readonly id?: string | undefined;
};

export const NO_ACTOR_FILTER: ActivityActorFilter = {};

/** Only humans. */
export const USER_ACTOR_TYPES: readonly UserType[] = [UserType.USER];

/** Everything automated, as the dashboard's "Agent" tab groups it. */
export const AGENT_ACTOR_TYPES: readonly UserType[] = [UserType.BOT, UserType.APP, UserType.AGENT];

export const isActorFilterActive = (filter: ActivityActorFilter | undefined): boolean =>
  filter !== undefined && (Boolean(filter.id) || (filter.types?.length ?? 0) > 0);

/** Stable text for cache keys and effect dependencies. Empty when no filter. */
export const getActorFilterKey = (filter: ActivityActorFilter | undefined): string =>
  isActorFilterActive(filter) ? `${filter?.types?.join('+') ?? ''}@${filter?.id ?? ''}` : '';
