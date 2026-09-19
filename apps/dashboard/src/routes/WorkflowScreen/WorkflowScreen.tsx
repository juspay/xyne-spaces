import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { WorkflowApp, WorkflowUIProvider } from '@xyne/workflow-ui';
import { toast } from 'sonner';
import { workflowClient } from '../../lib/workflowClient';
import { queryClient } from '../../services/clients/queryClient';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { Button } from '../../components/ui/Button';
import Tooltip from '../../components/ui/Tooltip';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { useWorkflowRouting, workflowScopeFromPath } from './useWorkflowRouting';
import { useWorkflowAssistantContext } from './useWorkflowAssistantContext';

const notify = (kind: 'success' | 'error', message: string): void => {
  if (kind === 'success') toast.success(message);
  else toast.error(message);
};

const WorkflowScreen = (): ReactElement => {
  const { path, search, navigate } = useWorkflowRouting();
  const scope = useMemo(() => workflowScopeFromPath(path), [path]);
  const askAiTooltip = scope.executionId
    ? 'Ask AI about this run'
    : scope.workflowId
      ? 'Ask AI about this workflow'
      : 'Ask AI';

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedStepId(null);
  }, [scope.workflowId, scope.executionId]);

  const currentScope = useWorkflowAssistantContext(path, selectedStepId);

  const openAskAi = useCallback((): void => {
    xyneAIActor.send({ type: 'OPEN', trackSource: 'workflow', workflowInfo: currentScope });
  }, [currentScope]);

  const askAiButton = (
    <Tooltip content={askAiTooltip} side='bottom'>
      <Button
        variant='ghost'
        size='sm'
        aria-label={askAiTooltip}
        onClick={openAskAi}
        className='h-8 w-8 rounded-lg p-0'
        data-track-category='WORKFLOWS'
        data-track-name='OPEN_XYNE_AI'
        data-track-metadata={JSON.stringify(scope)}
      >
        <XyneAIStar />
      </Button>
    </Tooltip>
  );

  return (
    <div className='h-full overflow-hidden rounded-2xl border border-border bg-background'>
      <WorkflowUIProvider client={workflowClient} queryClient={queryClient} className='h-full'>
        <WorkflowApp
          className='xyne-workflow-ui h-full'
          path={path}
          search={search}
          onNavigate={navigate}
          onToast={notify}
          headerActions={askAiButton}
          onSelectStep={setSelectedStepId}
        />
      </WorkflowUIProvider>
    </div>
  );
};

export default WorkflowScreen;
