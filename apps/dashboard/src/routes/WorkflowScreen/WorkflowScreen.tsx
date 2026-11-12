import type { ReactElement } from 'react';
import { WorkflowApp, WorkflowUIProvider } from '@xyne/workflow-ui';
import { toast } from 'sonner';
import { workflowClient } from '../../lib/workflowClient';
import { queryClient } from '../../services/clients/queryClient';
import { useWorkflowRouting } from './useWorkflowRouting';

const notify = (kind: 'success' | 'error', message: string): void => {
  if (kind === 'success') toast.success(message);
  else toast.error(message);
};

const WorkflowScreen = (): ReactElement => {
  const { path, search, navigate } = useWorkflowRouting();

  return (
    <div className='h-full overflow-hidden rounded-2xl border border-border bg-background'>
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

export default WorkflowScreen;
