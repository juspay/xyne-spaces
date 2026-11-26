import { useParams } from 'react-router-dom';
import { useWorkflowRouting, type WorkflowRouting } from '../WorkflowScreen/useWorkflowRouting';

/** The hub stays in the path, so the builder renders inside the hub page. */
export const useSdlcWorkflowRouting = (): WorkflowRouting & { channelId: string | undefined } => {
  const { workspaceId, channelId } = useParams<{ workspaceId?: string; channelId?: string }>();
  const routing = useWorkflowRouting(
    `${workspaceId ? `/${workspaceId}` : ''}/sdlc/${channelId ?? ''}/workflows`,
  );
  return { ...routing, channelId };
};
