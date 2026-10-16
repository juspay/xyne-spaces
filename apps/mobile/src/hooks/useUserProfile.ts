import { useQuery } from './useQuery';
import { queries } from '../zero/queries';

export function useUserProfile(userId: string | undefined) {
  const enabled = Boolean(userId);
  const [profile] = useQuery(queries.getUserProfile({ userId: userId ?? '' }), { enabled });
  return profile;
}
