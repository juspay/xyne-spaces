import { useEffect, useRef, type ReactElement } from 'react';
import { WorkflowApp, WorkflowUIProvider } from '@xyne/workflow-ui';
import { sdlcHubWorkflowFolderId } from '@xyne/shared';
import { toast } from 'sonner';
import { workflowClient } from '../../lib/workflowClient';
import { queryClient } from '../../services/clients/queryClient';
import { useSdlcWorkflowRouting } from './useSdlcWorkflowRouting';

const notify = (kind: 'success' | 'error', message: string): void => {
  if (kind === 'success') toast.success(message);
  else toast.error(message);
};

/**
 * The whole workflow surface, mounted under the hub. `WorkflowApp` addresses itself
 * by sub-path, so a second host costs a routing adapter and nothing else.
 */
const SdlcWorkflowsSection = (): ReactElement => {
  const { channelId, path, search, navigate } = useSdlcWorkflowRouting();

  // Land in the hub's folder rather than the workspace root. Once per mount only:
  // the root IS the empty path, so redirecting every time would trap the user here —
  // the breadcrumb and the back arrow both navigate to it.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || path !== '' || !channelId) return;
    landed.current = true;
    navigate(`folder/${sdlcHubWorkflowFolderId(channelId)}`, undefined, true);
  }, [path, channelId, navigate]);

  return (
    <WorkflowUIProvider client={workflowClient} queryClient={queryClient}>
      <WorkflowApp
        className='xyne-workflow-ui h-full'
        path={path}
        search={search}
        onNavigate={navigate}
        onToast={notify}
      />
    </WorkflowUIProvider>
  );
};

export default SdlcWorkflowsSection;
