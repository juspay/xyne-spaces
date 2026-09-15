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

const SdlcWorkflowsSection = (): ReactElement => {
  const { channelId, path, search, navigate } = useSdlcWorkflowRouting();

  // Once per mount: the root is the empty path, so redirecting every time traps the user.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || path !== '' || !channelId) return;
    landed.current = true;
    navigate(`folder/${sdlcHubWorkflowFolderId(channelId)}`, undefined, true);
  }, [path, channelId, navigate]);

  return (
    // The builder's side panel grows to its content's min width, which overflows next to the hub sidebar.
    <div className='h-full overflow-hidden [&_.flex.h-full.w-full>*]:min-w-0'>
      <WorkflowUIProvider client={workflowClient} queryClient={queryClient} className='h-full'>
        <WorkflowApp
          className='xyne-workflow-ui h-full'
          path={path}
          search={search}
          onNavigate={navigate}
          onToast={notify}
        />
      </WorkflowUIProvider>
    </div>
  );
};

export default SdlcWorkflowsSection;
