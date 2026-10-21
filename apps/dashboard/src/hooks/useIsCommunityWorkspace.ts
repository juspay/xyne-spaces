import { useParams } from 'react-router-dom';
import { WorkspaceType } from '@xyne/shared';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/**
 * True when the current workspace (from the URL) is a COMMUNITY workspace.
 * Used to hide enterprise-only surfaces (e.g. member emails) in community spaces.
 */
export const useIsCommunityWorkspace = (): boolean => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId ?? '' }), {
    enabled: !!workspaceId,
  });
  return workspace?.workspaceType === WorkspaceType.COMMUNITY;
};
