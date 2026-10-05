import { useMissingUsersResolver } from '@xyne/shared/hooks';

/**
 * Fetches users that rendered components need but that are not in the user store
 * yet (see useEnsureUser). Mounted once, inside InitialStateLoader.
 */
export function MissingUsersResolver(): null {
  useMissingUsersResolver();
  return null;
}
