import { type ReactElement } from 'react';
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

export default WorkflowScreen;
