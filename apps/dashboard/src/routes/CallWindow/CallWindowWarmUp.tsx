import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

export function CallWindowWarmUp(): null {
  useCachedQuery(queries.userActiveCalls());
  return null;
}
