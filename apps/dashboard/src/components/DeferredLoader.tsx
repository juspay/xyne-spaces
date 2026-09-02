import { useEffect } from 'react';
import { useQuery as useTanStackQuery } from '@tanstack/react-query';
import { queries } from '../zero/queries';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { stateMachineActor } from '../machines/stateMachine';
import { apiInstance } from '../services/clients/apiClient';
import { FeatureAnnouncementHost } from './FeatureAnnouncement/FeatureAnnouncementHost';

interface CurrentUserRolesApiResponse {
  success: boolean;
  roleIds: string[];
}

/**
 * Subscribes to deferred zero queries and pushes results into the state machine.
 * Rendered inside InitialStateLoader after hydration is complete.
 */
export const DeferredLoader: React.FC = () => {
  const [unreadActivities] = useCachedQuery(queries.userUnreadActivities());

  const currentUserRolesQuery = useTanStackQuery<CurrentUserRolesApiResponse>({
    queryKey: ['current-user-roles'],
    queryFn: async () => {
      const response = await apiInstance.get<CurrentUserRolesApiResponse>('/auth/roles');
      return response.data;
    },
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    stateMachineActor.send({
      type: 'SET_UNREAD_ACTIVITIES',
      unreadActivities: unreadActivities ?? [],
    });
  }, [unreadActivities]);

  useEffect(() => {
    if (currentUserRolesQuery.isSuccess && currentUserRolesQuery.data?.success) {
      stateMachineActor.send({
        type: 'SET_CURRENT_USER_ROLE_IDS',
        roleIds: currentUserRolesQuery.data.roleIds || [],
      });
    }
  }, [currentUserRolesQuery.isSuccess, currentUserRolesQuery.data]);

  return <FeatureAnnouncementHost />;
};
