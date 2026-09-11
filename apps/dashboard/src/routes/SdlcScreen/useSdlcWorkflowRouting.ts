import { useParams } from 'react-router-dom';
import { useWorkflowRouting, type WorkflowRouting } from '../WorkflowScreen/useWorkflowRouting';

/**
 * `useWorkflowRouting` with a hub-scoped base. Keeping the hub in the path is what
 * holds the UI inside the SDLC iframe — `isSdlcPath` matches `/:workspaceId/sdlc/`.
 */
export const useSdlcWorkflowRouting = (): WorkflowRouting & { channelId: string | undefined } => {
  const { workspaceId, channelId } = useParams<{ workspaceId?: string; channelId?: string }>();
  const routing = useWorkflowRouting(
    `${workspaceId ? `/${workspaceId}` : ''}/sdlc/${channelId ?? ''}/workflows`,
  );
  return { ...routing, channelId };
};
