import { getString } from '../../services/localStorage';

import { setLogIdentity } from './appLogger';
import { logIdentityFromPersistedSession } from './logIdentityFromPersistedSession';

const USER_ID_KEY = '@lotus_user_id';
const USER_CACHE_KEY = '@lotus_user_cache';

export function hydrateLogIdentityFromPersistedSession(): void {
  const identity = logIdentityFromPersistedSession(
    getString(USER_ID_KEY),
    getString(USER_CACHE_KEY),
  );

  if (identity) {
    setLogIdentity(identity);
  }
}
