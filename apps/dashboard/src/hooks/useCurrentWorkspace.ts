import { useParams } from 'react-router-dom';
import type { Workspace } from '@xyne/shared';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/**
 * Live record of the current workspace (from the `:workspaceId` URL segment).
 * Returns undefined while loading or outside a workspace route.
 */
export const useCurrentWorkspace = (): Workspace | undefined => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId ?? '' }), {
    enabled: !!workspaceId,
  });
  return workspace;
};
